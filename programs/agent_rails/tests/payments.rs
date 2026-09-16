//! `execute_payment` and `execute_payment_sol` against LiteSVM (spec §5.3).
//!
//! The three things these tests exist to prove, in order of importance:
//!
//! 1. A payment that satisfies the policy moves exactly the right amount, and leaves behind
//!    a receipt and an audit-chain link that an off-chain verifier can reproduce.
//! 2. The same `intent_id` can never pay twice. This is the agent-retry threat (ADR-004),
//!    and the guarantee is structural: the receipt PDA already exists.
//! 3. A payment that violates the policy fails cleanly, with the spec §9 code the SDK maps
//!    to a `reason_code`, and changes nothing.
//!
//! Everything else here is the adversarial surface around those three.

mod common;

use anchor_litesvm::{Keypair, Pubkey, Signer};

use agent_rails::args::{MintLimitInput, PolicyInput};
use agent_rails::constants::{MAX_MEMO_LEN, NATIVE_MINT};
use agent_rails::events::PaymentExecuted;
use agent_rails::state::MintLimit;
use agent_rails::AgentRailsError;

use common::*;

/// 6 decimals, like USDC, so amounts read as they would in production.
const MINT_DECIMALS: u8 = 6;
const VAULT_AMOUNT: u64 = 500_000_000;
const PAYMENT: u64 = 1_500_000;
/// Long enough that no test expires a session by accident.
const SESSION_TTL: i64 = 86_400;

// ---------------------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------------------

/// The knobs the payment tests actually vary. Everything else is fixed at the permissive
/// value so that a failing test names its own cause.
struct SplConfig {
    allow_any_destination: bool,
    allow_create_destination_ata: bool,
    destination_mode: u8,
    require_memo: bool,
    policy_creates_ata: bool,
    precreate_destination_ata: bool,
    vault_amount: u64,
    /// A limit built through `create_policy`, so it must fit under the ceiling.
    limit: Option<MintLimitInput>,
    token_program: Pubkey,
}

impl Default for SplConfig {
    fn default() -> Self {
        Self {
            allow_any_destination: true,
            allow_create_destination_ata: true,
            destination_mode: 0,
            require_memo: false,
            policy_creates_ata: false,
            precreate_destination_ata: true,
            vault_amount: VAULT_AMOUNT,
            limit: None,
            token_program: token_program_id(),
        }
    }
}

struct SplFixture {
    treasury: TreasuryFixture,
    mint: Pubkey,
    token_program: Pubkey,
    limit: MintLimit,
    policy: Pubkey,
    session: SessionFixture,
    destination: Pubkey,
    destination_ata: Pubkey,
    vault: Pubkey,
    fee_payer: Keypair,
}

/// Treasury with one configured mint, a funded vault, a policy and session created through
/// their real instructions, and a destination wallet.
fn spl_fixture(env: &mut Env, config: SplConfig) -> SplFixture {
    let treasury = create_treasury(
        env,
        config.allow_any_destination,
        config.allow_create_destination_ata,
    );
    let mint_authority = treasury.owner.insecure_clone();

    let mint = if config.token_program == token_2022_program_id() {
        create_token_2022_plain(env, &mint_authority, MINT_DECIMALS)
    } else {
        create_spl_token_mint(env, &mint_authority, MINT_DECIMALS)
    };
    add_spl_mint(
        env,
        &treasury,
        mint,
        config.token_program,
        permissive_ceiling(),
    );
    fund_vault(
        env,
        &treasury.treasury,
        &mint,
        &mint_authority,
        config.token_program,
        config.vault_amount,
    );

    let mut args = permissive_policy_args(mint);
    if let Some(mut limit) = config.limit {
        limit.mint = mint;
        args.mint_limits = vec![limit];
    }
    args.destination_mode = config.destination_mode;
    args.require_memo = config.require_memo;
    args.create_destination_ata = config.policy_creates_ata;

    let policy = create_policy(env, &treasury, padded_name("default"), args);
    let limit = policy_account(env, &policy).mint_limits[0];
    let session = create_session(env, &treasury, &policy, SESSION_TTL);

    let destination = env.unique_pubkey();
    let fee_payer = env.keypair();
    let destination_ata = if config.precreate_destination_ata {
        create_destination_ata(env, &fee_payer, &destination, &mint, config.token_program)
    } else {
        anchor_spl::associated_token::get_associated_token_address_with_program_id(
            &destination,
            &mint,
            &config.token_program,
        )
    };

    SplFixture {
        vault: vault_ata(&treasury.treasury, &mint, &config.token_program),
        treasury,
        mint,
        token_program: config.token_program,
        limit,
        policy,
        session,
        destination,
        destination_ata,
        fee_payer,
    }
}

struct SolFixture {
    treasury: TreasuryFixture,
    limit: MintLimit,
    session: SessionFixture,
    destination: Pubkey,
    fee_payer: Keypair,
}

