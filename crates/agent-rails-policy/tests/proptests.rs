//! Layer 1 of the ADR-008 pyramid: property tests over the pure policy core.
//!
//! These encode the invariants the Kani harnesses prove in the nightly job — no overflow,
//! bucket containment, idempotent rollover, and the ceiling partial order — so a
//! regression shows up per-PR in milliseconds rather than only overnight.

use agent_rails_policy::{
    evaluate, limit_leq_ceiling, policy_leq_ceiling, remaining, rollover, validate_ceiling,
    validate_limit, MintCeiling, MintCeilingEntry, MintLimit, PolicyArgsView, PolicyError,
    SpendCounter, TreasuryView, MIN_WINDOW_SECONDS,
};
use proptest::prelude::*;

const MINT_A: [u8; 32] = [1u8; 32];
const MINT_B: [u8; 32] = [2u8; 32];

/// `now` is bounded by `i64::MAX / 2` so that the harness exercises the arithmetic without
/// asserting anything about deliberately corrupted account data.
const MAX_NOW: i64 = i64::MAX / 2;

fn any_limit() -> impl Strategy<Value = MintLimit> {
    (
        1u64..u64::MAX,
        1u64..u64::MAX,
        MIN_WINDOW_SECONDS..86_400u32,
        1u64..u64::MAX,
        1u64..u64::MAX,
    )
        .prop_map(
            |(
                per_tx_max,
                short_window_max,
                short_window_seconds,
                long_window_max,
                lifetime_max,
            )| {
                MintLimit {
                    mint: MINT_A,
                    per_tx_max,
                    short_window_max,
                    short_window_seconds,
                    // Kept `≥ short` so the limit is always valid by construction; the
                    // invalid direction is covered by `rejects_short_window_longer_than_long`.
                    long_window_seconds: short_window_seconds.saturating_mul(2),
                    long_window_max,
                    lifetime_max,
                }
            },
        )
}

fn any_counter() -> impl Strategy<Value = SpendCounter> {
    (
        0i64..MAX_NOW,
        0u64..u64::MAX / 4,
        0i64..MAX_NOW,
        0u64..u64::MAX / 4,
        0u64..u64::MAX / 4,
    )
        .prop_map(
            |(short_window_start, short_spent, long_window_start, long_spent, lifetime_spent)| {
                SpendCounter {
                    mint: MINT_A,
                    short_window_start,
                    short_spent,
                    long_window_start,
                    long_spent,
                    lifetime_spent,
                    last_payment_at: 0,
                }
            },
        )
}

