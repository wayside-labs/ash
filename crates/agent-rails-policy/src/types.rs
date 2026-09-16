//! Solana-free mirrors of the on-chain policy types (spec §3).
//!
//! These carry only the fields the arithmetic needs; `reserved` blocks and v1.1 fields
//! stay in the Anchor structs so that a layout change cannot silently alter policy
//! semantics.

/// A public key, mirrored so this crate stays free of Solana dependencies.
pub type Key = [u8; 32];

/// Upper bound the treasury owner sets per mint. An operator's policy may be stricter but
/// never looser; see [`crate::limit_leq_ceiling`].
///
/// Mirrors `MintCeiling` (spec §3.1.1).
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct MintCeiling {
    pub max_per_tx: u64,
    pub max_short_window: u64,
    pub max_long_window: u64,
    pub max_lifetime: u64,
    pub min_short_window_seconds: u32,
    pub min_long_window_seconds: u32,
}

/// Per-mint spending limits an operator configures on a `Policy`.
///
/// Mirrors `MintLimit` (spec §3.2.1) without the v1.1 `approval_threshold` /
/// `cooldown_seconds` fields, which must be zero in v1.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct MintLimit {
    pub mint: Key,
    pub per_tx_max: u64,
    pub short_window_max: u64,
    pub short_window_seconds: u32,
    pub long_window_max: u64,
    pub long_window_seconds: u32,
    /// Per session. `u64::MAX` means unlimited, and still has to fit under the ceiling.
    pub lifetime_max: u64,
}

/// Rolling spend state for one mint inside one session.
///
/// Mirrors `SpendCounter` (spec §3.3.1). A fresh counter has `window_start == 0`, which
/// [`crate::rollover`] advances to the current bucket on first use.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct SpendCounter {
    pub mint: Key,
    pub short_window_start: i64,
    pub short_spent: u64,
    pub long_window_start: i64,
    pub long_spent: u64,
    pub lifetime_spent: u64,
    pub last_payment_at: i64,
}

/// Headroom per dimension after rollover, as surfaced by `check_payment` / `get_session`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Remaining {
    pub per_tx: u64,
    pub short: u64,
    pub long: u64,
    pub lifetime: u64,
}

/// One configured mint slot of a `Treasury`, reduced to what the ceiling check needs.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct MintCeilingEntry {
    pub mint: Key,
    pub ceiling: MintCeiling,
}

/// The subset of `Treasury` that bounds a policy.
#[derive(Clone, Copy, Debug)]
pub struct TreasuryView<'a> {
    /// Configured slots only; unused slots must not be passed in.
    pub mints: &'a [MintCeilingEntry],
    pub allow_any_destination: bool,
    pub allow_create_destination_ata: bool,
}

/// The `PolicyInput` instruction payload (spec §4.2), borrowed rather than owned so the
/// crate works under `no_std` without an allocator.
#[derive(Clone, Copy, Debug)]
pub struct PolicyInputView<'a> {
    pub mint_limits: &'a [MintLimit],
    pub destination_mode: u8,
    pub require_memo: bool,
    pub create_destination_ata: bool,
}

/// How a policy constrains payment destinations (spec §1).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[repr(u8)]
pub enum DestinationMode {
    Any = 0,
    Allowlist = 1,
}

impl DestinationMode {
    /// Returns `None` for an unknown discriminant so callers can reject it explicitly.
    pub const fn from_u8(value: u8) -> Option<Self> {
        match value {
            0 => Some(Self::Any),
            1 => Some(Self::Allowlist),
            _ => None,
        }
    }
}
