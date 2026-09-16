//! Policy failures, carrying the Anchor code and SDK `reason_code` from spec §9.
//!
//! The numbers live here rather than only in the program so that off-chain simulation and
//! the on-chain runtime cannot drift apart: `programs/agent_rails/src/error.rs` maps every
//! variant back to the matching `AgentRailsError`, and
//! `programs/agent_rails/tests/error_codes.rs` asserts the codes agree. They are two
//! independent facts — a literal here, a declaration position there — so nothing but that
//! test holds them together.

/// A policy rule that a candidate payment or configuration violates.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PolicyError {
    /// The mint has no slot in `Treasury.mints`.
    MintNotConfigured,
    /// The mint has no slot in `Policy.mint_limits`.
    MintNotInPolicy,
    /// The session has no free `SpendCounter` slot for the mint.
    MintNotInSession,
    ExceedsPerTxMax,
    ExceedsShortWindow,
    ExceedsLongWindow,
    ExceedsLifetime,
    /// A limit is looser than the treasury ceiling, or a ceiling flag is not set.
    PolicyExceedsCeiling,
    /// A window duration is below the minimum, or short is longer than long.
    InvalidWindow,
    /// A maximum is zero, or an allowlist override exceeds the policy per-tx max.
    InvalidLimit,
    /// More than `MAX_MINTS` limits, or none at all.
    MintSlotsFull,
    DuplicateMint,
    MathOverflow,
}

impl PolicyError {
    /// The Anchor custom error code this maps to (spec §9).
    pub const fn anchor_code(self) -> u32 {
        match self {
            Self::MintNotConfigured => 6010,
            Self::MintNotInPolicy => 6011,
            Self::MintNotInSession => 6012,
            Self::ExceedsPerTxMax => 6018,
            Self::ExceedsShortWindow => 6019,
            Self::ExceedsLongWindow => 6020,
            Self::ExceedsLifetime => 6021,
            Self::PolicyExceedsCeiling => 6023,
            Self::InvalidWindow => 6024,
            Self::InvalidLimit => 6025,
            Self::MintSlotsFull => 6027,
            Self::DuplicateMint => 6028,
            Self::MathOverflow => 6040,
        }
    }

    /// The stable string the SDK, MCP tools, and adapters surface (spec §9).
    pub const fn reason_code(self) -> &'static str {
        match self {
            Self::MintNotConfigured => "MINT_NOT_CONFIGURED",
            Self::MintNotInPolicy => "MINT_NOT_IN_POLICY",
            Self::MintNotInSession => "MINT_NOT_IN_SESSION",
            Self::ExceedsPerTxMax => "EXCEEDS_PER_TX_MAX",
            Self::ExceedsShortWindow => "EXCEEDS_SHORT_WINDOW",
            Self::ExceedsLongWindow => "EXCEEDS_LONG_WINDOW",
            Self::ExceedsLifetime => "EXCEEDS_LIFETIME",
            Self::PolicyExceedsCeiling => "POLICY_EXCEEDS_CEILING",
            Self::InvalidWindow => "INVALID_WINDOW",
            Self::InvalidLimit => "INVALID_LIMIT",
            Self::MintSlotsFull => "MINT_SLOTS_FULL",
            Self::DuplicateMint => "DUPLICATE_MINT",
            Self::MathOverflow => "MATH_OVERFLOW",
        }
    }
}

impl core::fmt::Display for PolicyError {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        f.write_str(self.reason_code())
    }
}

#[cfg(feature = "std")]
impl std::error::Error for PolicyError {}
