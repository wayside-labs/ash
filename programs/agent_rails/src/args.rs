//! Instruction argument types (spec §4).
//!
//! These mirror the on-chain structs without their `reserved` blocks or v1.1 fields, so a
//! client can never set a byte the program is going to overwrite with zero anyway.

use anchor_lang::prelude::*;

use crate::state::MintCeiling;

/// `MintCeilingArgs` (spec §4.2). Amounts are in base units.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct MintCeilingArgs {
    pub max_per_tx: u64,
    pub max_short_window: u64,
    pub max_long_window: u64,
    pub max_lifetime: u64,
    pub min_short_window_seconds: u32,
    pub min_long_window_seconds: u32,
}

impl MintCeilingArgs {
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

/// `MintLimitArgs` (spec §4.2).
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct MintLimitArgs {
    pub mint: Pubkey,
    pub per_tx_max: u64,
    pub short_window_max: u64,
    pub short_window_seconds: u32,
    pub long_window_max: u64,
    pub long_window_seconds: u32,
    pub lifetime_max: u64,
}
