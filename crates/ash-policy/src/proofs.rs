//! Kani bounded model-checking harnesses for the policy core (ADR-008 layer 1).
//!
//! Proptest samples; these prove. Every harness here quantifies over *all* inputs of its
//! types, so a counterexample is a real one and a pass is a statement about the whole
//! input space rather than about a million draws from it. The four properties are the ones
//! ADR-008 named — no overflow, monotone rollover, the `≤` partial order, and injectivity
//! of the audit preimage in `seq` — plus the consequence the order exists for.
//!
//! Compiled only under `cfg(kani)`, so nothing here reaches the on-chain build. Run with
//! `scripts/verify.sh kani`.
//!
//! `policy_leq_ceiling` is deliberately absent: it loops over slices and compares 32-byte
//! mint keys, which turns into an unwind bound and a symbolic-byte blowup that buys nothing
//! — its per-entry work is `validate_limit` and `limit_leq_ceiling`, both proved below.

use crate::types::{MintCeiling, MintLimit, SpendCounter};
use crate::{
    audit_preimage, evaluate, genesis_preimage, limit_leq_ceiling, remaining, rollover, Key,
    MIN_WINDOW_SECONDS,
};

/// `mint` is left concrete throughout: no arithmetic in this crate reads it, and 32
/// symbolic bytes per struct is the difference between a proof that lands in seconds and
/// one nobody runs.
const MINT: Key = [0u8; 32];

fn any_limit() -> MintLimit {
    MintLimit {
        mint: MINT,
        per_tx_max: kani::any(),
        short_window_max: kani::any(),
        short_window_seconds: kani::any(),
        long_window_max: kani::any(),
        long_window_seconds: kani::any(),
        lifetime_max: kani::any(),
    }
}

fn any_ceiling() -> MintCeiling {
    MintCeiling {
        max_per_tx: kani::any(),
        max_short_window: kani::any(),
        max_long_window: kani::any(),
        max_lifetime: kani::any(),
        min_short_window_seconds: kani::any(),
        min_long_window_seconds: kani::any(),
    }
}

fn any_counter() -> SpendCounter {
    SpendCounter {
        mint: MINT,
        short_window_start: kani::any(),
        short_spent: kani::any(),
        long_window_start: kani::any(),
        long_spent: kani::any(),
        lifetime_spent: kani::any(),
        last_payment_at: kani::any(),
    }
}

/// A ceiling read as the loosest limit it admits, and a limit read as the tightest ceiling
/// that admits it. `limit_leq_ceiling` relates two *different* types that are really two
/// projections of the same six-tuple, so reflexivity, antisymmetry and transitivity can
/// only be stated once one is mapped onto the other.
fn ceiling_as_limit(c: &MintCeiling) -> MintLimit {
    MintLimit {
        mint: MINT,
        per_tx_max: c.max_per_tx,
        short_window_max: c.max_short_window,
        short_window_seconds: c.min_short_window_seconds,
        long_window_max: c.max_long_window,
        long_window_seconds: c.min_long_window_seconds,
        lifetime_max: c.max_lifetime,
    }
}

fn limit_as_ceiling(l: &MintLimit) -> MintCeiling {
    MintCeiling {
        max_per_tx: l.per_tx_max,
        max_short_window: l.short_window_max,
        max_long_window: l.long_window_max,
        max_lifetime: l.lifetime_max,
        min_short_window_seconds: l.short_window_seconds,
        min_long_window_seconds: l.long_window_seconds,
    }
}

// --- 1. No overflow -------------------------------------------------------------------
//
// These three assert nothing on purpose. Kani's default checks — arithmetic overflow,
// division by zero, out-of-bounds indexing, and every `panic!`/`unwrap` reachable from the
// entry point — are the property. A harness that reaches the end proves the function is
// total over its whole input space, which is the claim `#![deny(arithmetic_side_effects)]`
// only gestures at: the lint proves every operation is spelled `checked_*`, not that the
// composition of them cannot trap.

#[kani::proof]
fn evaluate_is_total() {
    let _ = evaluate(
        &any_limit(),
        &any_counter(),
        kani::any(),
        kani::any(),
        kani::any(),
    );
}

#[kani::proof]
fn rollover_is_total() {
    let _ = rollover(&any_counter(), &any_limit(), kani::any());
}

#[kani::proof]
fn remaining_is_total() {
    let _ = remaining(&any_limit(), &any_counter(), kani::any());
}

// --- 2. Monotone rollover -------------------------------------------------------------

