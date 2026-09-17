//! The ceiling partial order, tested for what it *refuses*.
//!
//! Every test here was written to kill a specific surviving mutant (`cargo mutants`, in
//! `scripts/verify.sh mutants`). That is the whole reason the file exists: before it,
//! `cargo test` contained nothing that failed when `limit_leq_ceiling` was replaced with
//! `-> true`. Proptest builds limits that fit their ceiling by construction and asserts the
//! arithmetic over them, `rejections.rs` covers the validators, and between them the order
//! itself — the rule that carries "loosening flows downhill only" — was asserted by nothing
//! that could tell a conjunction from a disjunction.
//!
//! The Kani harnesses in `src/proofs.rs` do prove this function, which is why the gap was
//! invisible: the crate was covered, just not by anything `cargo test` runs. Mutation
//! testing is what surfaced the difference.

use agent_rails_policy::{
    limit_leq_ceiling, policy_leq_ceiling, rollover, validate_ceiling, DestinationMode, Key,
    MintCeiling, MintCeilingEntry, MintLimit, PolicyInputView, SpendCounter, TreasuryView,
    MAX_MINTS, MIN_WINDOW_SECONDS,
};

const MINT: Key = [1u8; 32];

/// A ceiling and a limit that sit exactly on top of each other: every dimension satisfied,
/// none with slack. Each test below loosens exactly one field past the ceiling, so a failure
/// names the dimension that stopped being enforced.
fn ceiling() -> MintCeiling {
    MintCeiling {
        max_per_tx: 1_000,
        max_short_window: 10_000,
        max_long_window: 100_000,
        max_lifetime: 1_000_000,
        min_short_window_seconds: MIN_WINDOW_SECONDS,
        min_long_window_seconds: MIN_WINDOW_SECONDS * 2,
    }
}

fn limit() -> MintLimit {
    MintLimit {
        mint: MINT,
        per_tx_max: 1_000,
        short_window_max: 10_000,
        short_window_seconds: MIN_WINDOW_SECONDS,
        long_window_max: 100_000,
        long_window_seconds: MIN_WINDOW_SECONDS * 2,
        lifetime_max: 1_000_000,
    }
}

#[test]
fn a_limit_flush_against_its_ceiling_is_accepted() {
    assert!(limit_leq_ceiling(&limit(), &ceiling()));
}

/// Six dimensions, six refusals. Each case violates exactly one and satisfies the other
/// five, which is what makes every conjunct load-bearing: replace any `&&` in
/// `limit_leq_ceiling` with `||` and the satisfied five carry the violated one through.
#[test]
fn every_dimension_of_the_order_is_load_bearing() {
    let over_per_tx = MintLimit {
        per_tx_max: 1_001,
        ..limit()
    };
    assert!(
        !limit_leq_ceiling(&over_per_tx, &ceiling()),
        "per_tx_max above the ceiling must be refused"
    );

    let over_short = MintLimit {
        short_window_max: 10_001,
        ..limit()
    };
    assert!(
        !limit_leq_ceiling(&over_short, &ceiling()),
        "short_window_max above the ceiling must be refused"
    );

    let over_long = MintLimit {
        long_window_max: 100_001,
        ..limit()
    };
    assert!(
        !limit_leq_ceiling(&over_long, &ceiling()),
        "long_window_max above the ceiling must be refused"
    );

    let over_lifetime = MintLimit {
        lifetime_max: 1_000_001,
        ..limit()
    };
    assert!(
        !limit_leq_ceiling(&over_lifetime, &ceiling()),
        "lifetime_max above the ceiling must be refused"
    );

    // A *shorter* window is the loosening direction: the same cap resets more often. This
    // is the one dimension where the comparison runs the other way, and the only one where
    // getting it backwards still leaves a mathematically sound partial order.
    let short_window = MintLimit {
        short_window_seconds: MIN_WINDOW_SECONDS - 1,
        ..limit()
    };
    assert!(
        !limit_leq_ceiling(&short_window, &ceiling()),
        "a short window below the ceiling's minimum must be refused"
    );

    let long_window = MintLimit {
        long_window_seconds: MIN_WINDOW_SECONDS * 2 - 1,
        ..limit()
    };
    assert!(
        !limit_leq_ceiling(&long_window, &ceiling()),
        "a long window below the ceiling's minimum must be refused"
    );
}

