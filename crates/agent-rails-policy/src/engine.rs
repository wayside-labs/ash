//! Validation, the ceiling partial order, window rollover, and limit evaluation.
//!
//! Every function here is pure and total: no panics, no allocation, no clock access. All
//! arithmetic is `checked_*`, and the few places that saturate do so in the direction that
//! keeps the caller safe (a saturated counter can only reject more payments, never fewer).

use crate::error::PolicyError;
use crate::types::{
    DestinationMode, MintCeiling, MintLimit, PolicyArgsView, Remaining, SpendCounter, TreasuryView,
};
use crate::{MAX_MINTS, MIN_WINDOW_SECONDS};

/// Checks a single `MintLimit` in isolation (spec §5.2, `create_policy`).
///
/// Note that this deliberately does *not* require the maxima to be ordered
/// (`per_tx ≤ short ≤ long ≤ lifetime`). An operator may legitimately set a per-tx cap
/// above the window cap; the window simply becomes the binding constraint.
pub fn validate_limit(l: &MintLimit) -> Result<(), PolicyError> {
    if l.short_window_seconds < MIN_WINDOW_SECONDS || l.long_window_seconds < MIN_WINDOW_SECONDS {
        return Err(PolicyError::InvalidWindow);
    }
    if l.short_window_seconds > l.long_window_seconds {
        return Err(PolicyError::InvalidWindow);
    }
    if l.per_tx_max == 0 || l.short_window_max == 0 || l.long_window_max == 0 || l.lifetime_max == 0
    {
        return Err(PolicyError::InvalidLimit);
    }
    Ok(())
}

/// Checks a single `MintCeiling` in isolation (spec §5.1, `add_mint` / `set_ceiling`).
pub fn validate_ceiling(c: &MintCeiling) -> Result<(), PolicyError> {
    if c.min_short_window_seconds < MIN_WINDOW_SECONDS
        || c.min_long_window_seconds < MIN_WINDOW_SECONDS
    {
        return Err(PolicyError::InvalidWindow);
    }
    if c.min_short_window_seconds > c.min_long_window_seconds {
        return Err(PolicyError::InvalidWindow);
    }
    if c.max_per_tx == 0 || c.max_short_window == 0 || c.max_long_window == 0 || c.max_lifetime == 0
    {
        return Err(PolicyError::InvalidLimit);
    }
    Ok(())
}

/// The partial order between an operator's limit and the owner's ceiling.
///
/// Every amount must be no larger, and every window must be no *shorter* — a shorter
/// window would let the same cap be spent more often, so it is the loosening direction.
pub fn limit_leq_ceiling(l: &MintLimit, c: &MintCeiling) -> bool {
    l.per_tx_max <= c.max_per_tx
        && l.short_window_max <= c.max_short_window
        && l.long_window_max <= c.max_long_window
        && l.lifetime_max <= c.max_lifetime
        && l.short_window_seconds >= c.min_short_window_seconds
        && l.long_window_seconds >= c.min_long_window_seconds
}

/// Whole-policy ceiling check used by `create_policy`, `update_policy`, and the runtime
/// re-check in `execute_payment` (spec §7.2).
pub fn policy_leq_ceiling(p: &PolicyArgsView, t: &TreasuryView) -> Result<(), PolicyError> {
    if p.mint_limits.is_empty() {
        return Err(PolicyError::InvalidLimit);
    }
    if p.mint_limits.len() > MAX_MINTS {
        return Err(PolicyError::MintSlotsFull);
    }

    for (i, limit) in p.mint_limits.iter().enumerate() {
        if p.mint_limits[..i]
            .iter()
            .any(|other| other.mint == limit.mint)
        {
            return Err(PolicyError::DuplicateMint);
        }
        validate_limit(limit)?;

        let entry = t
            .mints
            .iter()
            .find(|entry| entry.mint == limit.mint)
            .ok_or(PolicyError::MintNotConfigured)?;
        if !limit_leq_ceiling(limit, &entry.ceiling) {
            return Err(PolicyError::PolicyExceedsCeiling);
        }
    }

    match DestinationMode::from_u8(p.destination_mode) {
        Some(DestinationMode::Any) if !t.allow_any_destination => {
            return Err(PolicyError::PolicyExceedsCeiling)
        }
        Some(_) => {}
        None => return Err(PolicyError::InvalidLimit),
    }
    if p.create_destination_ata && !t.allow_create_destination_ata {
        return Err(PolicyError::PolicyExceedsCeiling);
    }
    Ok(())
}