proptest! {
    /// Spec §7.1: after rollover the bucket contains `now`, unless the counter started in
    /// the future (clock skew), in which case the start is left alone.
    #[test]
    fn rollover_puts_now_inside_the_bucket(
        l in any_limit(),
        c in any_counter(),
        now in 0i64..MAX_NOW,
    ) {
        let rolled = rollover(&c, &l, now);

        if rolled.short_window_start <= now {
            let end = rolled.short_window_start + i64::from(l.short_window_seconds);
            prop_assert!(now < end, "now={now} outside short bucket {rolled:?}");
        } else {
            prop_assert_eq!(rolled.short_window_start, c.short_window_start);
        }

        if rolled.long_window_start <= now {
            let end = rolled.long_window_start + i64::from(l.long_window_seconds);
            prop_assert!(now < end, "now={now} outside long bucket {rolled:?}");
        } else {
            prop_assert_eq!(rolled.long_window_start, c.long_window_start);
        }
    }

    #[test]
    fn rollover_is_idempotent_within_a_bucket(
        l in any_limit(),
        c in any_counter(),
        now in 0i64..MAX_NOW,
    ) {
        let once = rollover(&c, &l, now);
        let twice = rollover(&once, &l, now);
        prop_assert_eq!(once, twice);
    }

    /// Rolling over never invents spend, and never moves a bucket backwards.
    #[test]
    fn rollover_is_monotone(
        l in any_limit(),
        c in any_counter(),
        now in 0i64..MAX_NOW,
    ) {
        let rolled = rollover(&c, &l, now);
        prop_assert!(rolled.short_spent <= c.short_spent);
        prop_assert!(rolled.long_spent <= c.long_spent);
        prop_assert_eq!(rolled.lifetime_spent, c.lifetime_spent);
        prop_assert!(rolled.short_window_start >= c.short_window_start);
        prop_assert!(rolled.long_window_start >= c.long_window_start);
    }

    /// Invariant 2 of spec §11: a counter accepted by `evaluate` never exceeds its limits.
    #[test]
    fn accepted_payments_stay_under_every_limit(
        l in any_limit(),
        c in any_counter(),
        amount in 1u64..u64::MAX / 4,
        now in 0i64..MAX_NOW,
    ) {
        if let Ok(next) = evaluate(&l, &c, amount, u64::MAX, now) {
            prop_assert!(next.short_spent <= l.short_window_max);
            prop_assert!(next.long_spent <= l.long_window_max);
            prop_assert!(next.lifetime_spent <= l.lifetime_max);
            prop_assert!(amount <= l.per_tx_max);
            prop_assert_eq!(next.last_payment_at, now);
        }
    }

    /// `evaluate` is the composition of rollover and the three accumulators: whatever it
    /// accepts must show up in the counter exactly once.
    #[test]
    fn accepted_payments_are_credited_exactly_once(
        l in any_limit(),
        c in any_counter(),
        amount in 1u64..u64::MAX / 4,
        now in 0i64..MAX_NOW,
    ) {
        let rolled = rollover(&c, &l, now);
        if let Ok(next) = evaluate(&l, &c, amount, u64::MAX, now) {
            prop_assert_eq!(next.short_spent, rolled.short_spent + amount);
            prop_assert_eq!(next.long_spent, rolled.long_spent + amount);
            prop_assert_eq!(next.lifetime_spent, rolled.lifetime_spent + amount);
        }
    }

    /// An allowlist override can only tighten the per-tx cap, never loosen it.
    #[test]
    fn override_only_tightens_per_tx(
        l in any_limit(),
        c in any_counter(),
        amount in 1u64..u64::MAX / 4,
        effective_per_tx in 1u64..u64::MAX,
        now in 0i64..MAX_NOW,
    ) {
        if evaluate(&l, &c, amount, effective_per_tx, now).is_ok() {
            prop_assert!(amount <= effective_per_tx);
            prop_assert!(amount <= l.per_tx_max);
        }
    }

    /// `remaining` is the exact frontier of what `evaluate` accepts on a fresh window
    /// dimension: spending the reported headroom succeeds, one more base unit does not.
    #[test]
    fn remaining_is_the_acceptance_frontier(
        l in any_limit(),
        c in any_counter(),
        now in 0i64..MAX_NOW,
    ) {
        let r = remaining(&l, &c, now);
        let headroom = r.short.min(r.long).min(r.lifetime).min(r.per_tx);
        if headroom > 0 {
            prop_assert!(evaluate(&l, &c, headroom, u64::MAX, now).is_ok());
        }
        if let Some(over) = headroom.checked_add(1) {
            prop_assert!(evaluate(&l, &c, over, u64::MAX, now).is_err());
        }
    }

    /// Spec §7.2: a policy that passes the ceiling check is pointwise `≤` the ceiling.
    #[test]
    fn policy_leq_ceiling_implies_limit_leq_ceiling(
        l in any_limit(),
        ceiling in (1u64..u64::MAX, 1u64..u64::MAX, 1u64..u64::MAX, 1u64..u64::MAX)
            .prop_map(|(max_per_tx, max_short_window, max_long_window, max_lifetime)| MintCeiling {
                max_per_tx,
                max_short_window,
                max_long_window,
                max_lifetime,
                min_short_window_seconds: MIN_WINDOW_SECONDS,
                min_long_window_seconds: MIN_WINDOW_SECONDS,
            }),
    ) {
        let treasury = TreasuryView {
            mints: &[MintCeilingEntry { mint: MINT_A, ceiling }],
            allow_any_destination: true,
            allow_create_destination_ata: true,
        };
        let limits = [l];
        let args = PolicyArgsView {
            mint_limits: &limits,
            destination_mode: 0,
            require_memo: false,
            create_destination_ata: false,
        };
        prop_assert_eq!(policy_leq_ceiling(&args, &treasury).is_ok(), limit_leq_ceiling(&l, &ceiling));
    }

    /// Whatever the ceiling allows, `evaluate` under the policy allows no more.
    #[test]
    fn a_conforming_policy_can_never_outspend_the_ceiling(
        l in any_limit(),
        c in any_counter(),
        amount in 1u64..u64::MAX / 4,
        now in 0i64..MAX_NOW,
        ceiling_slack in 0u64..1_000_000u64,
    ) {
        let ceiling = MintCeiling {
            max_per_tx: l.per_tx_max.saturating_add(ceiling_slack),
            max_short_window: l.short_window_max.saturating_add(ceiling_slack),
            max_long_window: l.long_window_max.saturating_add(ceiling_slack),
            max_lifetime: l.lifetime_max.saturating_add(ceiling_slack),
            min_short_window_seconds: MIN_WINDOW_SECONDS,
            min_long_window_seconds: MIN_WINDOW_SECONDS,
        };
        prop_assume!(limit_leq_ceiling(&l, &ceiling));

        if let Ok(next) = evaluate(&l, &c, amount, u64::MAX, now) {
            prop_assert!(amount <= ceiling.max_per_tx);
            prop_assert!(next.short_spent <= ceiling.max_short_window);
            prop_assert!(next.long_spent <= ceiling.max_long_window);
            prop_assert!(next.lifetime_spent <= ceiling.max_lifetime);
        }
    }
}

