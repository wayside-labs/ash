//! The policy crate's hardcoded Anchor codes against the ones this program actually emits.
//!
//! `agent_rails_policy::PolicyError::anchor_code()` returns a literal — 6010, 6018, and so
//! on — while Anchor derives the real code from a variant's *position* in
//! `AgentRailsError`. Those are two independent facts that have to agree, and nothing made
//! them: `anchor_code()` is called from no other place in this workspace, so a divergence
//! is invisible until an operator reads the wrong reason for a refused payment.
//!
//! The policy crate's `error.rs` doc comment has claimed "a test asserts the codes agree"
//! since it was written. This is that test.
//!
//! Needs both crates, which is why it cannot live in the policy crate — that one has no
//! Solana dependency by design (ADR-008 layer 1). No SVM is involved here either: the
//! assertions are over types, so this file deliberately does not use `common`.

use agent_rails::error::AgentRailsError;
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

/// Exhaustive on purpose: a variant added to `PolicyError` stops this compiling, and the
/// only fix is to add it to `ALL` too. The same seam as the policy crate's own list — the
/// enum cannot be reflected over, so the match is what keeps the list honest.
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
fn the_list_covers_every_policy_error() {
    for (index, error) in ALL.iter().enumerate() {
        assert_eq!(
            position_of(*error),
            index,
            "{error} is listed out of order, or twice"
        );
    }
}

/// The assertion this file exists for.
///
/// Anchor numbers `#[error_code]` variants sequentially from 6000 by declaration order, so
/// inserting a variant anywhere but the end renumbers everything after it. `error.rs` says
/// "never reorder or remove a variant; append only" — this is what enforces it for the
/// subset the policy crate names, and it fails loudly on the exact codes that moved.
#[test]
fn the_policy_crate_agrees_with_the_anchor_codes_this_program_emits() {
    for policy_error in ALL {
        let emitted: u32 = AgentRailsError::from(*policy_error).into();
        assert_eq!(
            policy_error.anchor_code(),
            emitted,
            "{policy_error} claims code {} but this program emits {emitted}. Either a \
             variant was inserted rather than appended in AgentRailsError, or the literal \
             in agent-rails-policy's error.rs is stale — spec §9 has the numbers.",
            policy_error.anchor_code()
        );
    }
}

/// A `From` collapsing two policy errors onto one Anchor variant would compile and would
/// report one rule's denial under another rule's reason, which is the same failure the
/// policy crate guards against on its own side of the mapping.
#[test]
fn distinct_policy_errors_stay_distinct_through_the_mapping() {
    for (i, a) in ALL.iter().enumerate() {
        for b in &ALL[i + 1..] {
            let (a_code, b_code): (u32, u32) = (
                AgentRailsError::from(*a).into(),
                AgentRailsError::from(*b).into(),
            );
            assert_ne!(
                a_code, b_code,
                "{a} and {b} both map to Anchor code {a_code}"
            );
        }
    }
}
