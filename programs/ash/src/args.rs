//! Instruction argument types (spec §4).
//!
//! These mirror the on-chain structs without their `reserved` blocks or v1.1 fields, so a
//! client can never set a byte the program is going to overwrite with zero anyway.

use anchor_lang::prelude::*;

use crate::constants::{INTENT_ID_LEN, MAX_MINTS};
use crate::state::{MintCeiling, MintLimit};

/// `MintCeilingInput` (spec §4.2). Amounts are in base units.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct MintCeilingInput {
    pub max_per_tx: u64,
    pub max_short_window: u64,
    pub max_long_window: u64,
    pub max_lifetime: u64,
    pub min_short_window_seconds: u32,
    pub min_long_window_seconds: u32,
}

impl MintCeilingInput {
    pub fn to_state(self) -> MintCeiling {
        MintCeiling {
            max_per_tx: self.max_per_tx,
            max_short_window: self.max_short_window,
            max_long_window: self.max_long_window,
            max_lifetime: self.max_lifetime,
            min_short_window_seconds: self.min_short_window_seconds,
            min_long_window_seconds: self.min_long_window_seconds,
        }
    }
}

/// `MintLimitInput` (spec §4.2).
///
/// The v1.1 `approval_threshold` and `cooldown_seconds` fields are deliberately absent: the
/// program writes them as zero, so there is no way for a client to set a byte that a future
/// version will interpret differently.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct MintLimitInput {
    pub mint: Pubkey,
    pub per_tx_max: u64,
    pub short_window_max: u64,
    pub short_window_seconds: u32,
    pub long_window_max: u64,
    pub long_window_seconds: u32,
    pub lifetime_max: u64,
}

impl MintLimitInput {
    pub fn to_state(self) -> MintLimit {
        MintLimit {
            mint: self.mint,
            per_tx_max: self.per_tx_max,
            short_window_max: self.short_window_max,
            short_window_seconds: self.short_window_seconds,
            long_window_max: self.long_window_max,
            long_window_seconds: self.long_window_seconds,
            lifetime_max: self.lifetime_max,
            approval_threshold: 0,
            cooldown_seconds: 0,
            reserved: [0u8; 12],
        }
    }

    /// Solana-free view for the policy crate.
    pub fn to_policy(self) -> ash_policy::MintLimit {
        ash_policy::MintLimit {
            mint: self.mint.to_bytes(),
            per_tx_max: self.per_tx_max,
            short_window_max: self.short_window_max,
            short_window_seconds: self.short_window_seconds,
            long_window_max: self.long_window_max,
            long_window_seconds: self.long_window_seconds,
            lifetime_max: self.lifetime_max,
        }
    }
}

/// `PolicyInput` (spec §4.2) — the full rule set an operator writes in one instruction.
///
/// Passed whole rather than field by field so that `policy_leq_ceiling` can judge it as a
/// unit: whether a policy is legal depends on every limit *and* both destination flags
/// together, and a per-field setter would let an operator step through an illegal
/// intermediate state.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, Default, PartialEq, Eq)]
pub struct PolicyInput {
    /// 1..=`MAX_MINTS` entries, each for a mint configured on the treasury.
    pub mint_limits: Vec<MintLimitInput>,
    /// `DestinationMode`.
    pub destination_mode: u8,
    pub require_memo: bool,
    /// Requires `Treasury.allow_create_destination_ata`.
    pub create_destination_ata: bool,
}

impl PolicyInput {
    /// The limits as the policy crate sees them, plus how many slots are used.
    ///
    /// Returns a fixed array rather than a `Vec` so the caller can hand the crate a slice
    /// without allocating; `mint_limits` longer than `MAX_MINTS` is rejected before this
    /// is called.
    pub fn to_policy_limits(&self) -> ([ash_policy::MintLimit; MAX_MINTS], usize) {
        let mut limits = [ash_policy::MintLimit::default(); MAX_MINTS];
        let used = self.mint_limits.len().min(MAX_MINTS);
        for (slot, arg) in limits.iter_mut().zip(self.mint_limits.iter()) {
            *slot = arg.to_policy();
        }
        (limits, used)
    }
}

/// `PaymentIntent` (spec §4.1) — the canonical `execute_payment` payload.
///
/// This is the whole agent-facing surface: an agent names a destination, an amount, and an
/// expiry, and the program decides. Two fields are load-bearing beyond the transfer itself.
/// `intent_id` is the idempotency key — it seeds the `IntentReceipt` PDA, so a retried
/// intent fails at account creation rather than paying twice (ADR-004). `expires_at` is
/// mandatory and short, so a stale intent cannot be resurrected later even after its
/// receipt has been closed.
///
/// In v1.1 signed-intent mode the signed message is
/// `DOMAIN_INTENT ‖ program_id ‖ treasury ‖ session ‖ borsh(PaymentIntent)`. The struct is
/// frozen now so v1 SDKs can already produce those bytes.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, Default, PartialEq, Eq)]
pub struct PaymentIntent {
    /// Client-generated, UUIDv7 by default. Also the raw `IntentReceipt` seed.
    pub intent_id: [u8; INTENT_ID_LEN],
    /// `NATIVE_MINT` selects the `execute_payment_sol` path and is rejected on the other.
    pub mint: Pubkey,
    /// Wallet owner. The destination token account is derived on-chain from this, never
    /// passed in as a bare address, so an agent cannot be pointed at a look-alike account.
    pub destination_owner: Pubkey,
    /// Base units debited from the vault, before any Token-2022 transfer fee.
    pub amount: u64,
    /// Unix seconds; `now + [MIN_INTENT_TTL_SECONDS, MAX_INTENT_TTL_SECONDS]`.
    pub expires_at: i64,
    /// `≤ MAX_MEMO_LEN` bytes. Only `sha256(memo)` is stored, in the receipt.
    pub memo: Vec<u8>,
}