#[test]
fn rejects_short_window_longer_than_long() {
    let l = MintLimit {
        mint: MINT_A,
        per_tx_max: 1,
        short_window_max: 1,
        short_window_seconds: 7_200,
        long_window_max: 1,
        long_window_seconds: 3_600,
        lifetime_max: 1,
    };
    assert_eq!(validate_limit(&l), Err(PolicyError::InvalidWindow));
}

#[test]
fn rejects_sub_minimum_windows() {
    let l = MintLimit {
        mint: MINT_A,
        per_tx_max: 1,
        short_window_max: 1,
        short_window_seconds: MIN_WINDOW_SECONDS - 1,
        long_window_max: 1,
        long_window_seconds: 3_600,
        lifetime_max: 1,
    };
    assert_eq!(validate_limit(&l), Err(PolicyError::InvalidWindow));

    let c = MintCeiling {
        max_per_tx: 1,
        max_short_window: 1,
        max_long_window: 1,
        max_lifetime: 1,
        min_short_window_seconds: MIN_WINDOW_SECONDS - 1,
        min_long_window_seconds: 3_600,
    };
    assert_eq!(validate_ceiling(&c), Err(PolicyError::InvalidWindow));
}

#[test]
fn rejects_duplicate_and_unconfigured_mints() {
    let ceiling = MintCeiling {
        max_per_tx: u64::MAX,
        max_short_window: u64::MAX,
        max_long_window: u64::MAX,
        max_lifetime: u64::MAX,
        min_short_window_seconds: MIN_WINDOW_SECONDS,
        min_long_window_seconds: MIN_WINDOW_SECONDS,
    };
    let treasury = TreasuryView {
        mints: &[MintCeilingEntry {
            mint: MINT_A,
            ceiling,
        }],
        allow_any_destination: true,
        allow_create_destination_ata: true,
    };
    let limit = MintLimit {
        mint: MINT_A,
        per_tx_max: 1,
        short_window_max: 1,
        short_window_seconds: MIN_WINDOW_SECONDS,
        long_window_max: 1,
        long_window_seconds: MIN_WINDOW_SECONDS,
        lifetime_max: 1,
    };

    let duplicated = [limit, limit];
    let args = PolicyArgsView {
        mint_limits: &duplicated,
        destination_mode: 0,
        require_memo: false,
        create_destination_ata: false,
    };
    assert_eq!(
        policy_leq_ceiling(&args, &treasury),
        Err(PolicyError::DuplicateMint)
    );

    let unconfigured = [MintLimit {
        mint: MINT_B,
        ..limit
    }];
    let args = PolicyArgsView {
        mint_limits: &unconfigured,
        destination_mode: 0,
        require_memo: false,
        create_destination_ata: false,
    };
    assert_eq!(
        policy_leq_ceiling(&args, &treasury),
        Err(PolicyError::MintNotConfigured)
    );
}