/// Treasury with the native mint configured and `sol_vault` funded above the rent floor.
fn sol_fixture(env: &mut Env, deposit: u64, destination_mode: u8) -> SolFixture {
    let treasury = create_treasury(env, true, true);
    add_native_mint(env, &treasury, permissive_ceiling());

    // Deposits have no instruction: SOL arrives by plain transfer (spec §5.4).
    let funder = env.keypair();
    let ix = anchor_lang::solana_program::system_instruction::transfer(
        &funder.pubkey(),
        &treasury.sol_vault,
        deposit,
    );
    env.execute(ix, &[&funder]).assert_success();

    let mut args = permissive_policy_args(NATIVE_MINT);
    args.destination_mode = destination_mode;
    let policy = create_policy(env, &treasury, padded_name("native"), args);
    let limit = policy_account(env, &policy).mint_limits[0];
    let session = create_session(env, &treasury, &policy, SESSION_TTL);

    SolFixture {
        treasury,
        limit,
        session,
        destination: env.unique_pubkey(),
        fee_payer: env.keypair(),
    }
}

// ---------------------------------------------------------------------------------------
// 1. The happy path
// ---------------------------------------------------------------------------------------

#[test]
fn execute_payment_moves_tokens_and_records_the_receipt() {
    let mut env = Env::new();
    let f = spl_fixture(&mut env, SplConfig::default());

    let intent = intent(&mut env, f.mint, f.destination, PAYMENT);
    let ix = execute_payment_ix(
        &env,
        &f.treasury,
        &f.session,
        &f.fee_payer.pubkey(),
        f.token_program,
        None,
        &intent,
    );
    let result = env.execute(ix, &[&f.fee_payer, &f.session.session_key]);
    result.assert_success();

    assert_eq!(token_balance(&env, &f.vault), VAULT_AMOUNT - PAYMENT);
    assert_eq!(token_balance(&env, &f.destination_ata), PAYMENT);

    let receipt_address = receipt_pda(&f.session.session, &intent.intent_id).0;
    let receipt = receipt_account(&env, &receipt_address);
    assert_eq!(receipt.session, f.session.session);
    assert_eq!(receipt.intent_id, intent.intent_id);
    assert_eq!(receipt.mint, f.mint);
    assert_eq!(receipt.destination_owner, f.destination);
    assert_eq!(receipt.amount, PAYMENT);
    assert_eq!(
        receipt.seq, 1,
        "the first payment of a session commits seq 1"
    );
    assert_eq!(receipt.expires_at, intent.expires_at);
    assert_eq!(
        receipt.status,
        agent_rails::constants::ReceiptStatus::EXECUTED
    );
    assert_eq!(receipt.fee_payer, f.fee_payer.pubkey());
    assert_eq!(receipt.memo_hash, [0u8; 32], "an empty memo hashes to zero");
    assert_eq!(receipt.reserved, [0u8; 16]);

    let session = session_account(&env, &f.session.session);
    assert_eq!(session.seq, 1);
    let counter = session.spend[session.find_counter(&f.mint).expect("counter")];
    assert_eq!(counter.short_spent, PAYMENT);
    assert_eq!(counter.long_spent, PAYMENT);
    assert_eq!(counter.lifetime_spent, PAYMENT);
    assert_eq!(counter.last_payment_at, receipt.timestamp);

    // The chain link the indexer will recompute from the event alone.
    let expected_head = agent_rails_policy::next_audit_head(
        &f.session.genesis_head,
        1,
        &intent.intent_id,
        &f.mint.to_bytes(),
        &f.destination.to_bytes(),
        PAYMENT,
        receipt.slot,
    );
    assert_eq!(session.audit_head, expected_head);

    let event: PaymentExecuted = emitted_event(&result);
    assert_eq!(event.treasury, f.treasury.treasury);
    assert_eq!(event.session, f.session.session);
    assert_eq!(event.seq, 1);
    assert_eq!(event.audit_head, expected_head);
    assert_eq!(event.intent_id, intent.intent_id);
    assert_eq!(event.amount, PAYMENT);
    assert_eq!(event.receipt, receipt_address);
    assert_eq!(event.slot, receipt.slot);
}

#[test]
fn execute_payment_sol_moves_lamports_and_records_the_receipt() {
    let mut env = Env::new();
    let deposit = 5_000_000_000;
    let f = sol_fixture(&mut env, deposit, 0);

    let vault_before = env.lamports(&f.treasury.sol_vault);
    let intent = intent(&mut env, NATIVE_MINT, f.destination, PAYMENT);
    let ix = execute_payment_sol_ix(
        &env,
        &f.treasury,
        &f.session,
        &f.fee_payer.pubkey(),
        None,
        &intent,
    );
    let result = env.execute(ix, &[&f.fee_payer, &f.session.session_key]);
    result.assert_success();

    assert_eq!(env.lamports(&f.treasury.sol_vault), vault_before - PAYMENT);
    assert_eq!(env.lamports(&f.destination), PAYMENT);

    let receipt = receipt_account(&env, &receipt_pda(&f.session.session, &intent.intent_id).0);
    assert_eq!(receipt.mint, NATIVE_MINT);
    assert_eq!(receipt.amount, PAYMENT);
    assert_eq!(receipt.seq, 1);

    let session = session_account(&env, &f.session.session);
    assert_eq!(session.seq, 1);
    assert_eq!(
        session.audit_head,
        agent_rails_policy::next_audit_head(
            &f.session.genesis_head,
            1,
            &intent.intent_id,
            &NATIVE_MINT.to_bytes(),
            &f.destination.to_bytes(),
            PAYMENT,
            receipt.slot,
        )
    );
}

