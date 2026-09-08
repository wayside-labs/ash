//! Remaining owner, guardian, and permissionless instructions (spec §5.1, §5.4).
//!
//! These seven close the SBF surface: without them funds cannot leave a vault except by
//! paying an agent, the guardian kill switch has no on-chain trigger, and a treasury can
//! never be torn down. The tests therefore focus on the authorization matrix and on the
//! fail-closed empty checks, not on re-proving the payment path.

mod common;

use anchor_litesvm::{Pubkey, Signer};

use agent_rails::constants::{MAX_GUARDIANS, NATIVE_MINT, RECEIPT_GRACE_SECONDS};
use agent_rails::events::{
    GuardianAdded, GuardianRemoved, ReceiptClosed, RolesUpdated, TreasuryClosed, TreasuryPaused,
    TreasuryUnpaused, Withdrawn,
};
use agent_rails::AgentRailsError;

use common::*;

const MINT_DECIMALS: u8 = 6;
const VAULT_AMOUNT: u64 = 500_000_000;
const PAYMENT: u64 = 1_500_000;
const SESSION_TTL: i64 = 86_400;
const SOL_DEPOSIT: u64 = 5_000_000_000;

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

fn fund_spl(env: &mut Env, fixture: &TreasuryFixture, mint: Pubkey, amount: u64) {
    let authority = fixture.owner.insecure_clone();
    fund_vault(
        env,
        &fixture.treasury,
        &mint,
        &authority,
        token_program_id(),
        amount,
    );
}

fn deposit_sol(env: &mut Env, sol_vault: &Pubkey, amount: u64) {
    let funder = env.keypair();
    let ix = anchor_lang::solana_program::system_instruction::transfer(
        &funder.pubkey(),
        sol_vault,
        amount,
    );
    env.execute(ix, &[&funder]).assert_success();
}

// ---------------------------------------------------------------------------------------
// set_roles
// ---------------------------------------------------------------------------------------

#[test]
fn set_roles_rotates_owner_and_operator() {
    let mut env = Env::new();
    let fixture = create_treasury(&mut env, true, true);
    let new_owner = env.keypair();
    let new_operator = env.unique_pubkey();

    let ix = set_roles_ix(
        &env,
        &fixture.treasury,
        &fixture.owner.pubkey(),
        Some(new_owner.pubkey()),
        Some(new_operator),
    );
    let owner = fixture.owner.insecure_clone();
    let result = env.execute(ix, &[&owner]);
    result.assert_success();

    let treasury = env.treasury(&fixture.treasury);
    assert_eq!(treasury.owner, new_owner.pubkey());
    assert_eq!(treasury.operator, new_operator);

    let event: RolesUpdated = emitted_event(&result);
    assert_eq!(event.owner, new_owner.pubkey());
    assert_eq!(event.operator, new_operator);

    // The previous owner is now a stranger. The new owner can keep rotating.
    let stranger_operator = env.unique_pubkey();
    let ix = set_roles_ix(
        &env,
        &fixture.treasury,
        &owner.pubkey(),
        None,
        Some(stranger_operator),
    );
    assert_program_error(&env.execute(ix, &[&owner]), AgentRailsError::Unauthorized);

    let ix = set_roles_ix(
        &env,
        &fixture.treasury,
        &new_owner.pubkey(),
        None,
        Some(fixture.operator),
    );
    env.execute(ix, &[&new_owner]).assert_success();
    assert_eq!(env.treasury(&fixture.treasury).operator, fixture.operator);
}