/// Spec §7.2: the two treasury ceiling flags gate the corresponding policy options.
#[test]
fn ceiling_flags_gate_policy_options() {
    let ceiling = MintCeiling {
        max_per_tx: u64::MAX,
        max_short_window: u64::MAX,
        max_long_window: u64::MAX,
        max_lifetime: u64::MAX,
        min_short_window_seconds: MIN_WINDOW_SECONDS,
        min_long_window_seconds: MIN_WINDOW_SECONDS,
    };
    let limits = [MintLimit {
        mint: MINT_A,
        per_tx_max: 1,
        short_window_max: 1,
        short_window_seconds: MIN_WINDOW_SECONDS,
        long_window_max: 1,
        long_window_seconds: MIN_WINDOW_SECONDS,
        lifetime_max: 1,
    }];

    let locked_down = TreasuryView {
        mints: &[MintCeilingEntry {
            mint: MINT_A,
            ceiling,
        }],
        allow_any_destination: false,
        allow_create_destination_ata: false,
    };

    let any_destination = PolicyArgsView {
        mint_limits: &limits,
        destination_mode: 0,
        require_memo: false,
        create_destination_ata: false,
    };
    assert_eq!(
        policy_leq_ceiling(&any_destination, &locked_down),
        Err(PolicyError::PolicyExceedsCeiling)
    );

    let creates_ata = PolicyArgsView {
        mint_limits: &limits,
        destination_mode: 1,
        require_memo: false,
        create_destination_ata: true,
    };
    assert_eq!(
        policy_leq_ceiling(&creates_ata, &locked_down),
        Err(PolicyError::PolicyExceedsCeiling)
    );

    let allowlist_only = PolicyArgsView {
        mint_limits: &limits,
        destination_mode: 1,
        require_memo: true,
        create_destination_ata: false,
    };
    assert_eq!(policy_leq_ceiling(&allowlist_only, &locked_down), Ok(()));
}

/// A fresh counter has `window_start == 0`; the first payment must land in the bucket
/// containing `now` rather than being charged against the epoch-zero bucket.
#[test]
fn fresh_counter_rolls_to_the_current_bucket() {
    let l = MintLimit {
        mint: MINT_A,
        per_tx_max: 100,
        short_window_max: 100,
        short_window_seconds: 3_600,
        long_window_max: 1_000,
        long_window_seconds: 86_400,
        lifetime_max: 10_000,
    };
    let now = 1_800_000_123i64;
    let next = evaluate(&l, &SpendCounter::default(), 50, u64::MAX, now).unwrap();

    assert_eq!(next.short_window_start, now - (now % 3_600));
    assert_eq!(next.long_window_start, now - (now % 86_400));
    assert_eq!(next.short_spent, 50);
    assert_eq!(next.lifetime_spent, 50);
}

/// The short window resets independently of the long window.
#[test]
fn windows_roll_independently() {
    let l = MintLimit {
        mint: MINT_A,
        per_tx_max: 100,
        short_window_max: 100,
        short_window_seconds: 3_600,
        long_window_max: 150,
        long_window_seconds: 86_400,
        lifetime_max: 10_000,
    };
    let t0 = 86_400i64;

    let after_first = evaluate(&l, &SpendCounter::default(), 100, u64::MAX, t0).unwrap();
    assert_eq!(
        evaluate(&l, &after_first, 100, u64::MAX, t0),
        Err(PolicyError::ExceedsShortWindow)
    );

    // One hour later the short window has rolled but the daily window has not.
    let t1 = t0 + 3_600;
    assert_eq!(
        evaluate(&l, &after_first, 100, u64::MAX, t1),
        Err(PolicyError::ExceedsLongWindow)
    );

    let after_second = evaluate(&l, &after_first, 50, u64::MAX, t1).unwrap();
    assert_eq!(after_second.short_spent, 50);
    assert_eq!(after_second.long_spent, 150);
    assert_eq!(after_second.lifetime_spent, 150);
}
