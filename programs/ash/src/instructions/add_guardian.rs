//! `add_guardian` (spec §5.1).
//!
//! Registers one hot key that can pause and do nothing else. Unused slots stay
//! `Pubkey::default()`; `guardian_count` is the live prefix. Owner-only — a guardian who
//! could recruit more guardians would turn a kill switch into a cabal.

use anchor_lang::prelude::*;

use crate::constants::SEED_TREASURY;
use crate::error::AshError;
use crate::events::{GuardianAdded, EVENT_SCHEMA_VERSION};
use crate::state::Treasury;

#[event_cpi]
#[derive(Accounts)]
pub struct AddGuardian<'info> {
    pub owner: Signer<'info>,

    #[account(
        mut,
        seeds = [SEED_TREASURY, treasury.create_key.as_ref()],
        bump = treasury.bump,
        has_one = owner @ AshError::Unauthorized,
    )]
    pub treasury: Box<Account<'info, Treasury>>,
}

pub fn add_guardian_handler(ctx: Context<AddGuardian>, guardian: Pubkey) -> Result<()> {
    ctx.accounts.treasury.insert_guardian(guardian)?;

    emit_cpi!(GuardianAdded {
        treasury: ctx.accounts.treasury.key(),
        schema_version: EVENT_SCHEMA_VERSION,
        guardian,
    });

    Ok(())
}