#[test]
fn set_roles_is_owner_only_and_rejects_the_default_pubkey() {
    let mut env = Env::new();
    let fixture = create_treasury(&mut env, true, true);

    let operator = fixture.operator_key.insecure_clone();
    let ix = set_roles_ix(
        &env,
        &fixture.treasury,
        &operator.pubkey(),
        Some(operator.pubkey()),
        None,
    );
    assert_program_error(
        &env.execute(ix, &[&operator]),
        AgentRailsError::Unauthorized,
    );

    let owner = fixture.owner.insecure_clone();
    let ix = set_roles_ix(
        &env,
        &fixture.treasury,
        &owner.pubkey(),
        Some(Pubkey::default()),
        None,
    );
    assert_program_error(&env.execute(ix, &[&owner]), AgentRailsError::Unauthorized);
    assert_eq!(env.treasury(&fixture.treasury).owner, owner.pubkey());
}

// ---------------------------------------------------------------------------------------
// guardians
// ---------------------------------------------------------------------------------------

#[test]
fn add_and_remove_guardian_maintains_a_dense_prefix() {
    let mut env = Env::new();
    let fixture = create_treasury(&mut env, true, true);
    let first = env.keypair();
    let second = env.keypair();
    let third = env.keypair();

    add_guardian(&mut env, &fixture, first.pubkey());
    add_guardian(&mut env, &fixture, second.pubkey());
    let ix = add_guardian_ix(
        &env,
        &fixture.treasury,
        &fixture.owner.pubkey(),
        third.pubkey(),
    );
    let owner = fixture.owner.insecure_clone();
    let result = env.execute(ix, &[&owner]);
    result.assert_success();

    let event: GuardianAdded = emitted_event(&result);
    assert_eq!(event.guardian, third.pubkey());

    let treasury = env.treasury(&fixture.treasury);
    assert_eq!(treasury.guardian_count, 3);
    assert_eq!(treasury.guardians[0], first.pubkey());
    assert_eq!(treasury.guardians[1], second.pubkey());
    assert_eq!(treasury.guardians[2], third.pubkey());

    // Removing the middle slot compact-fills from the end, so the live prefix stays dense
    // and `is_guardian` never has to skip a default.
    let ix = remove_guardian_ix(&env, &fixture.treasury, &owner.pubkey(), second.pubkey());
    let result = env.execute(ix, &[&owner]);
    result.assert_success();
    let event: GuardianRemoved = emitted_event(&result);
    assert_eq!(event.guardian, second.pubkey());

    let treasury = env.treasury(&fixture.treasury);
    assert_eq!(treasury.guardian_count, 2);
    assert_eq!(treasury.guardians[0], first.pubkey());
    assert_eq!(treasury.guardians[1], third.pubkey());
    assert_eq!(treasury.guardians[2], Pubkey::default());
    assert!(treasury.is_guardian(&first.pubkey()));
    assert!(treasury.is_guardian(&third.pubkey()));
    assert!(!treasury.is_guardian(&second.pubkey()));
}

#[test]
fn add_guardian_rejects_duplicates_defaults_and_a_sixth() {
    let mut env = Env::new();
    let fixture = create_treasury(&mut env, true, true);
    let owner = fixture.owner.insecure_clone();
    let guardian = env.keypair();

    add_guardian(&mut env, &fixture, guardian.pubkey());
    let ix = add_guardian_ix(&env, &fixture.treasury, &owner.pubkey(), guardian.pubkey());
    assert_program_error(
        &env.execute(ix, &[&owner]),
        AgentRailsError::DuplicateGuardian,
    );

    let ix = add_guardian_ix(&env, &fixture.treasury, &owner.pubkey(), Pubkey::default());
    assert_program_error(&env.execute(ix, &[&owner]), AgentRailsError::Unauthorized);

    for _ in 1..MAX_GUARDIANS {
        let extra = env.unique_pubkey();
        add_guardian(&mut env, &fixture, extra);
    }
    assert_eq!(
        env.treasury(&fixture.treasury).guardian_count as usize,
        MAX_GUARDIANS
    );
    let overflow = env.unique_pubkey();
    let ix = add_guardian_ix(&env, &fixture.treasury, &owner.pubkey(), overflow);
    assert_program_error(&env.execute(ix, &[&owner]), AgentRailsError::GuardiansFull);
}