#[test]
fn the_audit_chain_survives_a_second_payment() {
    let mut env = Env::new();
    let f = spl_fixture(&mut env, SplConfig::default());

    let mut head = f.session.genesis_head;
    for seq in 1..=2u64 {
        let intent = intent(&mut env, f.mint, f.destination, PAYMENT);
        let ix = execute_payment_ix(
            &env,
            &f.treasury,
            &f.session,
            &f.fee_payer.pubkey(),
            f.token_program,
            None,
            &intent,
        );
        env.execute(ix, &[&f.fee_payer, &f.session.session_key])
            .assert_success();

        let receipt = receipt_account(&env, &receipt_pda(&f.session.session, &intent.intent_id).0);
        assert_eq!(receipt.seq, seq);
        head = agent_rails_policy::next_audit_head(
            &head,
            seq,
            &intent.intent_id,
            &f.mint.to_bytes(),
            &f.destination.to_bytes(),
            PAYMENT,
            receipt.slot,
        );
    }

    let session = session_account(&env, &f.session.session);
    assert_eq!(session.seq, 2);
    assert_eq!(
        session.audit_head, head,
        "replayed chain must match on-chain head"
    );
    let counter = session.spend[session.find_counter(&f.mint).expect("counter")];
    assert_eq!(counter.lifetime_spent, PAYMENT * 2);
}

#[test]
fn execute_payment_creates_the_destination_ata_when_the_policy_allows_it() {
    let mut env = Env::new();
    let f = spl_fixture(
        &mut env,
        SplConfig {
            policy_creates_ata: true,
            precreate_destination_ata: false,
            ..SplConfig::default()
        },
    );
    assert!(
        env.ctx.svm.get_account(&f.destination_ata).is_none()
            || env.account_data(&f.destination_ata).is_empty(),
        "the destination ATA must not exist yet"
    );

    let intent = intent(&mut env, f.mint, f.destination, PAYMENT);
    let ix = execute_payment_ix(
        &env,
        &f.treasury,
        &f.session,
        &f.fee_payer.pubkey(),
        f.token_program,
        None,
        &intent,
    );
    let result = env.execute(ix, &[&f.fee_payer, &f.session.session_key]);
    result.assert_success();

    assert_eq!(token_balance(&env, &f.destination_ata), PAYMENT);
}

#[test]
fn execute_payment_pays_a_token_2022_mint() {
    let mut env = Env::new();
    let f = spl_fixture(
        &mut env,
        SplConfig {
            token_program: token_2022_program_id(),
            ..SplConfig::default()
        },
    );

    let intent = intent(&mut env, f.mint, f.destination, PAYMENT);
    let ix = execute_payment_ix(
        &env,
        &f.treasury,
        &f.session,
        &f.fee_payer.pubkey(),
        f.token_program,
        None,
        &intent,
    );
    let result = env.execute(ix, &[&f.fee_payer, &f.session.session_key]);
    result.assert_success();

    assert_eq!(token_balance(&env, &f.destination_ata), PAYMENT);
}

// ---------------------------------------------------------------------------------------
// 2. Idempotency
// ---------------------------------------------------------------------------------------

#[test]
fn a_replayed_intent_id_cannot_pay_twice() {
    let mut env = Env::new();
    let f = spl_fixture(&mut env, SplConfig::default());

    // The exact intent an agent would resubmit after a timed-out tool call: same id, same
    // everything, fresh blockhash. `Env::execute` expires the blockhash between sends, so
    // the runtime's own duplicate-transaction check is not what rejects this.
    let intent = intent(&mut env, f.mint, f.destination, PAYMENT);
    let build = |env: &Env| {
        execute_payment_ix(
            env,
            &f.treasury,
            &f.session,
            &f.fee_payer.pubkey(),
            f.token_program,
            None,
            &intent,
        )
    };

    let first = build(&env);
    env.execute(first, &[&f.fee_payer, &f.session.session_key])
        .assert_success();

    let vault_after_first = token_balance(&env, &f.vault);
    let session_after_first = session_account(&env, &f.session.session);

    let retry = build(&env);
    let replay = env.execute(retry, &[&f.fee_payer, &f.session.session_key]);
    replay.assert_failure();

    // The receipt PDA already exists, so account creation is what fails — inside the System
    // program, before any transfer and before a single policy check runs. The surfaced code
    // is `SystemError::AccountAlreadyInUse` (custom 0), which the SDK maps to
    // `DUPLICATE_INTENT` (spec §9).
    assert!(
        replay
            .logs()
            .iter()
            .any(|log| log.contains("already in use")),
        "expected the receipt allocation to fail as already-in-use, got: {:?}\nLogs:\n{}",
        replay.error(),
        replay.logs().join("\n")
    );
    assert!(
        replay
            .error()
            .expect("replay must fail")
            .contains("Custom(0)"),
        "expected SystemError::AccountAlreadyInUse, got: {:?}",
        replay.error()
    );

    assert_eq!(token_balance(&env, &f.vault), vault_after_first);
    assert_eq!(token_balance(&env, &f.destination_ata), PAYMENT);
    let session_after_replay = session_account(&env, &f.session.session);
    assert_eq!(session_after_replay.seq, session_after_first.seq);
    assert_eq!(
        session_after_replay.audit_head,
        session_after_first.audit_head
    );
    assert_eq!(session_after_replay.spend, session_after_first.spend);
}

