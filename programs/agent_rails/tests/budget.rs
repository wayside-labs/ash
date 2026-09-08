//! Compute-unit budgets for the payment path (spec §10, gate per §11).
//!
//! **Why this file exists separately.** The first measurements of `execute_payment` swung
//! by ±6,000 CU between runs. Every difference was a multiple of ~1,500 — the cost of one
//! `create_program_address` syscall — because `find_program_address` searches downward from
//! bump 255 and stops at the first address off the ed25519 curve. How many iterations that
//! takes depends on the *addresses*, and the fixtures drew mints, destinations, session
//! keys, and `intent_id`s at random. Three derivations on the hot path are affected: the
//! `IntentReceipt` PDA, the vault ATA, and the destination ATA.
//!
//! So a CU gate cannot sit on top of random fixtures. Everything below is pinned:
//! `Env` hands out keys from a per-test deterministic sequence (see `Env::next_seed`), and
//! this fixture draws them in a fixed order. The numbers are reproducible run to run and
//! machine to machine.
//!
//! **Two thresholds, for two different failures.** `spec_gate` comes from §10 and catches a
//! design regression — the instruction no longer fits the budget it was designed for.
//! `baseline` is what the current build actually costs, and §11 fails the build at +10%,
//! which catches a *change* long before it reaches the design ceiling. Raising a baseline is
//! a deliberate act with a diff to justify it.
//!
//! **The native SOL gate is 35k, amended from an original 30k design estimate.** The
//! reasoning is recorded in spec §10.1: the instruction deserializes 2,078 bytes of Borsh
//! account data (`Treasury` 944 + `Policy` 546 + `AgentSession` 588), creates a 243-byte
//! `IntentReceipt`, and self-CPIs the event `emit_cpi!` requires — none of which is
//! discretionary, since §3 freezes the layouts and §8 mandates the event mechanism. Every
//! path now fits its gate, so `meets_spec_gate` is `true` throughout; the field stays
//! because flipping one to `false` should require an obvious diff.

mod common;

use anchor_litesvm::Signer;

use agent_rails::constants::NATIVE_MINT;

use common::*;

const MINT_DECIMALS: u8 = 6;
const VAULT_AMOUNT: u64 = 500_000_000;
const SOL_DEPOSIT: u64 = 5_000_000_000;
const PAYMENT: u64 = 1_500_000;
const SESSION_TTL: i64 = 86_400;

/// One path's budget. Every field is a deliberate, reviewable number.
///
/// Baselines are sensitive to more than the payment handlers: adding an instruction to
/// `#[program]` lengthens Anchor's discriminator dispatch chain. Three instructions
/// moved every figure here by +9 CU; the eight in this revision moved them by +24.
/// That is exactly the kind of drift the +10% band is meant to absorb without churn,
/// and the kind a bare "under the gate" assertion would never surface.
struct Budget {
    label: &'static str,
    /// What this build actually costs. §11 fails the build at +10% over it.
    baseline: u64,
    /// The spec §10 design gate.
    spec_gate: u64,
    /// Whether this path currently fits `spec_gate`.
    ///
    /// Every path does today. Flipping a `true` to `false` is a design regression and must
    /// never be done to make a red test green — it needs a spec amendment with the
    /// arithmetic to justify it, the way §10.1 documents the native SOL gate.
    meets_spec_gate: bool,
}

const SPL_ALLOWLIST: Budget = Budget {
    label: "execute_payment (SPL Token, allowlist, no ATA creation)",
    baseline: 42_947,
    spec_gate: 45_000,
    meets_spec_gate: true,
};

const SPL_ANY: Budget = Budget {
    label: "execute_payment (SPL Token, any destination, no ATA creation)",
    baseline: 40_753,
    spec_gate: 45_000,
    meets_spec_gate: true,
};

const SOL: Budget = Budget {
    label: "execute_payment_sol",
    baseline: 32_026,
    // Spec §10.1: amended from the original 30k design estimate, which the frozen Borsh
    // account layouts make unreachable.
    spec_gate: 35_000,
    meets_spec_gate: true,
};

/// §11: "CU regression (>10% over committed budget fails)".
const REGRESSION_TOLERANCE_PERCENT: u64 = 10;

/// Asserts one measurement against both thresholds and prints it, so a CI log records the
/// number even on a passing run.
fn assert_within_budget(budget: &Budget, measured: u64) {
    let Budget {
        label,
        baseline,
        spec_gate,
        meets_spec_gate,
    } = *budget;
    let ceiling = baseline + baseline * REGRESSION_TOLERANCE_PERCENT / 100;
    println!("{label}: {measured} CU (baseline {baseline}, spec §10 gate {spec_gate})");

    // The regression gate applies to every path, met or not: it is what catches a change.
    assert!(
        measured <= ceiling,
        "{label} costs {measured} CU, more than {REGRESSION_TOLERANCE_PERCENT}% over the \
         committed baseline of {baseline}. Either this is a regression, or the baseline \
         needs updating in the same commit that justifies it."
    );

    if meets_spec_gate {
        assert!(
            measured <= spec_gate,
            "{label} costs {measured} CU, over the spec §10 gate of {spec_gate}. This path \
             fits the gate today, so this is a design regression — do not relax the gate."
        );
    } else {
        // Guard the claim in the other direction: if this path ever *does* fit, the
        // exemption is stale and should be removed rather than left to rot.
        assert!(
            measured > spec_gate,
            "{label} now fits the spec §10 gate of {spec_gate} at {measured} CU. \
             Set `meets_spec_gate: true` and delete this exemption."
        );
    }
}

