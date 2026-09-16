//! Owner administration and policy revision (spec §5.1, §5.2).
//!
//! These three instructions are the ones that can *move a bound*, so they are where the
//! role separation is decided:
//!
//! - `set_ceiling` and `remove_mint` are **owner-only**. An operator who could raise a
//!   ceiling could raise their own limits, and the warm/cold split would be decorative.
//! - `update_policy` is operator-or-owner, but only within the ceiling — an operator must
//!   not be able to reach by editing a state they could not have reached by creating.
//!
//! The most important test here is `lowering_a_ceiling_stops_the_next_payment`. Spec §5.1
//! says `set_ceiling` deliberately does *not* rewrite live policies, which means the whole
//! guarantee rests on `execute_payment`'s step-9 re-check. Nothing else in the suite
//! exercises that contract end to end, because until now no instruction could produce the
//! state.

mod common;

use anchor_litesvm::{Keypair, Pubkey, Signer};

use agent_rails::args::{MintCeilingInput, PolicyInput};
use agent_rails::constants::{MIN_WINDOW_SECONDS, NATIVE_MINT};
use agent_rails::events::{CeilingUpdated, MintRemoved, PolicyUpdated};
use agent_rails::AgentRailsError;

use common::*;

const MINT_DECIMALS: u8 = 6;
const VAULT_AMOUNT: u64 = 500_000_000;
const PAYMENT: u64 = 1_500_000;
const SESSION_TTL: i64 = 86_400;

/// Borsh bytes, for cross-checking a digest the program computed on-chain.
fn borsh_bytes<T: anchor_lang::AnchorSerialize>(value: &T) -> Vec<u8> {
    let mut bytes = Vec::new();
    value.serialize(&mut bytes).expect("serialize");
    bytes
}

/// A treasury with one SPL mint configured and an empty vault.
fn treasury_with_mint(env: &mut Env) -> (TreasuryFixture, Pubkey) {
    let fixture = create_treasury(env, true, true);
    let authority = fixture.owner.insecure_clone();
    let mint = create_spl_token_mint(env, &authority, MINT_DECIMALS);
    add_spl_mint(
        env,
        &fixture,
        mint,
        token_program_id(),
        permissive_ceiling(),
    );
    (fixture, mint)
}

/// The same, with a funded vault, a policy, a session, and a destination that can be paid.
struct PayableFixture {
    treasury: TreasuryFixture,
    mint: Pubkey,
    policy: Pubkey,
    session: SessionFixture,
    destination: Pubkey,
    fee_payer: Keypair,
}

fn payable_fixture(env: &mut Env) -> PayableFixture {
    let (treasury, mint) = treasury_with_mint(env);
    let authority = treasury.owner.insecure_clone();
    fund_vault(
        env,
        &treasury.treasury,
        &mint,
        &authority,
        token_program_id(),
        VAULT_AMOUNT,
    );

    let policy = create_policy(
        env,
        &treasury,
        padded_name("default"),
        permissive_policy_args(mint),
    );
    let session = create_session(env, &treasury, &policy, SESSION_TTL);

    let destination = env.unique_pubkey();
    let fee_payer = env.keypair();
    create_destination_ata(env, &fee_payer, &destination, &mint, token_program_id());

    PayableFixture {
        treasury,
        mint,
        policy,
        session,
        destination,
        fee_payer,
    }
}

/// Attempts one payment and returns the result, so a test can assert either outcome.
fn try_payment(
    env: &mut Env,
    f: &PayableFixture,
    amount: u64,
) -> anchor_litesvm::TransactionResult {
    let intent = intent(env, f.mint, f.destination, amount);
    let ix = execute_payment_ix(
        env,
        &f.treasury,
        &f.session,
        &f.fee_payer.pubkey(),
        token_program_id(),
        None,
        &intent,
    );
    env.execute(ix, &[&f.fee_payer, &f.session.session_key])
}

// ---------------------------------------------------------------------------------------
// set_ceiling
// ---------------------------------------------------------------------------------------