#[test]
fn a_replayed_intent_id_cannot_pay_twice_in_sol() {
    let mut env = Env::new();
    let f = sol_fixture(&mut env, 5_000_000_000, 0);

    let intent = intent(&mut env, NATIVE_MINT, f.destination, PAYMENT);
    let build = |env: &Env| {
        execute_payment_sol_ix(
            env,
            &f.treasury,
            &f.session,
            &f.fee_payer.pubkey(),
            None,
            &intent,
        )
    };

    let first = build(&env);
    env.execute(first, &[&f.fee_payer, &f.session.session_key])
        .assert_success();
    let vault_after_first = env.lamports(&f.treasury.sol_vault);

    let retry = build(&env);
    env.execute(retry, &[&f.fee_payer, &f.session.session_key])
        .assert_failure();

    assert_eq!(env.lamports(&f.treasury.sol_vault), vault_after_first);
    assert_eq!(env.lamports(&f.destination), PAYMENT);
    assert_eq!(session_account(&env, &f.session.session).seq, 1);
}

#[test]
fn a_different_intent_id_for_the_same_payment_is_allowed() {
    let mut env = Env::new();
    let f = spl_fixture(&mut env, SplConfig::default());

    // Idempotency is keyed on the intent id, not on the payment's contents: paying the same
    // vendor the same amount twice on purpose has to keep working.
    for _ in 0..2 {
        let intent = intent(&mut env, f.mint, f.destination, PAYMENT);
        let ix = execute_payment_ix(
            &env,
            &f.treasury,
            &f.session,
            &f.fee_payer.pubkey(),
            f.token_program,
            None,
            &intent,
        );
        env.execute(ix, &[&f.fee_payer, &f.session.session_key])
            .assert_success();
    }

    assert_eq!(token_balance(&env, &f.destination_ata), PAYMENT * 2);
}

// ---------------------------------------------------------------------------------------
// 3. Policy rejection
// ---------------------------------------------------------------------------------------

/// Runs one SPL payment and asserts it failed with `expected`, leaving no trace.
fn assert_spl_payment_rejected(
    env: &mut Env,
    f: &SplFixture,
    intent: &agent_rails::PaymentIntent,
    allowlist_entry: Option<Pubkey>,
    expected: AgentRailsError,
) {
    let vault_before = token_balance(env, &f.vault);
    let session_before = session_account(env, &f.session.session);

    let ix = execute_payment_ix(
        env,
        &f.treasury,
        &f.session,
        &f.fee_payer.pubkey(),
        f.token_program,
        allowlist_entry,
        intent,
    );
    let result = env.execute(ix, &[&f.fee_payer, &f.session.session_key]);
    assert_program_error(&result, expected);

    assert_eq!(token_balance(env, &f.vault), vault_before);
    let session_after = session_account(env, &f.session.session);
    assert_eq!(session_after.seq, session_before.seq);
    assert_eq!(session_after.audit_head, session_before.audit_head);
    assert_eq!(session_after.spend, session_before.spend);
    assert!(
        env.ctx
            .svm
            .get_account(&receipt_pda(&f.session.session, &intent.intent_id).0)
            .is_none(),
        "a rejected payment must not leave a receipt behind"
    );
}

#[test]
fn a_payment_above_the_per_transaction_cap_is_rejected() {
    let mut env = Env::new();
    let f = spl_fixture(&mut env, SplConfig::default());

    let intent = intent(&mut env, f.mint, f.destination, f.limit.per_tx_max + 1);
    assert_spl_payment_rejected(
        &mut env,
        &f,
        &intent,
        None,
        AgentRailsError::ExceedsPerTxMax,
    );
}

#[test]
fn a_payment_that_would_break_the_short_window_is_rejected() {
    let mut env = Env::new();
    // A bucket that two payments of `PAYMENT` overrun but one does not, so the rejection is
    // unambiguously the window and not the per-transaction cap.
    let mut limit = permissive_limit_args(Pubkey::default());
    limit.per_tx_max = PAYMENT;
    limit.short_window_max = PAYMENT + PAYMENT / 2;

    let f = spl_fixture(
        &mut env,
        SplConfig {
            limit: Some(limit),
            ..SplConfig::default()
        },
    );
    let first = intent(&mut env, f.mint, f.destination, PAYMENT);
    let ix = execute_payment_ix(
        &env,
        &f.treasury,
        &f.session,
        &f.fee_payer.pubkey(),
        f.token_program,
        None,
        &first,
    );
    env.execute(ix, &[&f.fee_payer, &f.session.session_key])
        .assert_success();

    let second = intent(&mut env, f.mint, f.destination, PAYMENT);
    assert_spl_payment_rejected(
        &mut env,
        &f,
        &second,
        None,
        AgentRailsError::ExceedsShortWindow,
    );
}

