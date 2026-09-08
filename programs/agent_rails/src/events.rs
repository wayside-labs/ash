//! Events, emitted via `emit_cpi!` so they survive log truncation (spec §8).
//!
//! Every variant carries `treasury` and `schema_version` so an indexer can route and
//! version a record without joining against anything else.

use anchor_lang::prelude::*;

use crate::state::MintCeiling;

/// Bumped whenever an event's field set changes in a non-additive way.
pub const EVENT_SCHEMA_VERSION: u8 = 1;

#[event]
pub struct TreasuryCreated {
    pub treasury: Pubkey,
    pub schema_version: u8,
    pub owner: Pubkey,
    pub operator: Pubkey,
    pub recovery_destination: Pubkey,
}

#[event]
pub struct MintAdded {
    pub treasury: Pubkey,
    pub schema_version: u8,
    pub mint: Pubkey,
    pub token_program: Pubkey,
    pub flags: u8,
    pub ceiling: MintCeiling,
}