#[test]
fn set_ceiling_overwrites_the_slot_and_both_destination_flags() {
    let mut env = Env::new();
    let (fixture, mint) = treasury_with_mint(&mut env);

    let tightened = MintCeilingInput {
        max_per_tx: 1_000,
        max_short_window: 2_000,
        max_long_window: 3_000,
        max_lifetime: 4_000,
        min_short_window_seconds: 7_200,
        min_long_window_seconds: 172_800,
    };
    let ix = set_ceiling_ix(
        &env,
        &fixture.treasury,
        &fixture.owner.pubkey(),
        mint,
        tightened,
        false,
        false,
    );
    let owner = fixture.owner.insecure_clone();
    let result = env.execute(ix, &[&owner]);
    result.assert_success();

    let treasury = env.treasury(&fixture.treasury);
    let config = treasury.find_mint(&mint).expect("mint slot");
    assert_eq!(config.ceiling, tightened.to_state());
    assert!(!treasury.allow_any_destination);
    assert!(!treasury.allow_create_destination_ata);

    // Nothing else about the slot moves: the token program and cached decimals are what
    // `execute_payment` trusts for `transfer_checked`.
    assert_eq!(config.token_program, token_program_id());
    assert_eq!(config.decimals, MINT_DECIMALS);

    let event: CeilingUpdated = emitted_event(&result);
    assert_eq!(event.mint, mint);
    assert_eq!(event.ceiling, tightened.to_state());
    assert!(!event.allow_any_destination);
    assert!(!event.allow_create_destination_ata);
}

#[test]
fn set_ceiling_is_owner_only() {
    let mut env = Env::new();
    let (fixture, mint) = treasury_with_mint(&mut env);

    // The operator is warm and may configure *within* ceilings. Moving one is cold-key work,
    // or the separation between the two roles buys nothing.
    let operator = fixture.operator_key.insecure_clone();
    let ix = set_ceiling_ix(
        &env,
        &fixture.treasury,
        &operator.pubkey(),
        mint,
        permissive_ceiling(),
        true,
        true,
    );
    assert_program_error(
        &env.execute(ix, &[&operator]),
        AgentRailsError::Unauthorized,
    );

    let stranger = env.keypair();
    let ix = set_ceiling_ix(
        &env,
        &fixture.treasury,
        &stranger.pubkey(),
        mint,
        permissive_ceiling(),
        true,
        true,
    );
    assert_program_error(
        &env.execute(ix, &[&stranger]),
        AgentRailsError::Unauthorized,
    );
}

#[test]
fn set_ceiling_rejects_an_unconfigured_mint_and_an_invalid_ceiling() {
    let mut env = Env::new();
    let (fixture, mint) = treasury_with_mint(&mut env);
    let owner = fixture.owner.insecure_clone();

    let stranger_mint = env.unique_pubkey();
    let ix = set_ceiling_ix(
        &env,
        &fixture.treasury,
        &owner.pubkey(),
        stranger_mint,
        permissive_ceiling(),
        true,
        true,
    );
    assert_program_error(
        &env.execute(ix, &[&owner]),
        AgentRailsError::MintNotConfigured,
    );

    let mut invalid = permissive_ceiling();
    invalid.min_short_window_seconds = MIN_WINDOW_SECONDS - 1;
    let ix = set_ceiling_ix(
        &env,
        &fixture.treasury,
        &owner.pubkey(),
        mint,
        invalid,
        true,
        true,
    );
    assert_program_error(&env.execute(ix, &[&owner]), AgentRailsError::InvalidWindow);
}