#[test]
fn remove_guardian_is_owner_only_and_needs_a_live_slot() {
    let mut env = Env::new();
    let fixture = create_treasury(&mut env, true, true);
    let guardian = env.keypair();
    add_guardian(&mut env, &fixture, guardian.pubkey());

    let operator = fixture.operator_key.insecure_clone();
    let ix = remove_guardian_ix(
        &env,
        &fixture.treasury,
        &operator.pubkey(),
        guardian.pubkey(),
    );
    assert_program_error(
        &env.execute(ix, &[&operator]),
        AgentRailsError::Unauthorized,
    );

    let owner = fixture.owner.insecure_clone();
    let missing = env.unique_pubkey();
    let ix = remove_guardian_ix(&env, &fixture.treasury, &owner.pubkey(), missing);
    assert_program_error(
        &env.execute(ix, &[&owner]),
        AgentRailsError::GuardianNotFound,
    );
}

// ---------------------------------------------------------------------------------------
// pause / unpause
// ---------------------------------------------------------------------------------------

#[test]
fn owner_and_guardian_can_pause_operator_cannot() {
    let mut env = Env::new();
    let fixture = create_treasury(&mut env, true, true);
    let guardian = env.keypair();
    add_guardian(&mut env, &fixture, guardian.pubkey());

    // The operator is warm and may revoke a session. Freezing the whole treasury is a
    // hot-guardian / cold-owner action; a compromised operator must not hold the switch.
    let operator = fixture.operator_key.insecure_clone();
    let ix = pause_ix(&env, &fixture.treasury, &operator.pubkey());
    assert_program_error(
        &env.execute(ix, &[&operator]),
        AgentRailsError::Unauthorized,
    );
    assert!(!env.treasury(&fixture.treasury).paused);

    let ix = pause_ix(&env, &fixture.treasury, &guardian.pubkey());
    let result = env.execute(ix, &[&guardian]);
    result.assert_success();
    let treasury = env.treasury(&fixture.treasury);
    assert!(treasury.paused);
    assert_eq!(treasury.paused_by, guardian.pubkey());
    assert_eq!(treasury.paused_at, env.now());

    let event: TreasuryPaused = emitted_event(&result);
    assert_eq!(event.by, guardian.pubkey());
    assert_eq!(event.at, env.now());

    // Idempotent: a monitoring bot can hammer pause without inventing a race.
    let ix = pause_ix(&env, &fixture.treasury, &guardian.pubkey());
    env.execute(ix, &[&guardian]).assert_success();
}

#[test]
fn unpause_is_strictly_owner_only() {
    let mut env = Env::new();
    let fixture = create_treasury(&mut env, true, true);
    let guardian = env.keypair();
    add_guardian(&mut env, &fixture, guardian.pubkey());

    let ix = pause_ix(&env, &fixture.treasury, &guardian.pubkey());
    env.execute(ix, &[&guardian]).assert_success();

    let ix = unpause_ix(&env, &fixture.treasury, &guardian.pubkey());
    assert_program_error(
        &env.execute(ix, &[&guardian]),
        AgentRailsError::Unauthorized,
    );

    let operator = fixture.operator_key.insecure_clone();
    let ix = unpause_ix(&env, &fixture.treasury, &operator.pubkey());
    assert_program_error(
        &env.execute(ix, &[&operator]),
        AgentRailsError::Unauthorized,
    );
    assert!(env.treasury(&fixture.treasury).paused);

    let ix = unpause_ix(&env, &fixture.treasury, &fixture.owner.pubkey());
    let owner = fixture.owner.insecure_clone();
    let result = env.execute(ix, &[&owner]);
    result.assert_success();
    assert!(!env.treasury(&fixture.treasury).paused);

    let event: TreasuryUnpaused = emitted_event(&result);
    assert_eq!(event.by, owner.pubkey());

    // The last pauser's record is historical, not a live lock: unpause does not rewrite it.
    let treasury = env.treasury(&fixture.treasury);
    assert!(!treasury.paused);
    assert_eq!(treasury.paused_by, guardian.pubkey());
}