#[test]
fn a_payment_above_the_session_lifetime_is_rejected() {
    let mut env = Env::new();
    let mut limit = permissive_limit_args(Pubkey::default());
    limit.lifetime_max = PAYMENT;
    let f = spl_fixture(
        &mut env,
        SplConfig {
            limit: Some(limit),
            ..SplConfig::default()
        },
    );

    let first = intent(&mut env, f.mint, f.destination, PAYMENT);
    let ix = execute_payment_ix(
        &env,
        &f.treasury,
        &f.session,
        &f.fee_payer.pubkey(),
        f.token_program,
        None,
        &first,
    );
    env.execute(ix, &[&f.fee_payer, &f.session.session_key])
        .assert_success();

    let second = intent(&mut env, f.mint, f.destination, 1);
    assert_spl_payment_rejected(
        &mut env,
        &f,
        &second,
        None,
        AgentRailsError::ExceedsLifetime,
    );
}

#[test]
fn a_zero_amount_payment_is_rejected() {
    let mut env = Env::new();
    let f = spl_fixture(&mut env, SplConfig::default());
    let intent = intent(&mut env, f.mint, f.destination, 0);
    assert_spl_payment_rejected(&mut env, &f, &intent, None, AgentRailsError::AmountZero);
}

#[test]
fn a_policy_that_now_exceeds_its_ceiling_stops_paying() {
    let mut env = Env::new();
    let f = spl_fixture(&mut env, SplConfig::default());

    // `set_ceiling` deliberately leaves live policies alone (spec §5.1), so the step-9
    // re-check is the only thing between a lowered ceiling and an over-limit payment.
    let mut tightened = permissive_ceiling();
    tightened.max_per_tx = PAYMENT / 2;
    set_ceiling(&mut env, &f.treasury, f.mint, tightened);

    let intent = intent(&mut env, f.mint, f.destination, PAYMENT);
    assert_spl_payment_rejected(
        &mut env,
        &f,
        &intent,
        None,
        AgentRailsError::PolicyExceedsCeiling,
    );
}

#[test]
fn an_open_destination_policy_stops_when_the_owner_revokes_the_ceiling_flag() {
    let mut env = Env::new();
    let f = spl_fixture(&mut env, SplConfig::default());

    // `create_policy` refuses an `Any` policy without the flag, so this state comes from the
    // owner revoking the flag *after* the policy existed. Step 10 has to catch it at payment
    // time, or revoking would only take effect on the operator's next policy edit.
    set_destination_flags(&mut env, &f.treasury, f.mint, false, true);

    let intent = intent(&mut env, f.mint, f.destination, PAYMENT);
    assert_spl_payment_rejected(
        &mut env,
        &f,
        &intent,
        None,
        AgentRailsError::PolicyExceedsCeiling,
    );
}

// ---------------------------------------------------------------------------------------
// Session and treasury gates
// ---------------------------------------------------------------------------------------

#[test]
fn a_paused_treasury_stops_agent_payments() {
    let mut env = Env::new();
    let f = spl_fixture(&mut env, SplConfig::default());
    pause(&mut env, &f.treasury);

    let intent = intent(&mut env, f.mint, f.destination, PAYMENT);
    assert_spl_payment_rejected(&mut env, &f, &intent, None, AgentRailsError::Paused);
}

#[test]
fn a_revoked_session_cannot_pay() {
    let mut env = Env::new();
    let f = spl_fixture(&mut env, SplConfig::default());

    let ix = revoke_session_ix(
        &env,
        &f.treasury.treasury,
        &f.treasury.owner.pubkey(),
        &f.policy,
        &f.session.session,
    );
    let owner = f.treasury.owner.insecure_clone();
    env.execute(ix, &[&owner]).assert_success();

    let intent = intent(&mut env, f.mint, f.destination, PAYMENT);
    assert_spl_payment_rejected(&mut env, &f, &intent, None, AgentRailsError::SessionRevoked);
}

#[test]
fn an_expired_session_cannot_pay() {
    let mut env = Env::new();
    let f = spl_fixture(&mut env, SplConfig::default());

    // The session was minted with a real TTL; the clock simply runs past it. Nothing
    // revokes it, so `SessionExpired` is the only thing that can stop the payment.
    env.warp_seconds(SESSION_TTL + 1);

    let intent = intent(&mut env, f.mint, f.destination, PAYMENT);
    assert_spl_payment_rejected(&mut env, &f, &intent, None, AgentRailsError::SessionExpired);
}

#[test]
fn a_session_key_that_did_not_sign_cannot_pay() {
    let mut env = Env::new();
    let f = spl_fixture(&mut env, SplConfig::default());

    // A second session under the same policy, whose key signs in place of the real one. The
    // `session` account still belongs to the first key, so `has_one` has to reject it.
    let impostor = create_session(&mut env, &f.treasury, &f.policy, SESSION_TTL);
    let intent = intent(&mut env, f.mint, f.destination, PAYMENT);
    let mut ix = execute_payment_ix(
        &env,
        &f.treasury,
        &f.session,
        &f.fee_payer.pubkey(),
        f.token_program,
        None,
        &intent,
    );
    ix.accounts[1].pubkey = impostor.session_key.pubkey();

    let result = env.execute(ix, &[&f.fee_payer, &impostor.session_key]);
    result.assert_failure();
    assert_eq!(token_balance(&env, &f.vault), VAULT_AMOUNT);
}

