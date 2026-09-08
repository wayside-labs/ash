//! Pure policy core for the `agent_rails` program.
//!
//! Everything an agent payment is allowed to do — window rollover, limit evaluation, the
//! ceiling partial order, and the audit hash chain — lives here, with no Solana
//! dependency and no I/O. Public keys are mirrored as plain `[u8; 32]`. The Anchor layer
//! (`programs/agent_rails`) is reduced to account validation and CPI, which is what makes
//! layer 1 of the test pyramid in ADR-008 possible: this crate can be property-tested and
//! model-checked at millions of cases per second without an SVM.
//!
//! See `docs/spec/accounts-and-instructions.md` §7 for the contract this crate implements.

#![cfg_attr(not(feature = "std"), no_std)]
#![forbid(unsafe_code)]
#![deny(clippy::arithmetic_side_effects)]

mod audit;
mod engine;
mod error;
mod types;

pub use audit::{
    audit_preimage, genesis_preimage, AUDIT_PREIMAGE_LEN, DOMAIN_AUDIT, DOMAIN_INTENT,
    GENESIS_PREIMAGE_LEN,
};
#[cfg(feature = "hash")]
pub use audit::{genesis_audit_head, next_audit_head};
pub use engine::{
    evaluate, limit_leq_ceiling, policy_leq_ceiling, remaining, rollover, validate_ceiling,
    validate_limit,
};
pub use error::PolicyError;
pub use types::{
    DestinationMode, Key, MintCeiling, MintCeilingEntry, MintLimit, PolicyArgsView, Remaining,
    SpendCounter, TreasuryView,
};

/// Maximum mint slots in a `Treasury` or a `Policy` (spec §1).
pub const MAX_MINTS: usize = 4;

/// Lower bound on any configurable window duration, in seconds (spec §1).
pub const MIN_WINDOW_SECONDS: u32 = 60;