/// A bucket start never moves backwards, spend only ever resets to zero, lifetime is never
/// touched, and re-applying with the same `now` is a no-op. The last one is what makes a
/// retried instruction safe: rollover runs before every limit check, so a second run inside
/// the same bucket must not hand the agent a fresh allowance.
#[kani::proof]
fn rollover_is_monotone_and_idempotent() {
    let l = any_limit();
    let before = any_counter();
    let now: i64 = kani::any();

    let after = rollover(&before, &l, now);

    assert!(after.short_window_start >= before.short_window_start);
    assert!(after.long_window_start >= before.long_window_start);
    assert!(after.short_spent == before.short_spent || after.short_spent == 0);
    assert!(after.long_spent == before.long_spent || after.long_spent == 0);
    assert_eq!(after.lifetime_spent, before.lifetime_spent);
    assert_eq!(after.last_payment_at, before.last_payment_at);

    assert_eq!(rollover(&after, &l, now), after);
}

/// The postcondition `window_start ≤ now < window_start + window_seconds` that `rollover`'s
/// doc comment claims. It holds only for counters the program can actually produce, so the
/// assumptions are exactly what `validate_limit` and the payment path already enforce:
/// real windows, and a bucket start that is neither negative nor in the future.
#[kani::proof]
fn rollover_lands_now_inside_the_bucket() {
    let l = any_limit();
    let before = any_counter();
    let now: i64 = kani::any();

    kani::assume(l.short_window_seconds >= MIN_WINDOW_SECONDS);
    kani::assume(l.long_window_seconds >= MIN_WINDOW_SECONDS);
    kani::assume(before.short_window_start >= 0 && before.short_window_start <= now);
    kani::assume(before.long_window_start >= 0 && before.long_window_start <= now);
    // A Solana clock cannot reach i64::MAX/2; without this the overflow guards inside
    // roll_window fire and the counter stays put, which is correct but has no postcondition
    // to state.
    kani::assume(now < i64::MAX / 2);

    let after = rollover(&before, &l, now);

    assert!(after.short_window_start <= now);
    assert!(after.long_window_start <= now);
    assert!(after
        .short_window_start
        .checked_add(i64::from(l.short_window_seconds))
        .is_some_and(|end| now < end));
    assert!(after
        .long_window_start
        .checked_add(i64::from(l.long_window_seconds))
        .is_some_and(|end| now < end));
}

/// The overflow guards' actual contract: when the exact bucket cannot be computed, the
/// counter is returned untouched rather than approximated. `roll_window` reaches that state
/// only for a `start` no honest counter carries — `start + window` past `i64::MAX`, or a
/// `start` near `i64::MIN` that makes `now - start` unrepresentable — which is to say for a
/// corrupted account, where standing still is the strict direction and moving is not.
///
/// This is the proof that fails when those guards are traded for `saturating_*`, the fix the
/// crate's CLAUDE.md warns against by name. Saturation is invisible to every other harness
/// here: it still moves the bucket forward and still lands `now` inside it, so monotonicity
/// and the bucket postcondition both hold. What it loses is that the new boundary is an
/// exact number of windows from the old one — buckets are a fixed grid (ARCHITECTURE.md §6),
/// and saturating quietly shifts a corrupted counter onto a grid of its own.
///
/// Stated as the guards' contract rather than as divisibility of the result on purpose:
/// `(after - before) % window == 0` over a symbolic window is two nested symbolic divisions
/// and CBMC does not finish it — measured past 10 minutes, against 3 seconds for this. A
/// proof nobody can afford to run is not a gate.
#[kani::proof]
fn rollover_refuses_rather_than_approximates() {
    let l = any_limit();
    let before = any_counter();
    let now: i64 = kani::any();

    kani::assume(
        before
            .short_window_start
            .checked_add(i64::from(l.short_window_seconds))
            .is_none()
            || now.checked_sub(before.short_window_start).is_none(),
    );

    let after = rollover(&before, &l, now);

    assert_eq!(after.short_window_start, before.short_window_start);
    assert_eq!(after.short_spent, before.short_spent);
}

// --- 3. The `≤` partial order ---------------------------------------------------------

#[kani::proof]
fn leq_is_reflexive() {
    let c = any_ceiling();
    assert!(limit_leq_ceiling(&ceiling_as_limit(&c), &c));

    let l = any_limit();
    assert!(limit_leq_ceiling(&l, &limit_as_ceiling(&l)));
}

#[kani::proof]
fn leq_is_antisymmetric() {
    let l = any_limit();
    let c = any_ceiling();

    kani::assume(limit_leq_ceiling(&l, &c));
    kani::assume(limit_leq_ceiling(
        &ceiling_as_limit(&c),
        &limit_as_ceiling(&l),
    ));

    assert_eq!(limit_as_ceiling(&l), c);
}