// ---------------------------------------------------------------------------------------
// Intent validity
// ---------------------------------------------------------------------------------------

#[test]
fn an_expired_intent_is_rejected() {
    let mut env = Env::new();
    let f = spl_fixture(&mut env, SplConfig::default());

    let mut intent = intent(&mut env, f.mint, f.destination, PAYMENT);
    intent.expires_at = env.now();
    assert_spl_payment_rejected(&mut env, &f, &intent, None, AgentRailsError::IntentExpired);
}

#[test]
fn an_intent_with_too_long_a_ttl_is_rejected() {
    let mut env = Env::new();
    let f = spl_fixture(&mut env, SplConfig::default());

    let mut intent = intent(&mut env, f.mint, f.destination, PAYMENT);
    intent.expires_at = env.now() + agent_rails::constants::MAX_INTENT_TTL_SECONDS + 1;
    assert_spl_payment_rejected(
        &mut env,
        &f,
        &intent,
        None,
        AgentRailsError::IntentTtlTooLong,
    );
}

#[test]
fn an_oversized_memo_is_rejected() {
    let mut env = Env::new();
    let f = spl_fixture(&mut env, SplConfig::default());

    let mut intent = intent(&mut env, f.mint, f.destination, PAYMENT);
    intent.memo = vec![b'x'; MAX_MEMO_LEN + 1];
    assert_spl_payment_rejected(&mut env, &f, &intent, None, AgentRailsError::MemoTooLong);
}

#[test]
fn a_policy_that_requires_a_memo_rejects_an_empty_one_and_hashes_a_real_one() {
    let mut env = Env::new();
    let f = spl_fixture(
        &mut env,
        SplConfig {
            require_memo: true,
            ..SplConfig::default()
        },
    );

    let empty = intent(&mut env, f.mint, f.destination, PAYMENT);
    assert_spl_payment_rejected(&mut env, &f, &empty, None, AgentRailsError::MemoRequired);

    let mut with_memo = intent(&mut env, f.mint, f.destination, PAYMENT);
    with_memo.memo = b"invoice-4471".to_vec();
    let ix = execute_payment_ix(
        &env,
        &f.treasury,
        &f.session,
        &f.fee_payer.pubkey(),
        f.token_program,
        None,
        &with_memo,
    );
    env.execute(ix, &[&f.fee_payer, &f.session.session_key])
        .assert_success();

    let receipt = receipt_account(
        &env,
        &receipt_pda(&f.session.session, &with_memo.intent_id).0,
    );
    // `genesis_audit_head` is `sha256(domain ‖ session)`, so hashing the memo with the same
    // software implementation cross-checks the on-chain syscall against the crate's vectors.
    assert_eq!(receipt.memo_hash, sha256(&with_memo.memo));
}

// ---------------------------------------------------------------------------------------
// Destinations
// ---------------------------------------------------------------------------------------

#[test]
fn allowlist_mode_pays_a_listed_destination_and_refuses_an_unlisted_one() {
    let mut env = Env::new();
    let f = spl_fixture(
        &mut env,
        SplConfig {
            destination_mode: 1,
            ..SplConfig::default()
        },
    );

    let unlisted = intent(&mut env, f.mint, f.destination, PAYMENT);
    assert_spl_payment_rejected(
        &mut env,
        &f,
        &unlisted,
        None,
        AgentRailsError::DestinationNotAllowed,
    );

    let entry = seed_allowlist_entry(&mut env, &f.policy, &f.destination, 0);
    let listed = intent(&mut env, f.mint, f.destination, PAYMENT);
    let ix = execute_payment_ix(
        &env,
        &f.treasury,
        &f.session,
        &f.fee_payer.pubkey(),
        f.token_program,
        Some(entry),
        &listed,
    );
    let result = env.execute(ix, &[&f.fee_payer, &f.session.session_key]);
    result.assert_success();
    assert_eq!(token_balance(&env, &f.destination_ata), PAYMENT);
}

#[test]
fn an_allowlist_entry_for_another_destination_does_not_authorize_this_one() {
    let mut env = Env::new();
    let f = spl_fixture(
        &mut env,
        SplConfig {
            destination_mode: 1,
            ..SplConfig::default()
        },
    );

    // A real, operator-created entry — for someone else. Passing it for this destination
    // must fail on the seeds, not merely on the entry's stored `destination_owner`.
    let other = env.unique_pubkey();
    let entry = seed_allowlist_entry(&mut env, &f.policy, &other, 0);

    let intent = intent(&mut env, f.mint, f.destination, PAYMENT);
    assert_spl_payment_rejected(
        &mut env,
        &f,
        &intent,
        Some(entry),
        AgentRailsError::DestinationNotAllowed,
    );
}