#[test]
fn pause_stops_payments_and_unpause_restores_them() {
    let mut env = Env::new();
    let (fixture, mint) = treasury_with_mint(&mut env);
    fund_spl(&mut env, &fixture, mint, VAULT_AMOUNT);
    let policy = create_policy(
        &mut env,
        &fixture,
        padded_name("default"),
        permissive_policy_args(mint),
    );
    let session = create_session(&mut env, &fixture, &policy, SESSION_TTL);
    let destination = env.unique_pubkey();
    let fee_payer = env.keypair();
    create_destination_ata(
        &mut env,
        &fee_payer,
        &destination,
        &mint,
        token_program_id(),
    );

    pause(&mut env, &fixture);
    let paused_intent = intent(&mut env, mint, destination, PAYMENT);
    let ix = execute_payment_ix(
        &env,
        &fixture,
        &session,
        &fee_payer.pubkey(),
        token_program_id(),
        None,
        &paused_intent,
    );
    assert_program_error(
        &env.execute(ix, &[&fee_payer, &session.session_key]),
        AgentRailsError::Paused,
    );

    unpause(&mut env, &fixture);
    let live_intent = intent(&mut env, mint, destination, PAYMENT);
    let ix = execute_payment_ix(
        &env,
        &fixture,
        &session,
        &fee_payer.pubkey(),
        token_program_id(),
        None,
        &live_intent,
    );
    env.execute(ix, &[&fee_payer, &session.session_key])
        .assert_success();
}

// ---------------------------------------------------------------------------------------
// withdraw
// ---------------------------------------------------------------------------------------

#[test]
fn withdraw_spl_while_paused() {
    let mut env = Env::new();
    let (fixture, mint) = treasury_with_mint(&mut env);
    fund_spl(&mut env, &fixture, mint, VAULT_AMOUNT);
    pause(&mut env, &fixture);

    let destination = env.unique_pubkey();
    let owner = fixture.owner.insecure_clone();
    let dest_ata =
        create_destination_ata(&mut env, &owner, &destination, &mint, token_program_id());
    let vault = vault_ata(&fixture.treasury, &mint, &token_program_id());
    let before = token_balance(&env, &vault);

    let ix = withdraw_ix(
        &env,
        &fixture,
        &owner.pubkey(),
        mint,
        PAYMENT,
        dest_ata,
        Some((vault, token_program_id())),
    );
    let result = env.execute(ix, &[&owner]);
    result.assert_success();

    assert_eq!(token_balance(&env, &vault), before - PAYMENT);
    assert_eq!(token_balance(&env, &dest_ata), PAYMENT);
    assert!(env.treasury(&fixture.treasury).paused);

    let event: Withdrawn = emitted_event(&result);
    assert_eq!(event.mint, mint);
    assert_eq!(event.amount, PAYMENT);
    assert_eq!(event.destination, dest_ata);
    assert_eq!(event.by, owner.pubkey());
}

#[test]
fn withdraw_native_sol_keeps_the_rent_floor() {
    let mut env = Env::new();
    let fixture = create_treasury(&mut env, true, true);
    deposit_sol(&mut env, &fixture.sol_vault, SOL_DEPOSIT);

    let destination = env.keypair();
    let dest_before = env.lamports(&destination.pubkey());
    let floor = env.lamports(&fixture.sol_vault) - SOL_DEPOSIT;
    let owner = fixture.owner.insecure_clone();

    let ix = withdraw_ix(
        &env,
        &fixture,
        &owner.pubkey(),
        NATIVE_MINT,
        SOL_DEPOSIT,
        destination.pubkey(),
        None,
    );
    env.execute(ix, &[&owner]).assert_success();

    assert_eq!(env.lamports(&fixture.sol_vault), floor);
    assert_eq!(
        env.lamports(&destination.pubkey()),
        dest_before + SOL_DEPOSIT
    );

    let ix = withdraw_ix(
        &env,
        &fixture,
        &owner.pubkey(),
        NATIVE_MINT,
        1,
        destination.pubkey(),
        None,
    );
    assert_program_error(
        &env.execute(ix, &[&owner]),
        AgentRailsError::InsufficientVaultBalance,
    );
}

