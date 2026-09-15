//! `owner` as a program-derived address (ADR-002, ADR-014 "Squads/Realms owner" open item).
//!
//! Agent Rails' architecture already permits `Treasury.owner` to be a Squads or Realms
//! vault PDA — `owner` is just a stored `Pubkey`, never required to sign `create_treasury`
//! itself. What was never verified is the other side: do the instructions that *do*
//! require `owner: Signer` (`add_mint`, `enable_native_allowance`, ...) actually accept a
//! signature that arrives via CPI from a program that owns that PDA, the way Squads' and
//! Realms' vault-execute instructions sign on a multisig's behalf?
//!
//! Deploying the real Squads V4 program and driving its full multisig/proposal/voting flow
//! would answer this, but it would also mean testing Squads' business logic, not ours. This
//! file answers the narrower, actually-relevant question with `test_pda_relay` (see its own
//! module doc): a ~60-line fixture that does nothing but `invoke_signed` on behalf of its
//! own PDA, exactly the mechanism Squads relies on. If Agent Rails' account constraints
//! have nothing PDA-hostile in them beyond the signature check itself, everything below
//! should work exactly as it does for a wallet owner.

mod common;

use anchor_litesvm::Signer;

use agent_rails::state::FundingMode;

use common::*;

const MINT_DECIMALS: u8 = 6;
const OWNER_WALLET_BALANCE: u64 = 500_000_000;
const AMOUNT_CAP: u64 = 500_000_000;
const PAYMENT: u64 = 1_500_000;
const SESSION_TTL: i64 = 86_400;

#[test]
fn a_program_derived_owner_can_add_a_mint_and_enable_native_allowance_via_cpi() {
    let mut env = Env::new();
    load_native_subscriptions_program(&mut env);
    let (relay_program_id, relay_pda, relay_bump) = load_pda_relay_program(&mut env);

    // `owner` here has no keypair at all — proof this isn't secretly falling back to a
    // real signature somewhere. `operator_key` is a normal funded wallet: in the trust
    // model this mimics, the cold Squads/Realms-controlled owner sets ceilings and switches
    // funding modes, while a warm operator wallet still handles policy/session churn day to
    // day — nobody wants a multisig vote for every session rotation.
    let treasury = create_treasury_with_owner(&mut env, relay_pda, true, true);
    let fee_payer = env.keypair();

    let mint_authority = env.keypair();
    let token_program = token_program_id();
    let mint = create_spl_token_mint(&mut env, &mint_authority, MINT_DECIMALS);

    // 1. add_mint, relayed: owner: Signer is the PDA, forwarded via CPI.
    let add_mint = add_mint_ix(
        &env,
        &treasury.treasury,
        &relay_pda,
        mint,
        permissive_ceiling(),
        Some((
            vault_ata(&treasury.treasury, &mint, &token_program),
            token_program,
        )),
    );
    env.execute(
        relay_owner_ix(relay_program_id, relay_bump, add_mint),
        &[&fee_payer],
    )
    .assert_success();

    // 2. enable_native_allowance, relayed the same way. The PDA also has to fund and hold
    //    an ATA for the mint — exactly what a Squads vault PDA would do as a real treasury
    //    owner holding its own spendable balance.
    let owner_ata = create_destination_ata(&mut env, &fee_payer, &relay_pda, &mint, token_program);
    let mint_to_owner = spl_token_2022_mint_to(
        &token_program,
        &mint,
        &owner_ata,
        &mint_authority.pubkey(),
        OWNER_WALLET_BALANCE,
    );
    env.execute(mint_to_owner, &[&mint_authority])
        .assert_success();

    let expiry_ts = env.now() + SESSION_TTL;
    let enable_native = enable_native_allowance_ix(
        &env,
        treasury.treasury,
        relay_pda,
        mint,
        owner_ata,
        token_program,
        AMOUNT_CAP,
        expiry_ts,
    );
    env.execute(
        relay_owner_ix(relay_program_id, relay_bump, enable_native),
        &[&fee_payer],
    )
    .assert_success();

    let treasury_state = env.treasury(&treasury.treasury);
    let slot = *treasury_state.find_mint(&mint).expect("mint configured");
    assert_eq!(slot.funding_mode, FundingMode::NativeAllowance);

    // 3. And the treasury works end to end from here on exactly like a wallet-owned one: a
    //    policy (operator-signed — no PDA involved, see the comment above), a session, and
    //    a real NativeAllowance payment.
    let policy_ix = create_policy_ix(
        &env,
        &treasury.treasury,
        &treasury.operator_key.pubkey(),
        padded_name("pda-owner"),
        permissive_policy_args(mint),
    );
    env.execute(policy_ix, &[&treasury.operator_key])
        .assert_success();
    let policy = policy_pda(&treasury.treasury, &padded_name("pda-owner")).0;

    let session = create_session_as(
        &mut env,
        treasury.treasury,
        &treasury.operator_key,
        &policy,
        SESSION_TTL,
    );

    let destination = env.unique_pubkey();
    let destination_ata =
        create_destination_ata(&mut env, &fee_payer, &destination, &mint, token_program);

    let payment_intent = intent(&mut env, mint, destination, PAYMENT);
    let ix = execute_payment_native_allowance_ix(
        &env,
        treasury.treasury,
        relay_pda,
        &session,
        &fee_payer.pubkey(),
        token_program,
        owner_ata,
        None,
        &payment_intent,
    );
    env.execute(ix, &[&fee_payer, &session.session_key])
        .assert_success();

    assert_eq!(token_balance(&env, &destination_ata), PAYMENT);
}
