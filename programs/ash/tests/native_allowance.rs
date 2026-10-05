//! `enable_native_allowance` and the `FundingMode::NativeAllowance` path of
//! `execute_payment`, against the real, devnet-dumped Solana Subscriptions & Allowances
//! program (ADR-014). Layer 2 of the test pyramid (ADR-008), but CPI-ing into an actual
//! external binary rather than a stub — see `common::load_native_subscriptions_program`.
//!
//! The two things these tests exist to prove, in order of importance:
//!
//! 1. **The security invariant holds against the real program, not just our own code.**
//!    `execute_payment` hard-codes the Treasury PDA as `delegatee` and never lets a client
//!    override it. But the actual guarantee is external: does the *native program itself*
//!    refuse a `transferFixed` call where the signer isn't the pubkey its own
//!    `FixedDelegation` account recorded as `delegatee`? That can only be answered by
//!    calling the real program, which is what `session_key_cannot_pull_via_the_native_program_directly`
//!    does — it never goes through `ash::execute_payment` at all.
//! 2. **The happy path actually moves funds from the owner's wallet, not the vault**, and
//!    the policy/receipt/audit-chain bookkeeping on our side is identical to the vault path.

#![allow(dead_code)]

mod common;

use anchor_litesvm::{Keypair, Pubkey, Signer};

use ash::constants::NATIVE_SUBSCRIPTIONS_PROGRAM;
use ash::native_allowance::build_transfer_fixed_instruction;
use ash::state::FundingMode;
use ash::AshError;

use common::*;

const MINT_DECIMALS: u8 = 6;
const OWNER_WALLET_BALANCE: u64 = 500_000_000;
const AMOUNT_CAP: u64 = 500_000_000;
const PAYMENT: u64 = 1_500_000;
const SESSION_TTL: i64 = 86_400;

/// Treasury with a `NativeAllowance` mint: the vault ATA exists (via `add_mint`, unfunded)
/// but the owner's own ATA holds the spendable balance, delegated to the native program
/// with the Treasury PDA as `delegatee`.
struct NativeFixture {
    treasury: TreasuryFixture,
    mint: Pubkey,
    token_program: Pubkey,
    owner_ata: Pubkey,
    policy: Pubkey,
    session: SessionFixture,
    destination: Pubkey,
    destination_ata: Pubkey,
    fee_payer: Keypair,
}

fn native_fixture(env: &mut Env) -> NativeFixture {
    load_native_subscriptions_program(env);

    let treasury = create_treasury(env, true, true);
    let mint_authority = treasury.owner.insecure_clone();
    let token_program = token_program_id();

    let mint = create_spl_token_mint(env, &mint_authority, MINT_DECIMALS);
    add_spl_mint(env, &treasury, mint, token_program, permissive_ceiling());

    // Funds live in the owner's own wallet, never the vault, in NativeAllowance mode.
    let owner_ata = create_destination_ata(
        env,
        &treasury.owner,
        &treasury.owner.pubkey(),
        &mint,
        token_program,
    );
    let mint_to_owner = spl_token_2022_mint_to(
        &token_program,
        &mint,
        &owner_ata,
        &treasury.owner.pubkey(),
        OWNER_WALLET_BALANCE,
    );
    env.execute(mint_to_owner, &[&treasury.owner])
        .assert_success();

    let expiry_ts = env.now() + SESSION_TTL;
    enable_native_allowance(
        env,
        &treasury,
        mint,
        owner_ata,
        token_program,
        AMOUNT_CAP,
        expiry_ts,
    );

    let args = permissive_policy_args(mint);
    let policy = create_policy(env, &treasury, padded_name("native"), args);
    let session = create_session(env, &treasury, &policy, SESSION_TTL);

    let destination = env.unique_pubkey();
    let fee_payer = env.keypair();
    let destination_ata =
        create_destination_ata(env, &fee_payer, &destination, &mint, token_program);

    NativeFixture {
        treasury,
        mint,
        token_program,
        owner_ata,
        policy,
        session,
        destination,
        destination_ata,
        fee_payer,
    }
}