#[test]
fn withdraw_is_owner_only_and_rejects_zero() {
    let mut env = Env::new();
    let (fixture, mint) = treasury_with_mint(&mut env);
    fund_spl(&mut env, &fixture, mint, VAULT_AMOUNT);
    let owner = fixture.owner.insecure_clone();
    let destination = env.unique_pubkey();
    let dest_ata =
        create_destination_ata(&mut env, &owner, &destination, &mint, token_program_id());
    let vault = vault_ata(&fixture.treasury, &mint, &token_program_id());

    let operator = fixture.operator_key.insecure_clone();
    let ix = withdraw_ix(
        &env,
        &fixture,
        &operator.pubkey(),
        mint,
        PAYMENT,
        dest_ata,
        Some((vault, token_program_id())),
    );
    assert_program_error(
        &env.execute(ix, &[&operator]),
        AgentRailsError::Unauthorized,
    );

    let guardian = env.keypair();
    add_guardian(&mut env, &fixture, guardian.pubkey());
    let ix = withdraw_ix(
        &env,
        &fixture,
        &guardian.pubkey(),
        mint,
        PAYMENT,
        dest_ata,
        Some((vault, token_program_id())),
    );
    assert_program_error(
        &env.execute(ix, &[&guardian]),
        AgentRailsError::Unauthorized,
    );

    let ix = withdraw_ix(
        &env,
        &fixture,
        &owner.pubkey(),
        mint,
        0,
        dest_ata,
        Some((vault, token_program_id())),
    );
    assert_program_error(&env.execute(ix, &[&owner]), AgentRailsError::AmountZero);
}

#[test]
fn withdraw_rescues_an_unconfigured_mint_vault() {
    let mut env = Env::new();
    let (fixture, mint) = treasury_with_mint(&mut env);
    fund_spl(&mut env, &fixture, mint, VAULT_AMOUNT);
    let owner = fixture.owner.insecure_clone();
    let vault = vault_ata(&fixture.treasury, &mint, &token_program_id());

    // Drain via withdraw, delist, then someone airdrops back onto the surviving ATA.
    // `withdraw` must still reach those tokens: requiring a configured slot would trap
    // them, which is the whole reason the instruction does not consult `Treasury.mints`.
    let destination = env.unique_pubkey();
    let dest_ata =
        create_destination_ata(&mut env, &owner, &destination, &mint, token_program_id());
    let ix = withdraw_ix(
        &env,
        &fixture,
        &owner.pubkey(),
        mint,
        VAULT_AMOUNT,
        dest_ata,
        Some((vault, token_program_id())),
    );
    env.execute(ix, &[&owner]).assert_success();

    let ix = remove_mint_ix(&env, &fixture, &owner.pubkey(), mint, Some(vault));
    env.execute(ix, &[&owner]).assert_success();
    assert!(env.treasury(&fixture.treasury).find_mint(&mint).is_none());

    fund_spl(&mut env, &fixture, mint, PAYMENT);
    let ix = withdraw_ix(
        &env,
        &fixture,
        &owner.pubkey(),
        mint,
        PAYMENT,
        dest_ata,
        Some((vault, token_program_id())),
    );
    env.execute(ix, &[&owner]).assert_success();
    assert_eq!(token_balance(&env, &vault), 0);
    assert_eq!(token_balance(&env, &dest_ata), VAULT_AMOUNT + PAYMENT);
}

// ---------------------------------------------------------------------------------------
// close_treasury
// ---------------------------------------------------------------------------------------

