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
//! **Both numbers live in `cu-baselines.txt`, not in this file.** They used to be consts
//! here with a second copy in the spec §10 table, and both fell ~820 CU behind the build
//! without anything failing — the +10% band absorbed the drift in silence, which is the one
//! thing a baseline exists to prevent. One file now holds them, embedded with
//! `include_str!` so a change to it rebuilds this test, and `scripts/cu-baseline.sh`
//! re-measures and rewrites it rather than anyone retyping a figure.
//!
//! **The native SOL gate is 35k, amended from an original 30k design estimate.** The
//! reasoning is recorded in spec §10.1: the instruction deserializes 2,078 bytes of Borsh
//! account data (`Treasury` 944 + `Policy` 546 + `AgentSession` 588), creates a 243-byte
//! `IntentReceipt`, and self-CPIs the event `emit_cpi!` requires — none of which is
//! discretionary, since §3 freezes the layouts and §8 mandates the event mechanism. Every
//! path that has a gate fits it today; an exemption is spelled `over:<n>` in the baselines
//! file and asserted in reverse, so it cannot outlive the condition that justified it.

mod common;

use anchor_litesvm::Signer;

use ash::constants::NATIVE_MINT;

use common::*;

const NATIVE_MINT_DECIMALS: u8 = 6;
const NATIVE_OWNER_BALANCE: u64 = 500_000_000;
const NATIVE_AMOUNT_CAP: u64 = 500_000_000;

const MINT_DECIMALS: u8 = 6;
const VAULT_AMOUNT: u64 = 500_000_000;
const SOL_DEPOSIT: u64 = 5_000_000_000;
const PAYMENT: u64 = 1_500_000;
const SESSION_TTL: i64 = 86_400;

/// The committed baselines. Embedded rather than read from disk at runtime: the test binary
/// then carries them, and `include_str!` makes cargo rebuild this test when the file moves.
const BASELINES: &str = include_str!("cu-baselines.txt");

/// §11: "CU regression (>10% over committed budget fails)".
const REGRESSION_TOLERANCE_PERCENT: u64 = 10;

/// The spec §10 design ceiling for one path, in the three spellings `cu-baselines.txt`
/// documents.
#[derive(Clone, Copy)]
enum SpecGate {
    /// The path fits this gate and must keep fitting it.
    Fits(u64),
    /// The path is over this gate — a recorded exemption, asserted in reverse.
    Over(u64),
    /// No spec section has ever committed a number for this path.
    Ungated,
}

/// One path's budget, as parsed from `cu-baselines.txt`.
struct Budget {
    label: String,
    baseline: u64,
    spec_gate: SpecGate,
}

/// Looks one path up by key.
///
/// Panics rather than defaulting if the key is absent: a typo must not read as "this path
/// has no budget to check", which is how a gate stops gating without anyone noticing.
fn budget(key: &str) -> Budget {
    let mut known = Vec::new();

    for line in BASELINES.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }

        let mut fields = line.split_whitespace();
        let (Some(row_key), Some(baseline), Some(gate)) =
            (fields.next(), fields.next(), fields.next())
        else {
            panic!("cu-baselines.txt: malformed row, want `key baseline spec_gate label`: {line}");
        };

        if row_key != key {
            known.push(row_key.to_string());
            continue;
        }

        let baseline = baseline
            .parse()
            .unwrap_or_else(|_| panic!("cu-baselines.txt: {key} has a non-numeric baseline"));

        let spec_gate = if gate == "none" {
            SpecGate::Ungated
        } else {
            let (ctor, number): (fn(u64) -> SpecGate, &str) = match gate.strip_prefix("over:") {
                Some(n) => (SpecGate::Over, n),
                None => (SpecGate::Fits, gate),
            };
            ctor(number.parse().unwrap_or_else(|_| {
                panic!("cu-baselines.txt: {key} has an unparseable spec_gate: {gate}")
            }))
        };

        return Budget {
            label: fields.collect::<Vec<_>>().join(" "),
            baseline,
            spec_gate,
        };
    }

    panic!("cu-baselines.txt has no row for {key}; it has {known:?}");
}

