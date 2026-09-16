//! Properties of the `PolicyError` code tables (spec §9).
//!
//! These two `match` arms are the kind of code that reads as too mechanical to test, which
//! is exactly what makes a copy-pasted arm survive review: a duplicated code or reason
//! string compiles, passes every other test in this crate, and surfaces as the wrong
//! `reason_code` in an operator's audit trail.
//!
//! What this file does *not* check is whether the numbers match the Anchor codes the
//! program actually emits — that needs both crates, so it lives in
//! `programs/agent_rails/tests/error_codes.rs`. Here the assertions are the ones provable
//! from this crate alone, and none of them restates the table.

use agent_rails_policy::PolicyError;

const ALL: &[PolicyError] = &[
    PolicyError::MintNotConfigured,
    PolicyError::MintNotInPolicy,
    PolicyError::MintNotInSession,
    PolicyError::ExceedsPerTxMax,
    PolicyError::ExceedsShortWindow,
    PolicyError::ExceedsLongWindow,
    PolicyError::ExceedsLifetime,
    PolicyError::PolicyExceedsCeiling,
    PolicyError::InvalidWindow,
    PolicyError::InvalidLimit,
    PolicyError::MintSlotsFull,
    PolicyError::DuplicateMint,
    PolicyError::MathOverflow,
];

/// Exhaustive by construction: adding a variant to `PolicyError` stops this compiling, and
/// the only way to fix it is to add the variant to `ALL` as well. Rust has no reflection
/// over an enum, so this match is the seam that keeps the list from silently falling behind
/// the type it enumerates.
const fn position_of(e: PolicyError) -> usize {
    match e {
        PolicyError::MintNotConfigured => 0,
        PolicyError::MintNotInPolicy => 1,
        PolicyError::MintNotInSession => 2,
        PolicyError::ExceedsPerTxMax => 3,
        PolicyError::ExceedsShortWindow => 4,
        PolicyError::ExceedsLongWindow => 5,
        PolicyError::ExceedsLifetime => 6,
        PolicyError::PolicyExceedsCeiling => 7,
        PolicyError::InvalidWindow => 8,
        PolicyError::InvalidLimit => 9,
        PolicyError::MintSlotsFull => 10,
        PolicyError::DuplicateMint => 11,
        PolicyError::MathOverflow => 12,
    }
}

#[test]
fn all_lists_every_variant_exactly_once() {
    for (index, error) in ALL.iter().enumerate() {
        assert_eq!(
            position_of(*error),
            index,
            "{error} is listed out of order, or twice"
        );
    }
}

/// A duplicate here would give two distinct denials the same Anchor code, and the SDK maps
/// a code back to exactly one reason string — so the second rule would be reported as the
/// first, in the record the owner reads to find out why a payment was refused.
#[test]
fn every_variant_has_its_own_anchor_code() {
    for (i, a) in ALL.iter().enumerate() {
        for b in &ALL[i + 1..] {
            assert_ne!(
                a.anchor_code(),
                b.anchor_code(),
                "{a} and {b} share anchor code {}",
                a.anchor_code()
            );
        }
    }
}

#[test]
fn every_variant_has_its_own_reason_code() {
    for (i, a) in ALL.iter().enumerate() {
        for b in &ALL[i + 1..] {
            assert_ne!(
                a.reason_code(),
                b.reason_code(),
                "{a} and {b} share reason code {}",
                a.reason_code()
            );
        }
    }
}

/// Anchor assigns custom errors from 6000. A code outside that range is not one the
/// program can emit, so it would map to nothing on the way back out.
#[test]
fn every_anchor_code_is_in_the_custom_error_range() {
    for error in ALL {
        let code = error.anchor_code();
        assert!(
            (6000..7000).contains(&code),
            "{error} has anchor code {code}, outside Anchor's custom error range"
        );
    }
}

/// The SDK, MCP tools and adapters key off this string. Lowercase or a space in one would
/// break a consumer matching on the documented spelling rather than fail here.
#[test]
fn every_reason_code_is_screaming_snake_case() {
    for error in ALL {
        let reason = error.reason_code();
        assert!(!reason.is_empty(), "{error} has an empty reason code");
        assert!(
            reason
                .chars()
                .all(|c| c.is_ascii_uppercase() || c == '_' || c.is_ascii_digit()),
            "{error} has reason code {reason}, which is not SCREAMING_SNAKE_CASE"
        );
    }
}

/// `Display` exists so an error can be logged without the caller reaching for
/// `reason_code()` and getting a different string than the audit record carries.
#[test]
fn display_is_the_reason_code() {
    for error in ALL {
        assert_eq!(std::format!("{error}"), error.reason_code());
    }
}
