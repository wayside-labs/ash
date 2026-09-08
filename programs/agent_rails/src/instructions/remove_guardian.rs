//! `remove_guardian` (spec §5.1).
//!
//! Drops one hot key from the live prefix and compact-fills the hole so `is_guardian`
//! never has to skip defaults. Owner-only. Removing a guardian does not unpause; if they
//! were the last pauser, `paused_by` still names them as a historical record.

use anchor_lang::prelude::*;

use crate::constants::SEED_TREASURY;
use crate::error::AgentRailsError;
use crate::events::{GuardianRemoved, EVENT_SCHEMA_VERSION};
use crate::state::Treasury;

#[event_cpi]
#[derive(Accounts)]
pub struct RemoveGuardian<'info> {
    pub owner: Signer<'info>,

    #[account(
        mut,
        seeds = [SEED_TREASURY, treasury.create_key.as_ref()],
        bump = treasury.bump,
        has_one = owner @ AgentRailsError::Unauthorized,
    )]
    pub treasury: Box<Account<'info, Treasury>>,
}

pub fn remove_guardian_handler(ctx: Context<RemoveGuardian>, guardian: Pubkey) -> Result<()> {
    ctx.accounts.treasury.extract_guardian(guardian)?;

    emit_cpi!(GuardianRemoved {
        treasury: ctx.accounts.treasury.key(),
        schema_version: EVENT_SCHEMA_VERSION,
        guardian,
    });

    Ok(())
}