#[test]
fn close_treasury_drains_the_sol_vault_floor_and_closes() {
    let mut env = Env::new();
    let fixture = create_treasury(&mut env, true, true);
    let rent_destination = env.keypair();
    let dest_before = env.lamports(&rent_destination.pubkey());
    let floor = env.lamports(&fixture.sol_vault);
    let treasury_rent = env.lamports(&fixture.treasury);

    let ix = close_treasury_ix(
        &env,
        &fixture,
        &fixture.owner.pubkey(),
        &rent_destination.pubkey(),
    );
    let owner = fixture.owner.insecure_clone();
    let result = env.execute(ix, &[&owner]);
    result.assert_success();

    assert!(!account_exists(&env, &fixture.treasury));
    let event: TreasuryClosed = emitted_event(&result);
    assert_eq!(event.treasury, fixture.treasury);

    // Floor + treasury rent land on the destination. The sol_vault PDA is empty and
    // reclaimed by the runtime.
    assert_eq!(
        env.lamports(&rent_destination.pubkey()),
        dest_before + floor + treasury_rent
    );
}

#[test]
fn close_treasury_refuses_outstanding_mints_policies_sessions_and_sol() {
    let mut env = Env::new();
    let (fixture, mint) = treasury_with_mint(&mut env);
    let owner = fixture.owner.insecure_clone();
    let rent_destination = env.unique_pubkey();

    let ix = close_treasury_ix(&env, &fixture, &owner.pubkey(), &rent_destination);
    assert_program_error(
        &env.execute(ix, &[&owner]),
        AgentRailsError::TreasuryNotEmpty,
    );

    // Empty the unused vault and delist; a live policy still blocks.
    let vault = vault_ata(&fixture.treasury, &mint, &token_program_id());
    let policy = create_policy(
        &mut env,
        &fixture,
        padded_name("p"),
        permissive_policy_args(mint),
    );
    let ix = remove_mint_ix(&env, &fixture, &owner.pubkey(), mint, Some(vault));
    assert_program_error(
        &env.execute(ix, &[&owner]),
        AgentRailsError::TreasuryNotEmpty,
    );

    let session = create_session(&mut env, &fixture, &policy, SESSION_TTL);
    let ix = close_policy_ix(
        &env,
        &fixture.treasury,
        &owner.pubkey(),
        &policy,
        &rent_destination,
    );
    assert_program_error(&env.execute(ix, &[&owner]), AgentRailsError::PolicyInUse);

    let ix = revoke_session_ix(
        &env,
        &fixture.treasury,
        &owner.pubkey(),
        &policy,
        &session.session,
    );
    env.execute(ix, &[&owner]).assert_success();
    let ix = close_session_ix(
        &env,
        &fixture.treasury,
        &owner.pubkey(),
        &policy,
        &session.session,
        &rent_destination,
    );
    env.execute(ix, &[&owner]).assert_success();
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

    deposit_sol(&mut env, &fixture.sol_vault, 1_000_000);
    let ix = close_treasury_ix(&env, &fixture, &owner.pubkey(), &rent_destination);
    assert_program_error(
        &env.execute(ix, &[&owner]),
        AgentRailsError::TreasuryNotEmpty,
    );

    let ix = withdraw_ix(
        &env,
        &fixture,
        &owner.pubkey(),
        NATIVE_MINT,
        1_000_000,
        rent_destination,
        None,
    );
    env.execute(ix, &[&owner]).assert_success();

    let ix = close_treasury_ix(&env, &fixture, &owner.pubkey(), &rent_destination);
    env.execute(ix, &[&owner]).assert_success();
    assert!(!account_exists(&env, &fixture.treasury));
}

#[test]
fn close_treasury_is_owner_only() {
    let mut env = Env::new();
    let fixture = create_treasury(&mut env, true, true);
    let operator = fixture.operator_key.insecure_clone();
    let rent_destination = env.unique_pubkey();
    let ix = close_treasury_ix(&env, &fixture, &operator.pubkey(), &rent_destination);
    assert_program_error(
        &env.execute(ix, &[&operator]),
        AgentRailsError::Unauthorized,
    );
}