#[test]
fn lowering_a_ceiling_stops_the_next_payment_without_touching_the_policy() {
    let mut env = Env::new();
    let f = payable_fixture(&mut env);
    try_payment(&mut env, &f, PAYMENT).assert_success();

    let before = policy_account(&env, &f.policy);
    let mut tightened = permissive_ceiling();
    tightened.max_per_tx = PAYMENT / 2;
    set_ceiling(&mut env, &f.treasury, f.mint, tightened);

    // Spec §5.1: existing policies are deliberately not mutated. The program cannot
    // enumerate policy PDAs, so a partial rewrite would leave some of them loose — instead
    // the policy stays as written and every payment under it fails closed.
    let after = policy_account(&env, &f.policy);
    assert_eq!(after.mint_limits, before.mint_limits);
    assert_eq!(after.updated_at, before.updated_at);

    let result = try_payment(&mut env, &f, PAYMENT);
    assert_program_error(&result, AgentRailsError::PolicyExceedsCeiling);

    // And the operator restores service by bringing the policy back under the new bound —
    // no owner involvement needed for the tightening to take effect or to be undone.
    let mut args = permissive_policy_args(f.mint);
    args.mint_limits[0].per_tx_max = PAYMENT / 2;
    args.mint_limits[0].short_window_max = tightened.max_short_window;
    args.mint_limits[0].long_window_max = tightened.max_long_window;
    args.mint_limits[0].lifetime_max = tightened.max_lifetime;
    let ix = update_policy_ix(
        &env,
        &f.treasury.treasury,
        &f.treasury.operator_key.pubkey(),
        &f.policy,
        args,
    );
    let operator = f.treasury.operator_key.insecure_clone();
    env.execute(ix, &[&operator]).assert_success();

    try_payment(&mut env, &f, PAYMENT / 2).assert_success();
}

#[test]
fn revoking_the_open_destination_flag_stops_an_any_mode_policy() {
    let mut env = Env::new();
    let f = payable_fixture(&mut env);
    try_payment(&mut env, &f, PAYMENT).assert_success();

    // `Any` is a ceiling flag, so revoking it has to bite immediately rather than at the
    // operator's next policy edit.
    set_destination_flags(&mut env, &f.treasury, f.mint, false, true);

    let result = try_payment(&mut env, &f, PAYMENT);
    assert_program_error(&result, AgentRailsError::PolicyExceedsCeiling);
}

// ---------------------------------------------------------------------------------------
// update_policy
// ---------------------------------------------------------------------------------------

#[test]
fn update_policy_rewrites_the_rules_and_preserves_identity() {
    let mut env = Env::new();
    let (fixture, mint) = treasury_with_mint(&mut env);
    let name = padded_name("revisable");
    let original = permissive_policy_args(mint);
    let policy = create_policy(&mut env, &fixture, name, original.clone());
    let before = policy_account(&env, &policy);

    env.warp_seconds(60);
    let mut revised = permissive_policy_args(mint);
    revised.mint_limits[0].per_tx_max = 42_000;
    revised.require_memo = true;
    revised.destination_mode = 1;

    let ix = update_policy_ix(
        &env,
        &fixture.treasury,
        &fixture.owner.pubkey(),
        &policy,
        revised.clone(),
    );
    let owner = fixture.owner.insecure_clone();
    let result = env.execute(ix, &[&owner]);
    result.assert_success();

    let after = policy_account(&env, &policy);
    assert_eq!(after.mint_limits[0].per_tx_max, 42_000);
    assert!(after.require_memo);
    assert_eq!(after.destination_mode, 1);
    assert_eq!(after.updated_at, env.now());

    // Identity and provenance survive a revision: the name seeds the address, so an
    // indexer can chain revisions for one policy.
    assert_eq!(after.version, before.version);
    assert_eq!(after.bump, before.bump);
    assert_eq!(after.treasury, before.treasury);
    assert_eq!(after.name, before.name);
    assert_eq!(after.created_at, before.created_at);
    assert_eq!(after.active_sessions, before.active_sessions);
    assert_eq!(after.reserved, [0u8; 64]);
    assert!(after.updated_at > before.updated_at);

    // The v1.1 fields stay zero through an update too, not just a create.
    assert_eq!(after.mint_limits[0].approval_threshold, 0);
    assert_eq!(after.mint_limits[0].cooldown_seconds, 0);

    let event: PolicyUpdated = emitted_event(&result);
    assert_eq!(event.policy, policy);
    assert_eq!(event.name, name);
    assert_eq!(
        event.previous_limits_hash,
        sha256(&borsh_bytes(&original)),
        "the previous digest must match what PolicyCreated committed to"
    );
    assert_eq!(event.limits_hash, sha256(&borsh_bytes(&revised)));
}

