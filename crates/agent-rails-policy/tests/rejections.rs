//! The rejection and defensive paths, which proptest does not reach.
//!
//! `proptests.rs` generates inputs that are valid by construction and asserts properties
//! over them — that is what makes it good at the arithmetic and blind to the guards. Every
//! branch below is a refusal: a zero limit, a window ordering that cannot hold, a
//! discriminant the program does not know, or state a corrupted account could carry. None
//! of them can be reached by a well-formed input, and all of them decide whether a payment
//! is allowed.

use agent_rails_policy::{
    policy_leq_ceiling, rollover, validate_ceiling, validate_limit, DestinationMode, Key,
    MintCeiling, MintCeilingEntry, MintLimit, PolicyError, PolicyInputView, SpendCounter,
    TreasuryView, MAX_MINTS, MIN_WINDOW_SECONDS,
};

const MINT_A: Key = [1u8; 32];
const MINT_B: Key = [2u8; 32];

fn valid_limit(mint: Key) -> MintLimit {
    MintLimit {
        mint,
        per_tx_max: 1_000,
        short_window_max: 10_000,
        short_window_seconds: MIN_WINDOW_SECONDS,
        long_window_max: 100_000,
        long_window_seconds: MIN_WINDOW_SECONDS * 2,
        lifetime_max: 1_000_000,
    }
}

fn valid_ceiling() -> MintCeiling {
    MintCeiling {
        max_per_tx: u64::MAX,
        max_short_window: u64::MAX,
        max_long_window: u64::MAX,
        max_lifetime: u64::MAX,
        min_short_window_seconds: MIN_WINDOW_SECONDS,
        min_long_window_seconds: MIN_WINDOW_SECONDS,
    }
}

/// A zero maximum is not "no limit", it is a limit nothing can satisfy. Spec §5.1 rejects
/// it at configuration time rather than letting every payment fail the comparison later.
#[test]
fn a_zero_maximum_is_rejected_in_every_position() {
    for (label, mutate) in [
        (
            "per_tx_max",
            (|l: &mut MintLimit| l.per_tx_max = 0) as fn(&mut MintLimit),
        ),
        ("short_window_max", |l: &mut MintLimit| {
            l.short_window_max = 0
        }),
        ("long_window_max", |l: &mut MintLimit| l.long_window_max = 0),
        ("lifetime_max", |l: &mut MintLimit| l.lifetime_max = 0),
    ] {
        let mut limit = valid_limit(MINT_A);
        mutate(&mut limit);
        assert_eq!(
            validate_limit(&limit),
            Err(PolicyError::InvalidLimit),
            "a zero {label} was accepted"
        );
    }
}

#[test]
fn a_zero_ceiling_maximum_is_rejected_in_every_position() {
    for (label, mutate) in [
        (
            "max_per_tx",
            (|c: &mut MintCeiling| c.max_per_tx = 0) as fn(&mut MintCeiling),
        ),
        ("max_short_window", |c: &mut MintCeiling| {
            c.max_short_window = 0
        }),
        ("max_long_window", |c: &mut MintCeiling| {
            c.max_long_window = 0
        }),
        ("max_lifetime", |c: &mut MintCeiling| c.max_lifetime = 0),
    ] {
        let mut ceiling = valid_ceiling();
        mutate(&mut ceiling);
        assert_eq!(
            validate_ceiling(&ceiling),
            Err(PolicyError::InvalidLimit),
            "a zero {label} was accepted"
        );
    }
}

/// The ceiling's *minimum* windows invert the comparison: a short window may not be
/// required to outlast the long one, or no limit could satisfy both.
#[test]
fn a_ceiling_with_short_minimum_above_long_is_rejected() {
    let ceiling = MintCeiling {
        min_short_window_seconds: MIN_WINDOW_SECONDS * 2,
        min_long_window_seconds: MIN_WINDOW_SECONDS,
        ..valid_ceiling()
    };
    assert_eq!(validate_ceiling(&ceiling), Err(PolicyError::InvalidWindow));
}

#[test]
fn a_well_formed_ceiling_is_accepted() {
    assert_eq!(validate_ceiling(&valid_ceiling()), Ok(()));
}

/// A policy with no mint limits would pass every per-mint check vacuously and permit
/// nothing, which reads as a misconfiguration rather than an intent to freeze the session.
#[test]
fn a_policy_with_no_mint_limits_is_rejected() {
    let treasury = TreasuryView {
        mints: &[MintCeilingEntry {
            mint: MINT_A,
            ceiling: valid_ceiling(),
        }],
        allow_any_destination: true,
        allow_create_destination_ata: true,
    };
    let args = PolicyInputView {
        mint_limits: &[],
        destination_mode: DestinationMode::Any as u8,
        require_memo: false,
        create_destination_ata: false,
    };
    assert_eq!(
        policy_leq_ceiling(&args, &treasury),
        Err(PolicyError::InvalidLimit)
    );
}