#[test]
fn an_allowlist_override_tightens_the_per_transaction_cap() {
    let mut env = Env::new();
    let f = spl_fixture(
        &mut env,
        SplConfig {
            destination_mode: 1,
            ..SplConfig::default()
        },
    );
    let entry = seed_allowlist_entry(&mut env, &f.policy, &f.destination, PAYMENT);

    let over = intent(&mut env, f.mint, f.destination, PAYMENT + 1);
    assert_spl_payment_rejected(
        &mut env,
        &f,
        &over,
        Some(entry),
        AgentRailsError::ExceedsPerTxMax,
    );

    let at_cap = intent(&mut env, f.mint, f.destination, PAYMENT);
    let ix = execute_payment_ix(
        &env,
        &f.treasury,
        &f.session,
        &f.fee_payer.pubkey(),
        f.token_program,
        Some(entry),
        &at_cap,
    );
    env.execute(ix, &[&f.fee_payer, &f.session.session_key])
        .assert_success();
}

#[test]
fn the_treasury_cannot_pay_itself() {
    let mut env = Env::new();
    let f = spl_fixture(&mut env, SplConfig::default());
    let treasury_key = f.treasury.treasury;
    create_destination_ata(
        &mut env,
        &f.fee_payer.insecure_clone(),
        &treasury_key,
        &f.mint,
        f.token_program,
    );

    let intent = intent(&mut env, f.mint, treasury_key, PAYMENT);
    let ix = execute_payment_ix(
        &env,
        &f.treasury,
        &f.session,
        &f.fee_payer.pubkey(),
        f.token_program,
        None,
        &intent,
    );
    let result = env.execute(ix, &[&f.fee_payer, &f.session.session_key]);
    assert_program_error(&result, AgentRailsError::SelfPaymentForbidden);
}

#[test]
fn a_missing_destination_ata_is_rejected_when_the_policy_forbids_creating_it() {
    let mut env = Env::new();
    let f = spl_fixture(
        &mut env,
        SplConfig {
            policy_creates_ata: false,
            precreate_destination_ata: false,
            ..SplConfig::default()
        },
    );

    let intent = intent(&mut env, f.mint, f.destination, PAYMENT);
    assert_spl_payment_rejected(
        &mut env,
        &f,
        &intent,
        None,
        AgentRailsError::DestinationAtaCreationDisabled,
    );
}

#[test]
fn a_substituted_destination_token_account_is_rejected() {
    let mut env = Env::new();
    let f = spl_fixture(&mut env, SplConfig::default());

    // The look-alike: a real ATA for the same mint, owned by an attacker. Only the derived
    // address is accepted, so naming it in place of the destination's ATA must fail.
    let attacker = env.unique_pubkey();
    let attacker_ata = create_destination_ata(
        &mut env,
        &f.fee_payer.insecure_clone(),
        &attacker,
        &f.mint,
        f.token_program,
    );

    let intent = intent(&mut env, f.mint, f.destination, PAYMENT);
    let mut ix = execute_payment_ix(
        &env,
        &f.treasury,
        &f.session,
        &f.fee_payer.pubkey(),
        f.token_program,
        None,
        &intent,
    );
    let slot = ix
        .accounts
        .iter()
        .position(|meta| meta.pubkey == f.destination_ata)
        .expect("destination_ata in the account list");
    ix.accounts[slot].pubkey = attacker_ata;

    let result = env.execute(ix, &[&f.fee_payer, &f.session.session_key]);
    assert_program_error(&result, AgentRailsError::DestinationNotAllowed);
    assert_eq!(token_balance(&env, &attacker_ata), 0);
}

// ---------------------------------------------------------------------------------------
// Path separation and vault floor
// ---------------------------------------------------------------------------------------

#[test]
fn the_native_mint_cannot_be_paid_through_the_token_path() {
    let mut env = Env::new();
    let f = spl_fixture(&mut env, SplConfig::default());
    add_native_mint(&mut env, &f.treasury, permissive_ceiling());

    // Give the policy and session a native slot so the failure is the path check in step 7
    // and not a missing limit.
    let args = PolicyInput {
        mint_limits: vec![
            permissive_limit_args(f.mint),
            permissive_limit_args(NATIVE_MINT),
        ],
        destination_mode: 0,
        require_memo: false,
        create_destination_ata: false,
    };
    let policy = create_policy(&mut env, &f.treasury, padded_name("with-native"), args);
    let session = create_session(&mut env, &f.treasury, &policy, SESSION_TTL);

    let intent = intent(&mut env, NATIVE_MINT, f.destination, PAYMENT);
    let ix = execute_payment_ix(
        &env,
        &f.treasury,
        &session,
        &f.fee_payer.pubkey(),
        f.token_program,
        None,
        &intent,
    );
    let result = env.execute(ix, &[&f.fee_payer, &session.session_key]);
    result.assert_failure();
}

#[test]
fn an_spl_mint_cannot_be_paid_through_the_sol_path() {
    let mut env = Env::new();
    let f = spl_fixture(&mut env, SplConfig::default());

    let intent = intent(&mut env, f.mint, f.destination, PAYMENT);
    let ix = execute_payment_sol_ix(
        &env,
        &f.treasury,
        &f.session,
        &f.fee_payer.pubkey(),
        None,
        &intent,
    );
    let result = env.execute(ix, &[&f.fee_payer, &f.session.session_key]);
    assert_program_error(&result, AgentRailsError::WrongPaymentPath);
}