/// Advances one window's bucket start to the bucket containing `now`, zeroing the spend if
/// it rolled over. Returns the input unchanged when `now` is still inside the bucket, which
/// makes the operation idempotent within a bucket.
fn roll_window(start: i64, spent: u64, window_seconds: u32, now: i64) -> (i64, u64) {
    let window = i64::from(window_seconds);
    if window <= 0 {
        return (start, spent);
    }
    // A start so large that `start + window` overflows can only come from a corrupted
    // account; leaving it untouched keeps the counter at its current (stricter) state.
    let Some(end) = start.checked_add(window) else {
        return (start, spent);
    };
    if now < end {
        return (start, spent);
    }
    let Some(elapsed) = now.checked_sub(start) else {
        return (start, spent);
    };
    let Some(buckets) = elapsed.checked_div(window) else {
        return (start, spent);
    };
    let Some(new_start) = buckets
        .checked_mul(window)
        .and_then(|offset| start.checked_add(offset))
    else {
        return (start, spent);
    };
    (new_start, 0)
}

/// Advances both buckets of a counter to `now`. Pure; see spec §7.1.
///
/// Postconditions when no overflow guard fires:
/// `window_start ≤ now < window_start + window_seconds`, and applying `rollover` twice with
/// the same `now` yields the same counter.
pub fn rollover(counter: &SpendCounter, l: &MintLimit, now: i64) -> SpendCounter {
    let (short_window_start, short_spent) = roll_window(
        counter.short_window_start,
        counter.short_spent,
        l.short_window_seconds,
        now,
    );
    let (long_window_start, long_spent) = roll_window(
        counter.long_window_start,
        counter.long_spent,
        l.long_window_seconds,
        now,
    );
    SpendCounter {
        short_window_start,
        short_spent,
        long_window_start,
        long_spent,
        ..*counter
    }
}

/// Rollover plus every limit check, returning the counter as it would look after the
/// payment. The caller commits the result only once the transfer CPI has succeeded.
///
/// `effective_per_tx` is the allowlist-adjusted cap from spec §5.3 step 10; the policy's own
/// `per_tx_max` still applies, so an override can only tighten.
pub fn evaluate(
    l: &MintLimit,
    counter: &SpendCounter,
    amount: u64,
    effective_per_tx: u64,
    now: i64,
) -> Result<SpendCounter, PolicyError> {
    let rolled = rollover(counter, l, now);

    let per_tx_cap = core::cmp::min(effective_per_tx, l.per_tx_max);
    if amount > per_tx_cap {
        return Err(PolicyError::ExceedsPerTxMax);
    }

    let short_spent = rolled
        .short_spent
        .checked_add(amount)
        .ok_or(PolicyError::MathOverflow)?;
    if short_spent > l.short_window_max {
        return Err(PolicyError::ExceedsShortWindow);
    }

    let long_spent = rolled
        .long_spent
        .checked_add(amount)
        .ok_or(PolicyError::MathOverflow)?;
    if long_spent > l.long_window_max {
        return Err(PolicyError::ExceedsLongWindow);
    }

    let lifetime_spent = rolled
        .lifetime_spent
        .checked_add(amount)
        .ok_or(PolicyError::MathOverflow)?;
    if lifetime_spent > l.lifetime_max {
        return Err(PolicyError::ExceedsLifetime);
    }

    Ok(SpendCounter {
        short_spent,
        long_spent,
        lifetime_spent,
        last_payment_at: now,
        ..rolled
    })
}

/// Headroom in each dimension after rollover. Saturates at zero for counters that already
/// sit above their limit, which is reachable when `update_policy` lowers a cap mid-window.
pub fn remaining(l: &MintLimit, counter: &SpendCounter, now: i64) -> Remaining {
    let rolled = rollover(counter, l, now);
    Remaining {
        per_tx: l.per_tx_max,
        short: l.short_window_max.saturating_sub(rolled.short_spent),
        long: l.long_window_max.saturating_sub(rolled.long_spent),
        lifetime: l.lifetime_max.saturating_sub(rolled.lifetime_spent),
    }
}