/// Asserts one measurement against both thresholds and prints it, so a CI log records the
/// number even on a passing run.
///
/// The machine-readable `cu-baseline` line is printed *before* the assertions on purpose:
/// `scripts/cu-baseline.sh` reads it out of the test output, and a run that fails its gate
/// is exactly the run whose new number someone needs to see.
fn assert_within_budget(key: &str, measured: u64) {
    let Budget {
        label,
        baseline,
        spec_gate,
    } = budget(key);
    let ceiling = baseline + baseline * REGRESSION_TOLERANCE_PERCENT / 100;

    println!("cu-baseline\t{key}\t{measured}");
    println!(
        "{label}: {measured} CU (baseline {baseline}, {})",
        match spec_gate {
            SpecGate::Fits(gate) | SpecGate::Over(gate) => format!("spec §10 gate {gate}"),
            SpecGate::Ungated => "no spec §10 gate".to_string(),
        }
    );

    // The regression gate applies to every path, gated or not: it is what catches a change.
    assert!(
        measured <= ceiling,
        "{label} costs {measured} CU, more than {REGRESSION_TOLERANCE_PERCENT}% over the \
         committed baseline of {baseline}. Either this is a regression, or the baseline \
         needs updating in the same commit that justifies it — see scripts/cu-baseline.sh."
    );

    match spec_gate {
        SpecGate::Fits(gate) => assert!(
            measured <= gate,
            "{label} costs {measured} CU, over the spec §10 gate of {gate}. This path fits \
             the gate today, so this is a design regression — do not relax the gate."
        ),
        // Guard the claim in the other direction: if this path ever *does* fit, the
        // exemption is stale and should be removed rather than left to rot.
        SpecGate::Over(gate) => assert!(
            measured > gate,
            "{label} now fits the spec §10 gate of {gate} at {measured} CU. Drop the \
             `over:` prefix in cu-baselines.txt and delete this exemption."
        ),
        SpecGate::Ungated => {}
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
    assert_within_budget("execute_payment_spl_allowlist", measure_spl_payment(1));
}

#[test]
fn execute_payment_fits_its_budget_in_any_mode() {
    assert_within_budget("execute_payment_spl_any", measure_spl_payment(0));
}

#[test]
fn execute_payment_sol_fits_its_budget() {
    assert_within_budget("execute_payment_sol", measure_sol_payment());
}

/// The `NativeAllowance` path (ADR-014), CPI-ing into the real, devnet-dumped native
/// Subscriptions & Allowances program instead of `transfer_checked`.
///
/// This path carries a baseline but no `spec_gate`, and the two are not the same claim. No
/// spec section has ever committed a design number for it, and this measurement still
/// derives the native PDAs with `find_program_address` rather than caller-supplied bumps —
/// the gap ADR-014's "Consequences" section names — so a design ceiling would be invented
/// rather than measured. A *baseline* needs neither: it only has to be reproducible, which
/// `compute_unit_measurements_are_reproducible` asserts directly. It replaces the 150k
/// sanity ceiling this path used to sit under, which at 2.2x the real cost would not have
/// caught the path doubling.
fn measure_native_allowance_payment() -> u64 {
    let mut env = Env::new();
    load_native_subscriptions_program(&mut env);

    let treasury = create_treasury(&mut env, true, true);
    let mint_authority = treasury.owner.insecure_clone();

    let mint = create_spl_token_mint(&mut env, &mint_authority, NATIVE_MINT_DECIMALS);
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
    let mint_to_owner = spl_token_2022_mint_to(
        &token_program_id(),
        &mint,
        &owner_ata,
        &treasury.owner.pubkey(),
        NATIVE_OWNER_BALANCE,
    );
    env.execute(mint_to_owner, &[&treasury.owner])
        .assert_success();

    let expiry_ts = env.now() + SESSION_TTL;
    enable_native_allowance(
        &mut env,
        &treasury,
        mint,
        owner_ata,
        token_program_id(),
        NATIVE_AMOUNT_CAP,
        expiry_ts,
    );

    let policy = create_policy(
        &mut env,
        &treasury,
        padded_name("budget-native"),
        permissive_policy_args(mint),
    );
    let session = create_session(&mut env, &treasury, &policy, SESSION_TTL);

    let destination = env.unique_pubkey();
    let fee_payer = env.keypair();
    create_destination_ata(
        &mut env,
        &fee_payer,
        &destination,
        &mint,
        token_program_id(),
    );

    let intent = intent(&mut env, mint, destination, PAYMENT);
    let ix = execute_payment_native_allowance_ix(
        &env,
        treasury.treasury,
        treasury.owner.pubkey(),
        &session,
        &fee_payer.pubkey(),
        token_program_id(),
        owner_ata,
        None,
        &intent,
    );
    let result = env.execute(ix, &[&fee_payer, &session.session_key]);
    result.assert_success();
    result.compute_units()
}

#[test]
fn execute_payment_native_allowance_fits_its_budget() {
    assert_within_budget(
        "execute_payment_native_allowance",
        measure_native_allowance_payment(),
    );
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
    // Covered here because it carries a committed baseline like the others — a baseline on
    // a measurement that moves on its own is noise dressed as a gate.
    let fifth = measure_native_allowance_payment();
    let sixth = measure_native_allowance_payment();

    assert_eq!(
        first, second,
        "execute_payment varied between identical runs: {first} then {second} CU"
    );
    assert_eq!(
        third, fourth,
        "execute_payment_sol varied between identical runs: {third} then {fourth} CU"
    );
    assert_eq!(
        fifth, sixth,
        "execute_payment (NativeAllowance) varied between identical runs: {fifth} then \
         {sixth} CU"
    );
}