#[test]
fn the_sol_vault_rent_floor_is_never_spendable() {
    let mut env = Env::new();
    let deposit = 2_000_000;
    let f = sol_fixture(&mut env, deposit, 0);

    let floor = env.ctx.svm.minimum_balance_for_rent_exemption(0);
    let balance = env.lamports(&f.treasury.sol_vault);
    let spendable = balance - floor;

    let too_much = intent(&mut env, NATIVE_MINT, f.destination, spendable + 1);
    let ix = execute_payment_sol_ix(
        &env,
        &f.treasury,
        &f.session,
        &f.fee_payer.pubkey(),
        None,
        &too_much,
    );
    let result = env.execute(ix, &[&f.fee_payer, &f.session.session_key]);
    assert_program_error(&result, AgentRailsError::InsufficientVaultBalance);
    assert_eq!(env.lamports(&f.treasury.sol_vault), balance);

    // Everything above the floor is spendable, and the vault stops exactly at it.
    let exact = intent(&mut env, NATIVE_MINT, f.destination, spendable);
    let ix = execute_payment_sol_ix(
        &env,
        &f.treasury,
        &f.session,
        &f.fee_payer.pubkey(),
        None,
        &exact,
    );
    env.execute(ix, &[&f.fee_payer, &f.session.session_key])
        .assert_success();
    assert_eq!(env.lamports(&f.treasury.sol_vault), floor);
    assert!(
        f.limit.per_tx_max >= spendable,
        "the limit must not be what binds here"
    );
}

#[test]
fn the_sol_vault_cannot_pay_itself() {
    let mut env = Env::new();
    let f = sol_fixture(&mut env, 5_000_000_000, 0);

    let intent = intent(&mut env, NATIVE_MINT, f.treasury.sol_vault, PAYMENT);
    let ix = execute_payment_sol_ix(
        &env,
        &f.treasury,
        &f.session,
        &f.fee_payer.pubkey(),
        None,
        &intent,
    );
    let result = env.execute(ix, &[&f.fee_payer, &f.session.session_key]);
    assert_program_error(&result, AgentRailsError::SelfPaymentForbidden);
}

#[test]
fn a_mint_absent_from_the_policy_cannot_be_paid() {
    let mut env = Env::new();
    let f = spl_fixture(&mut env, SplConfig::default());

    // Configured on the treasury, but the operator never gave this policy a limit for it.
    let mint_authority = f.treasury.owner.insecure_clone();
    let second = create_spl_token_mint(&mut env, &mint_authority, MINT_DECIMALS);
    add_spl_mint(
        &mut env,
        &f.treasury,
        second,
        f.token_program,
        permissive_ceiling(),
    );
    fund_vault(
        &mut env,
        &f.treasury.treasury,
        &second,
        &mint_authority,
        f.token_program,
        VAULT_AMOUNT,
    );
    create_destination_ata(
        &mut env,
        &f.fee_payer.insecure_clone(),
        &f.destination,
        &second,
        f.token_program,
    );

    let intent = intent(&mut env, second, f.destination, PAYMENT);
    let ix = execute_payment_ix(
        &env,
        &f.treasury,
        &f.session,
        &f.fee_payer.pubkey(),
        f.token_program,
        None,
        &intent,
    );
    let result = env.execute(ix, &[&f.fee_payer, &f.session.session_key]);
    assert_program_error(&result, AgentRailsError::MintNotInPolicy);
}

#[test]
fn a_mint_absent_from_the_treasury_cannot_be_paid() {
    let mut env = Env::new();
    let f = spl_fixture(&mut env, SplConfig::default());

    let mint_authority = f.treasury.owner.insecure_clone();
    let stranger = create_spl_token_mint(&mut env, &mint_authority, MINT_DECIMALS);

    // `create_policy` rejects a mint the treasury never configured, which is exactly the
    // state under test: only `remove_mint` could produce it in production, so the policy
    // and session are written directly.
    let stranger_limit = permissive_limit(stranger);
    let mut spec = PolicySpec::open(vec![stranger_limit]);
    spec.name = padded_name("stranger");
    let policy = seed_policy(&mut env, &f.treasury.treasury, &spec);
    let session = seed_session(&mut env, &f.treasury.treasury, &policy, &[stranger_limit]);

    // The vault ATA has to exist for the account constraints to pass, so the mint reaching
    // step 7 unconfigured is the only thing left to fail on.
    create_destination_ata(
        &mut env,
        &f.fee_payer.insecure_clone(),
        &f.treasury.treasury,
        &stranger,
        f.token_program,
    );
    create_destination_ata(
        &mut env,
        &f.fee_payer.insecure_clone(),
        &f.destination,
        &stranger,
        f.token_program,
    );

    let intent = intent(&mut env, stranger, f.destination, PAYMENT);
    let ix = execute_payment_ix(
        &env,
        &f.treasury,
        &session,
        &f.fee_payer.pubkey(),
        f.token_program,
        None,
        &intent,
    );
    let result = env.execute(ix, &[&f.fee_payer, &session.session_key]);
    assert_program_error(&result, AgentRailsError::MintNotConfigured);
}