#[test]
fn update_policy_keeps_session_counters() {
    let mut env = Env::new();
    let f = payable_fixture(&mut env);
    try_payment(&mut env, &f, PAYMENT).assert_success();

    let spent_before =
        session_account(&env, &f.session.session).spend[session_account(&env, &f.session.session)
            .find_counter(&f.mint)
            .expect("counter")];
    assert_eq!(spent_before.lifetime_spent, PAYMENT);

    // Reordering, adding, or dropping slots must not hand an agent a fresh budget: spend is
    // looked up by mint, never by index (spec §3.3.1). Prepending the native mint here moves
    // the original mint from slot 0 to slot 1.
    add_native_mint(&mut env, &f.treasury, permissive_ceiling());
    let args = PolicyInput {
        mint_limits: vec![
            permissive_limit_args(NATIVE_MINT),
            permissive_limit_args(f.mint),
        ],
        destination_mode: 0,
        require_memo: false,
        create_destination_ata: false,
    };
    let ix = update_policy_ix(
        &env,
        &f.treasury.treasury,
        &f.treasury.owner.pubkey(),
        &f.policy,
        args,
    );
    let owner = f.treasury.owner.insecure_clone();
    env.execute(ix, &[&owner]).assert_success();

    let policy = policy_account(&env, &f.policy);
    assert_eq!(policy.mint_limits[0].mint, NATIVE_MINT);
    assert_eq!(policy.mint_limits[1].mint, f.mint);

    let session = session_account(&env, &f.session.session);
    let counter = session.spend[session.find_counter(&f.mint).expect("counter")];
    assert_eq!(
        counter.lifetime_spent, PAYMENT,
        "spend must follow the mint, not the slot index"
    );

    try_payment(&mut env, &f, PAYMENT).assert_success();
    let session = session_account(&env, &f.session.session);
    let counter = session.spend[session.find_counter(&f.mint).expect("counter")];
    assert_eq!(counter.lifetime_spent, PAYMENT * 2);
}

#[test]
fn update_policy_cannot_escape_the_ceiling() {
    let mut env = Env::new();
    let (fixture, mint) = treasury_with_mint(&mut env);
    let policy = create_policy(
        &mut env,
        &fixture,
        padded_name("p"),
        permissive_policy_args(mint),
    );
    let owner = fixture.owner.insecure_clone();

    // An operator must not reach by editing a state they could not have reached by
    // creating. Both instructions run the same `policy_leq_ceiling`.
    let mut args = permissive_policy_args(mint);
    args.mint_limits[0].per_tx_max = permissive_ceiling().max_per_tx + 1;
    let ix = update_policy_ix(&env, &fixture.treasury, &owner.pubkey(), &policy, args);
    assert_program_error(
        &env.execute(ix, &[&owner]),
        AgentRailsError::PolicyExceedsCeiling,
    );

    let mut args = permissive_policy_args(mint);
    args.mint_limits[0].short_window_seconds = permissive_ceiling().min_short_window_seconds - 1;
    let ix = update_policy_ix(&env, &fixture.treasury, &owner.pubkey(), &policy, args);
    assert_program_error(
        &env.execute(ix, &[&owner]),
        AgentRailsError::PolicyExceedsCeiling,
    );

    // Unchanged on disk after both rejections.
    assert_eq!(
        policy_account(&env, &policy).mint_limits[0].per_tx_max,
        permissive_policy_args(mint).mint_limits[0].per_tx_max
    );
}

#[test]
fn update_policy_accepts_the_operator_and_rejects_a_stranger() {
    let mut env = Env::new();
    let (fixture, mint) = treasury_with_mint(&mut env);
    let policy = create_policy(
        &mut env,
        &fixture,
        padded_name("p"),
        permissive_policy_args(mint),
    );

    let operator = fixture.operator_key.insecure_clone();
    let mut args = permissive_policy_args(mint);
    args.mint_limits[0].per_tx_max = 7;
    let ix = update_policy_ix(&env, &fixture.treasury, &operator.pubkey(), &policy, args);
    env.execute(ix, &[&operator]).assert_success();
    assert_eq!(policy_account(&env, &policy).mint_limits[0].per_tx_max, 7);

    let stranger = env.keypair();
    let ix = update_policy_ix(
        &env,
        &fixture.treasury,
        &stranger.pubkey(),
        &policy,
        permissive_policy_args(mint),
    );
    assert_program_error(
        &env.execute(ix, &[&stranger]),
        AgentRailsError::Unauthorized,
    );
    assert_eq!(policy_account(&env, &policy).mint_limits[0].per_tx_max, 7);
}