/// The load-bearing one. "Loosening flows downhill only" is a claim about a chain —
/// agent under policy, policy under ceiling — and it is worth nothing unless the relation
/// composes. Without transitivity an intermediate tightening could be a loophole.
#[kani::proof]
fn leq_is_transitive() {
    let inner = any_limit();
    let middle = any_limit();
    let outer = any_ceiling();

    kani::assume(limit_leq_ceiling(&inner, &limit_as_ceiling(&middle)));
    kani::assume(limit_leq_ceiling(&middle, &outer));

    assert!(limit_leq_ceiling(&inner, &outer));
}

/// What the order is *for*. Any payment `evaluate` admits under a limit the owner's ceiling
/// dominates leaves every counter under that ceiling's maxima, and moves no more in one
/// transaction than the ceiling's per-tx cap — whatever the operator wrote in the policy.
#[kani::proof]
fn a_policy_under_the_ceiling_cannot_outspend_it() {
    let l = any_limit();
    let c = any_ceiling();
    let amount: u64 = kani::any();

    kani::assume(limit_leq_ceiling(&l, &c));

    if let Ok(after) = evaluate(&l, &any_counter(), amount, kani::any(), kani::any()) {
        assert!(amount <= c.max_per_tx);
        assert!(after.short_spent <= c.max_short_window);
        assert!(after.long_spent <= c.max_long_window);
        assert!(after.lifetime_spent <= c.max_lifetime);
    }
}

/// The other half of the order, and the half the algebra cannot see. Flipping
/// `l.short_window_seconds >= c.min_short_window_seconds` to `<=` leaves a relation that is
/// still reflexive, antisymmetric and transitive — a perfectly good partial order, pointing
/// the wrong way — so proofs about those three axioms pass a policy that resets its budget
/// faster than the owner allowed. The direction is only observable in what the windows *do*:
/// a window that has rolled has handed the agent a fresh allowance, so a policy the ceiling
/// dominates must never roll at a moment the ceiling's own window would not.
#[kani::proof]
fn a_policy_under_the_ceiling_cannot_reset_its_window_sooner() {
    let l = any_limit();
    let c = any_ceiling();
    let before = any_counter();
    let now: i64 = kani::any();

    kani::assume(limit_leq_ceiling(&l, &c));
    kani::assume(l.short_window_seconds >= MIN_WINDOW_SECONDS);
    kani::assume(l.long_window_seconds >= MIN_WINDOW_SECONDS);
    kani::assume(c.min_short_window_seconds >= MIN_WINDOW_SECONDS);
    kani::assume(c.min_long_window_seconds >= MIN_WINDOW_SECONDS);
    kani::assume(before.short_window_start >= 0 && before.short_window_start <= now);
    kani::assume(before.long_window_start >= 0 && before.long_window_start <= now);
    kani::assume(now < i64::MAX / 2);

    let under_policy = rollover(&before, &l, now);
    let under_ceiling = rollover(&before, &ceiling_as_limit(&c), now);

    // `roll_window` only ever moves a bucket start forward, so an unequal start is an exact
    // test for "this window rolled".
    if under_policy.short_window_start != before.short_window_start {
        assert!(under_ceiling.short_window_start != before.short_window_start);
    }
    if under_policy.long_window_start != before.long_window_start {
        assert!(under_ceiling.long_window_start != before.long_window_start);
    }
}

// --- 4. The audit preimage is injective in `seq` --------------------------------------

/// Two payments at different positions in a session's chain can never hash the same bytes.
/// This is what stops an auditor's replay from accepting a reordered or re-numbered event:
/// `seq` is folded into the preimage, not merely carried alongside it. Injectivity of
/// SHA-256 itself is a cryptographic assumption, not a thing to model-check — this proves
/// the part that is ours.
#[kani::proof]
fn audit_preimage_is_injective_in_seq() {
    let prev: Key = kani::any();
    let intent_id: [u8; 16] = kani::any();
    let mint: Key = kani::any();
    let destination_owner: Key = kani::any();
    let amount: u64 = kani::any();
    let slot: u64 = kani::any();
    let seq_a: u64 = kani::any();
    let seq_b: u64 = kani::any();

    kani::assume(seq_a != seq_b);

    assert_ne!(
        audit_preimage(
            &prev,
            seq_a,
            &intent_id,
            &mint,
            &destination_owner,
            amount,
            slot
        ),
        audit_preimage(
            &prev,
            seq_b,
            &intent_id,
            &mint,
            &destination_owner,
            amount,
            slot
        ),
    );
}

/// The chain is per session, so its root has to be too — otherwise two sessions share a
/// genesis head and either one's events replay against the other.
#[kani::proof]
fn genesis_preimage_is_injective() {
    let a: Key = kani::any();
    let b: Key = kani::any();

    kani::assume(a != b);

    assert_ne!(genesis_preimage(&a), genesis_preimage(&b));
}