// ---------------------------------------------------------------------------------------
// close_receipt
// ---------------------------------------------------------------------------------------

#[test]
fn close_receipt_refunds_the_recorded_fee_payer_after_grace() {
    let mut env = Env::new();
    let (fixture, mint) = treasury_with_mint(&mut env);
    fund_spl(&mut env, &fixture, mint, VAULT_AMOUNT);
    let policy = create_policy(
        &mut env,
        &fixture,
        padded_name("default"),
        permissive_policy_args(mint),
    );
    let session = create_session(&mut env, &fixture, &policy, SESSION_TTL);
    let destination = env.unique_pubkey();
    let fee_payer = env.keypair();
    create_destination_ata(
        &mut env,
        &fee_payer,
        &destination,
        &mint,
        token_program_id(),
    );

    let payment = intent(&mut env, mint, destination, PAYMENT);
    let receipt = receipt_pda(&session.session, &payment.intent_id).0;
    let ix = execute_payment_ix(
        &env,
        &fixture,
        &session,
        &fee_payer.pubkey(),
        token_program_id(),
        None,
        &payment,
    );
    env.execute(ix, &[&fee_payer, &session.session_key])
        .assert_success();

    let closer = env.keypair();
    let too_early = close_receipt_ix(&env, &receipt, &closer.pubkey(), &fee_payer.pubkey());
    assert_program_error(
        &env.execute(too_early, &[&closer]),
        AgentRailsError::ReceiptNotExpired,
    );

    // The receipt outlives the intent by exactly the grace period, so the original
    // blockhash window is closed before the PDA can be reused.
    let wait = (payment.expires_at - env.now()) + RECEIPT_GRACE_SECONDS + 1;
    env.warp_seconds(wait);

    let fee_before = env.lamports(&fee_payer.pubkey());
    let receipt_rent = env.lamports(&receipt);
    let ix = close_receipt_ix(&env, &receipt, &closer.pubkey(), &fee_payer.pubkey());
    let result = env.execute(ix, &[&closer]);
    result.assert_success();

    assert!(!account_exists(&env, &receipt));
    assert_eq!(env.lamports(&fee_payer.pubkey()), fee_before + receipt_rent);

    let event: ReceiptClosed = emitted_event(&result);
    assert_eq!(event.session, session.session);
    assert_eq!(event.intent_id, payment.intent_id);
    assert_eq!(event.receipt, receipt);
    assert_eq!(event.treasury, Pubkey::default());
}

#[test]
fn close_receipt_refuses_a_substituted_fee_payer() {
    let mut env = Env::new();
    let (fixture, mint) = treasury_with_mint(&mut env);
    fund_spl(&mut env, &fixture, mint, VAULT_AMOUNT);
    let policy = create_policy(
        &mut env,
        &fixture,
        padded_name("default"),
        permissive_policy_args(mint),
    );
    let session = create_session(&mut env, &fixture, &policy, SESSION_TTL);
    let destination = env.unique_pubkey();
    let fee_payer = env.keypair();
    create_destination_ata(
        &mut env,
        &fee_payer,
        &destination,
        &mint,
        token_program_id(),
    );

    let payment = intent(&mut env, mint, destination, PAYMENT);
    let receipt = receipt_pda(&session.session, &payment.intent_id).0;
    let ix = execute_payment_ix(
        &env,
        &fixture,
        &session,
        &fee_payer.pubkey(),
        token_program_id(),
        None,
        &payment,
    );
    env.execute(ix, &[&fee_payer, &session.session_key])
        .assert_success();

    env.warp_seconds((payment.expires_at - env.now()) + RECEIPT_GRACE_SECONDS + 1);

    let thief = env.keypair();
    let ix = close_receipt_ix(&env, &receipt, &thief.pubkey(), &thief.pubkey());
    assert_program_error(&env.execute(ix, &[&thief]), AgentRailsError::Unauthorized);
    assert!(account_exists(&env, &receipt));
}