// ---------------------------------------------------------------------------------------
// 1. enable_native_allowance
// ---------------------------------------------------------------------------------------

#[test]
fn enable_native_allowance_switches_the_mint_slot_and_creates_the_native_delegation() {
    let mut env = Env::new();
    let f = native_fixture(&mut env);

    let treasury = env.treasury(&f.treasury.treasury);
    let slot = *treasury.find_mint(&f.mint).expect("mint configured");
    assert_eq!(slot.funding_mode, FundingMode::NativeAllowance);

    let native =
        native_allowance_accounts(&f.treasury.owner.pubkey(), &f.mint, &f.treasury.treasury);
    assert!(
        account_exists(&env, &native.native_delegation),
        "FixedDelegation account should exist after enable_native_allowance"
    );
    assert!(account_exists(&env, &native.subscription_authority));

    // The vault ATA still exists (add_mint created it) but was never funded — proof that
    // NativeAllowance mode never touches it.
    let vault = vault_ata(&f.treasury.treasury, &f.mint, &f.token_program);
    assert_eq!(token_balance(&env, &vault), 0);
}

#[test]
fn enable_native_allowance_is_owner_only() {
    let mut env = Env::new();
    load_native_subscriptions_program(&mut env);

    let treasury = create_treasury(&mut env, true, true);
    let mint = create_spl_token_mint(&mut env, &treasury.owner, MINT_DECIMALS);
    add_spl_mint(
        &mut env,
        &treasury,
        mint,
        token_program_id(),
        permissive_ceiling(),
    );
    let owner_ata = create_destination_ata(
        &mut env,
        &treasury.owner,
        &treasury.owner.pubkey(),
        &mint,
        token_program_id(),
    );

    let expiry_ts = env.now() + SESSION_TTL;
    // The operator's own pubkey in the `owner` slot, signed by the operator: builds fine
    // client-side, then hits `has_one = owner` on-chain since treasury.owner disagrees.
    let operator = treasury.operator_key.insecure_clone();
    let ix = enable_native_allowance_ix(
        &env,
        treasury.treasury,
        operator.pubkey(),
        mint,
        owner_ata,
        token_program_id(),
        AMOUNT_CAP,
        expiry_ts,
    );
    let result = env.execute(ix, &[&operator]);
    assert_program_error(&result, AshError::Unauthorized);
}

// ---------------------------------------------------------------------------------------
// 2. execute_payment in NativeAllowance mode
// ---------------------------------------------------------------------------------------

#[test]
fn execute_payment_pulls_from_the_owners_wallet_and_leaves_the_vault_untouched() {
    let mut env = Env::new();
    let f = native_fixture(&mut env);

    let owner_balance_before = token_balance(&env, &f.owner_ata);

    let payment_intent = intent(&mut env, f.mint, f.destination, PAYMENT);
    let ix = execute_payment_native_allowance_ix(
        &env,
        f.treasury.treasury,
        f.treasury.owner.pubkey(),
        &f.session,
        &f.fee_payer.pubkey(),
        f.token_program,
        f.owner_ata,
        None,
        &payment_intent,
    );
    let result = env.execute(ix, &[&f.fee_payer, &f.session.session_key]);
    result.assert_success();

    assert_eq!(token_balance(&env, &f.destination_ata), PAYMENT);
    assert_eq!(
        token_balance(&env, &f.owner_ata),
        owner_balance_before - PAYMENT
    );

    // The vault ATA (unused in this mode) stays exactly as it started: empty.
    let vault = vault_ata(&f.treasury.treasury, &f.mint, &f.token_program);
    assert_eq!(token_balance(&env, &vault), 0);

    // Policy bookkeeping is identical to the vault path: a receipt exists, and the
    // session's sequence/audit chain advanced.
    let receipt = receipt_account(
        &env,
        &receipt_pda(&f.session.session, &payment_intent.intent_id).0,
    );
    assert_eq!(receipt.amount, PAYMENT);
    assert_eq!(receipt.seq, 1);

    let session = session_account(&env, &f.session.session);
    assert_eq!(session.seq, 1);
    assert_ne!(session.audit_head, f.session.genesis_head);
}