#[test]
fn update_policy_rejects_an_unconfigured_mint() {
    let mut env = Env::new();
    let (fixture, mint) = treasury_with_mint(&mut env);
    let policy = create_policy(
        &mut env,
        &fixture,
        padded_name("p"),
        permissive_policy_args(mint),
    );
    let owner = fixture.owner.insecure_clone();
    let stranger = create_spl_token_mint(&mut env, &owner, MINT_DECIMALS);

    let ix = update_policy_ix(
        &env,
        &fixture.treasury,
        &owner.pubkey(),
        &policy,
        permissive_policy_args(stranger),
    );
    assert_program_error(
        &env.execute(ix, &[&owner]),
        AgentRailsError::MintNotConfigured,
    );
}

// ---------------------------------------------------------------------------------------
// remove_mint
// ---------------------------------------------------------------------------------------

#[test]
fn remove_mint_clears_the_slot_and_frees_it_for_reuse() {
    let mut env = Env::new();
    let (fixture, mint) = treasury_with_mint(&mut env);
    assert_eq!(env.treasury(&fixture.treasury).mint_count, 1);

    let vault = vault_ata(&fixture.treasury, &mint, &token_program_id());
    let ix = remove_mint_ix(&env, &fixture, &fixture.owner.pubkey(), mint, Some(vault));
    let owner = fixture.owner.insecure_clone();
    let result = env.execute(ix, &[&owner]);
    result.assert_success();

    let treasury = env.treasury(&fixture.treasury);
    assert!(treasury.find_mint(&mint).is_none());
    assert_eq!(treasury.mint_count, 0);
    assert_eq!(treasury.mints[0], agent_rails::state::MintConfig::EMPTY);

    let event: MintRemoved = emitted_event(&result);
    assert_eq!(event.mint, mint);
    assert_eq!(event.token_program, token_program_id());

    // The vault ATA survives, empty and rent-exempt, so re-adding finds it idempotently.
    assert!(account_exists(&env, &vault));
    add_spl_mint(
        &mut env,
        &fixture,
        mint,
        token_program_id(),
        permissive_ceiling(),
    );
    assert_eq!(env.treasury(&fixture.treasury).mint_count, 1);
}

#[test]
fn remove_mint_delists_native_sol_at_the_rent_floor() {
    let mut env = Env::new();
    let fixture = create_treasury(&mut env, true, true);
    add_native_mint(&mut env, &fixture, permissive_ceiling());
    assert_eq!(env.treasury(&fixture.treasury).mint_count, 1);

    let ix = remove_mint_ix(&env, &fixture, &fixture.owner.pubkey(), NATIVE_MINT, None);
    let owner = fixture.owner.insecure_clone();
    env.execute(ix, &[&owner]).assert_success();

    let treasury = env.treasury(&fixture.treasury);
    assert!(treasury.find_mint(&NATIVE_MINT).is_none());
    assert_eq!(treasury.mint_count, 0);
}

#[test]
fn remove_mint_refuses_a_vault_that_still_holds_value() {
    let mut env = Env::new();
    let (fixture, mint) = treasury_with_mint(&mut env);
    let authority = fixture.owner.insecure_clone();
    fund_vault(
        &mut env,
        &fixture.treasury,
        &mint,
        &authority,
        token_program_id(),
        VAULT_AMOUNT,
    );

    // Delisting would orphan the balance: `withdraw` resolves the mint through
    // `Treasury.mints`, so once the slot is gone the owner cannot reach these tokens.
    let vault = vault_ata(&fixture.treasury, &mint, &token_program_id());
    let ix = remove_mint_ix(&env, &fixture, &fixture.owner.pubkey(), mint, Some(vault));
    assert_program_error(
        &env.execute(ix, &[&authority]),
        AgentRailsError::TreasuryNotEmpty,
    );
    assert_eq!(env.treasury(&fixture.treasury).mint_count, 1);
}