/// The SPL payment path, with every address pinned.
///
/// `destination_mode` picks between the two shapes spec §10 budgets: `Allowlist` (the
/// intended production configuration, which carries one extra account and one extra
/// `create_program_address`) and `Any`.
fn measure_spl_payment(destination_mode: u8) -> u64 {
    let mut env = Env::new();
    let treasury = create_treasury(&mut env, true, true);
    let mint_authority = treasury.owner.insecure_clone();

    let mint = create_spl_token_mint(&mut env, &mint_authority, MINT_DECIMALS);
    add_spl_mint(
        &mut env,
        &treasury,
        mint,
        token_program_id(),
        permissive_ceiling(),
    );
    fund_vault(
        &mut env,
        &treasury.treasury,
        &mint,
        &mint_authority,
        token_program_id(),
        VAULT_AMOUNT,
    );

    let mut args = permissive_policy_args(mint);
    args.destination_mode = destination_mode;
    let policy = create_policy(&mut env, &treasury, padded_name("budget"), args);
    let session = create_session(&mut env, &treasury, &policy, SESSION_TTL);

    let destination = env.unique_pubkey();
    let fee_payer = env.keypair();

    // The destination ATA exists already: spec §10 budgets creation as a separate
    // "+≈20k CU" line, so it must not be folded into the base measurement.
    create_destination_ata(
        &mut env,
        &fee_payer,
        &destination,
        &mint,
        token_program_id(),
    );

    let allowlist_entry = (destination_mode == 1)
        .then(|| add_allowlist_entry(&mut env, &treasury, &policy, destination, 0));

    let intent = intent(&mut env, mint, destination, PAYMENT);
    let ix = execute_payment_ix(
        &env,
        &treasury,
        &session,
        &fee_payer.pubkey(),
        token_program_id(),
        allowlist_entry,
        &intent,
    );
    let result = env.execute(ix, &[&fee_payer, &session.session_key]);
    result.assert_success();
    result.compute_units()
}

fn measure_sol_payment() -> u64 {
    let mut env = Env::new();
    let treasury = create_treasury(&mut env, true, true);
    add_native_mint(&mut env, &treasury, permissive_ceiling());

    let funder = env.keypair();
    let ix = anchor_lang::solana_program::system_instruction::transfer(
        &funder.pubkey(),
        &treasury.sol_vault,
        SOL_DEPOSIT,
    );
    env.execute(ix, &[&funder]).assert_success();

    let policy = create_policy(
        &mut env,
        &treasury,
        padded_name("budget"),
        permissive_policy_args(NATIVE_MINT),
    );
    let session = create_session(&mut env, &treasury, &policy, SESSION_TTL);

    let destination = env.unique_pubkey();
    let fee_payer = env.keypair();
    let intent = intent(&mut env, NATIVE_MINT, destination, PAYMENT);
    let ix = execute_payment_sol_ix(
        &env,
        &treasury,
        &session,
        &fee_payer.pubkey(),
        None,
        &intent,
    );
    let result = env.execute(ix, &[&fee_payer, &session.session_key]);
    result.assert_success();
    result.compute_units()
}

#[test]
fn execute_payment_fits_its_budget_in_allowlist_mode() {
    assert_within_budget(&SPL_ALLOWLIST, measure_spl_payment(1));
}

#[test]
fn execute_payment_fits_its_budget_in_any_mode() {
    assert_within_budget(&SPL_ANY, measure_spl_payment(0));
}

#[test]
fn execute_payment_sol_fits_its_budget() {
    assert_within_budget(&SOL, measure_sol_payment());
}

/// The property the gate depends on: the same fixture must cost the same every time.
///
/// If this fails, the fixtures have picked up a nondeterministic key again and every
/// threshold above is measuring noise rather than the program.
#[test]
fn compute_unit_measurements_are_reproducible() {
    let first = measure_spl_payment(1);
    let second = measure_spl_payment(1);
    let third = measure_sol_payment();
    let fourth = measure_sol_payment();

    assert_eq!(
        first, second,
        "execute_payment varied between identical runs: {first} then {second} CU"
    );
    assert_eq!(
        third, fourth,
        "execute_payment_sol varied between identical runs: {third} then {fourth} CU"
    );
}