#[test]
fn a_payment_above_the_native_delegation_cap_is_rejected_by_the_native_program() {
    let mut env = Env::new();
    let f = native_fixture(&mut env);

    // Above AMOUNT_CAP: our own policy is permissive enough to approve it, so this
    // specifically exercises the native program's own ceiling, not ours.
    let payment_intent = intent(&mut env, f.mint, f.destination, AMOUNT_CAP + 1);
    let ix = execute_payment_native_allowance_ix(
        &env,
        f.treasury.treasury,
        f.treasury.owner.pubkey(),
        &f.session,
        &f.fee_payer.pubkey(),
        f.token_program,
        f.owner_ata,
        None,
        &payment_intent,
    );
    let result = env.execute(ix, &[&f.fee_payer, &f.session.session_key]);
    assert!(
        result.error().is_some(),
        "a transfer above the native FixedDelegation's remaining cap must fail"
    );
}

// ---------------------------------------------------------------------------------------
// 3. The security invariant: a session key cannot bypass the policy engine
// ---------------------------------------------------------------------------------------

/// The load-bearing security property of ADR-014: the native `FixedDelegation`'s
/// `delegatee` is always the Treasury PDA, never the agent's session key, so the agent
/// cannot call the native program's `transferFixed` directly and skip every check
/// `execute_payment` performs.
///
/// This test never touches `ash::execute_payment` — it builds the exact
/// `transferFixed` instruction bytes (via the same `native_allowance::build_transfer_fixed_instruction`
/// the program itself uses) against the *real* native delegation created by
/// `enable_native_allowance`, but signs and names the session key as `delegatee` instead
/// of the Treasury PDA. If the real, deployed native program did not check `delegatee`
/// against what it actually stored at delegation-creation time, this would succeed and
/// drain the owner's wallet with none of ASH' limits, windows, or allowlist
/// applied. It must fail.
#[test]
fn session_key_cannot_pull_via_the_native_program_directly() {
    let mut env = Env::new();
    let f = native_fixture(&mut env);

    let native =
        native_allowance_accounts(&f.treasury.owner.pubkey(), &f.mint, &f.treasury.treasury);
    let attacker_destination_ata = create_destination_ata(
        &mut env,
        &f.fee_payer,
        &f.session.session_key.pubkey(),
        &f.mint,
        f.token_program,
    );

    let forged = build_transfer_fixed_instruction(
        native.native_delegation,
        native.subscription_authority,
        f.owner_ata,
        attacker_destination_ata,
        f.mint,
        f.token_program,
        f.session.session_key.pubkey(), // forged delegatee: the session key, not the Treasury PDA
        native.event_authority,
        NATIVE_SUBSCRIPTIONS_PROGRAM,
        AMOUNT_CAP, // try to take the whole cap in one shot — no policy engine in the way
        f.treasury.owner.pubkey(),
        f.mint,
    );

    let result = env.execute(forged, &[&f.session.session_key]);
    assert!(
        result.error().is_some(),
        "the native program must reject a transferFixed whose delegatee doesn't match the \
         FixedDelegation it actually stored — otherwise a leaked session key drains the \
         owner's entire native allowance with zero policy enforcement"
    );

    // Confirm nothing moved: the forged call must fail closed, not partially succeed.
    assert_eq!(token_balance(&env, &attacker_destination_ata), 0);
    assert_eq!(token_balance(&env, &f.owner_ata), OWNER_WALLET_BALANCE);
}