#[test]
fn remove_mint_refuses_native_sol_above_the_rent_floor() {
    let mut env = Env::new();
    let fixture = create_treasury(&mut env, true, true);
    add_native_mint(&mut env, &fixture, permissive_ceiling());

    let funder = env.keypair();
    let ix = anchor_lang::solana_program::system_instruction::transfer(
        &funder.pubkey(),
        &fixture.sol_vault,
        1_000_000,
    );
    env.execute(ix, &[&funder]).assert_success();

    let ix = remove_mint_ix(&env, &fixture, &fixture.owner.pubkey(), NATIVE_MINT, None);
    let owner = fixture.owner.insecure_clone();
    assert_program_error(
        &env.execute(ix, &[&owner]),
        AgentRailsError::TreasuryNotEmpty,
    );
}

#[test]
fn remove_mint_refuses_while_any_policy_is_open() {
    let mut env = Env::new();
    let (fixture, mint) = treasury_with_mint(&mut env);
    let policy = create_policy(
        &mut env,
        &fixture,
        padded_name("p"),
        permissive_policy_args(mint),
    );
    let owner = fixture.owner.insecure_clone();
    let vault = vault_ata(&fixture.treasury, &mint, &token_program_id());

    // §5.1 chooses the strict `policy_count == 0` rule over a per-policy check the program
    // cannot perform. Its useful consequence: a live policy naming an unconfigured mint is
    // unreachable on-chain.
    let ix = remove_mint_ix(&env, &fixture, &owner.pubkey(), mint, Some(vault));
    assert_program_error(
        &env.execute(ix, &[&owner]),
        AgentRailsError::TreasuryNotEmpty,
    );

    let rent_destination = env.unique_pubkey();
    let ix = close_policy_ix(
        &env,
        &fixture.treasury,
        &owner.pubkey(),
        &policy,
        &rent_destination,
    );
    env.execute(ix, &[&owner]).assert_success();

    let ix = remove_mint_ix(&env, &fixture, &owner.pubkey(), mint, Some(vault));
    env.execute(ix, &[&owner]).assert_success();
    assert_eq!(env.treasury(&fixture.treasury).mint_count, 0);
}

#[test]
fn remove_mint_is_owner_only_and_needs_a_configured_mint() {
    let mut env = Env::new();
    let (fixture, mint) = treasury_with_mint(&mut env);
    let vault = vault_ata(&fixture.treasury, &mint, &token_program_id());

    let operator = fixture.operator_key.insecure_clone();
    let ix = remove_mint_ix(&env, &fixture, &operator.pubkey(), mint, Some(vault));
    assert_program_error(
        &env.execute(ix, &[&operator]),
        AgentRailsError::Unauthorized,
    );

    let owner = fixture.owner.insecure_clone();
    let stranger = create_spl_token_mint(&mut env, &owner, MINT_DECIMALS);
    let stranger_vault = vault_ata(&fixture.treasury, &stranger, &token_program_id());
    let ix = remove_mint_ix(
        &env,
        &fixture,
        &owner.pubkey(),
        stranger,
        Some(stranger_vault),
    );
    env.execute(ix, &[&owner]).assert_failure();

    assert_eq!(env.treasury(&fixture.treasury).mint_count, 1);
}

#[test]
fn remove_mint_refuses_a_substituted_vault_account() {
    let mut env = Env::new();
    let (fixture, mint) = treasury_with_mint(&mut env);
    let owner = fixture.owner.insecure_clone();

    // An empty token account for the right mint, owned by someone else. Only the treasury's
    // own ATA proves the *treasury's* balance is zero.
    let bystander = env.unique_pubkey();
    let decoy = create_destination_ata(&mut env, &owner, &bystander, &mint, token_program_id());
    fund_vault(
        &mut env,
        &fixture.treasury,
        &mint,
        &owner,
        token_program_id(),
        VAULT_AMOUNT,
    );

    let ix = remove_mint_ix(&env, &fixture, &owner.pubkey(), mint, Some(decoy));
    assert_program_error(
        &env.execute(ix, &[&owner]),
        AgentRailsError::TokenProgramMismatch,
    );
    assert_eq!(env.treasury(&fixture.treasury).mint_count, 1);
}