/// `validate_ceiling` rejects a window under the floor in either position, and the long
/// window is allowed to be *longer* than the floor — which is the case that distinguishes
/// the floor check from the ordering check underneath it. Without a ceiling whose long
/// window exceeds the minimum, the two are indistinguishable and the floor comparison can
/// be inverted without any test noticing.
#[test]
fn a_long_window_wider_than_the_floor_is_accepted() {
    let wide = MintCeiling {
        min_short_window_seconds: MIN_WINDOW_SECONDS,
        min_long_window_seconds: MIN_WINDOW_SECONDS * 60,
        ..ceiling()
    };
    assert!(validate_ceiling(&wide).is_ok());
}

/// `MAX_MINTS` slots is full, not over-full. The boundary matters because the check is a
/// strict `>`: at exactly `MAX_MINTS` the policy is legal, and one slot more is not.
#[test]
fn a_policy_filling_every_mint_slot_is_accepted() {
    let mints: Vec<Key> = (0..MAX_MINTS).map(|i| [i as u8 + 1; 32]).collect();

    let limits: Vec<MintLimit> = mints
        .iter()
        .map(|m| MintLimit {
            mint: *m,
            ..limit()
        })
        .collect();
    let entries: Vec<MintCeilingEntry> = mints
        .iter()
        .map(|m| MintCeilingEntry {
            mint: *m,
            ceiling: ceiling(),
        })
        .collect();

    let policy = PolicyInputView {
        mint_limits: &limits,
        destination_mode: DestinationMode::Allowlist as u8,
        require_memo: false,
        create_destination_ata: false,
    };
    let treasury = TreasuryView {
        mints: &entries,
        allow_any_destination: false,
        allow_create_destination_ata: false,
    };

    assert_eq!(limits.len(), MAX_MINTS);
    assert!(policy_leq_ceiling(&policy, &treasury).is_ok());
}

/// The long window resets independently of the short one. Asserting only that the short
/// bucket zeroes leaves `long_spent` free to be carried through untouched, which is a
/// budget that never refills on one axis and never empties on the other.
#[test]
fn both_windows_reset_independently_on_rollover() {
    // A long window well clear of the short one, so "between the two boundaries" is
    // unambiguous rather than landing exactly on the long boundary.
    let l = MintLimit {
        long_window_seconds: MIN_WINDOW_SECONDS * 10,
        ..limit()
    };
    let counter = SpendCounter {
        mint: MINT,
        short_window_start: 0,
        short_spent: 500,
        long_window_start: 0,
        long_spent: 900,
        lifetime_spent: 4_000,
        last_payment_at: 0,
    };

    // Past the long window, so both buckets are stale.
    let now = i64::from(l.long_window_seconds) * 4;
    let rolled = rollover(&counter, &l, now);

    assert_eq!(rolled.short_spent, 0, "short bucket must reset");
    assert_eq!(rolled.long_spent, 0, "long bucket must reset");
    assert_eq!(
        rolled.lifetime_spent, 4_000,
        "lifetime is per session and never rolls"
    );

    // Between the two boundaries: the short bucket has rolled, the long one has not.
    let mid = i64::from(l.short_window_seconds) * 2;
    assert!(mid < i64::from(l.long_window_seconds));
    let partial = rollover(&counter, &l, mid);
    assert_eq!(partial.short_spent, 0, "short bucket must reset");
    assert_eq!(
        partial.long_spent, 900,
        "long bucket is still live and must carry"
    );
}