/// `MAX_MINTS` is a fixed array bound on chain (spec §3.2), so exceeding it is a slot
/// exhaustion rather than a limit violation — the distinct code is what tells an operator
/// to remove a mint instead of lowering a number.
#[test]
fn a_policy_with_more_limits_than_slots_is_rejected() {
    let ceiling = valid_ceiling();
    let mints: Vec<MintCeilingEntry> = (0..=MAX_MINTS)
        .map(|i| MintCeilingEntry {
            mint: [i as u8; 32],
            ceiling,
        })
        .collect();
    let limits: Vec<MintLimit> = (0..=MAX_MINTS)
        .map(|i| valid_limit([i as u8; 32]))
        .collect();

    let treasury = TreasuryView {
        mints: &mints,
        allow_any_destination: true,
        allow_create_destination_ata: true,
    };
    let args = PolicyInputView {
        mint_limits: &limits,
        destination_mode: DestinationMode::Any as u8,
        require_memo: false,
        create_destination_ata: false,
    };
    assert_eq!(
        policy_leq_ceiling(&args, &treasury),
        Err(PolicyError::MintSlotsFull)
    );
}

/// A discriminant this version does not know must be refused, not defaulted. Defaulting it
/// to `Allowlist` would be safe today and wrong the moment a later version adds a mode:
/// the old program would silently enforce a rule the operator did not choose.
#[test]
fn an_unknown_destination_mode_is_rejected() {
    let limits = [valid_limit(MINT_A)];
    let treasury = TreasuryView {
        mints: &[MintCeilingEntry {
            mint: MINT_A,
            ceiling: valid_ceiling(),
        }],
        allow_any_destination: true,
        allow_create_destination_ata: true,
    };
    for byte in [2u8, 3, 255] {
        let args = PolicyInputView {
            mint_limits: &limits,
            destination_mode: byte,
            require_memo: false,
            create_destination_ata: false,
        };
        assert_eq!(
            policy_leq_ceiling(&args, &treasury),
            Err(PolicyError::InvalidLimit),
            "destination_mode {byte} was accepted"
        );
        assert_eq!(DestinationMode::from_u8(byte), None);
    }
}

#[test]
fn the_known_destination_modes_round_trip() {
    assert_eq!(DestinationMode::from_u8(0), Some(DestinationMode::Any));
    assert_eq!(
        DestinationMode::from_u8(1),
        Some(DestinationMode::Allowlist)
    );
}

fn counter(mint: Key, start: i64, spent: u64) -> SpendCounter {
    SpendCounter {
        mint,
        short_window_start: start,
        short_spent: spent,
        long_window_start: start,
        long_spent: spent,
        lifetime_spent: spent,
        last_payment_at: start,
    }
}

/// Window state comes out of an account, so `rollover` has to survive values
/// `validate_limit` would never have let through. The rule in every case is to leave the
/// counter alone: the stored spend is the stricter answer, and zeroing it on nonsense
/// input would hand back budget the session never earned.
#[test]
fn a_zero_length_window_leaves_the_counter_untouched() {
    let limit = MintLimit {
        short_window_seconds: 0,
        long_window_seconds: 0,
        ..valid_limit(MINT_B)
    };
    let before = counter(MINT_B, 1_000, 500);
    let after = rollover(&before, &limit, 10_000_000);
    assert_eq!(after.short_spent, 500);
    assert_eq!(after.long_spent, 500);
    assert_eq!(after.short_window_start, 1_000);
}

#[test]
fn a_window_start_that_would_overflow_leaves_the_counter_untouched() {
    let limit = valid_limit(MINT_B);
    let before = counter(MINT_B, i64::MAX, 500);
    let after = rollover(&before, &limit, i64::MAX);
    assert_eq!(after.short_spent, 500);
    assert_eq!(after.short_window_start, i64::MAX);
}

#[test]
fn an_elapsed_span_that_would_overflow_leaves_the_counter_untouched() {
    let limit = valid_limit(MINT_B);
    let before = counter(MINT_B, i64::MIN, 500);
    let after = rollover(&before, &limit, i64::MAX);
    assert_eq!(after.short_spent, 500);
    assert_eq!(after.short_window_start, i64::MIN);
}

/// The ordinary case, kept next to the defensive ones so the contrast is visible: inside
/// the bucket nothing moves, which is what makes rollover idempotent within a window.
#[test]
fn a_timestamp_inside_the_bucket_leaves_the_counter_untouched() {
    let limit = valid_limit(MINT_B);
    let before = counter(MINT_B, 1_000, 500);
    let after = rollover(&before, &limit, 1_000 + i64::from(MIN_WINDOW_SECONDS) - 1);
    assert_eq!(after, before);
}
