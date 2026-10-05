//! `unpause` (spec §5.1).
//!
//! Restoring service is a cold-key action. Guardians cannot unpause — that is what makes
//! pause a real kill switch rather than a suggestion — and neither can the operator. A
//! compromised warm key that could clear a guardian's pause would collapse the two
//! independent stops into one.
//!
//! Already-unpaused is a successful no-op with no event, matching `pause`. `paused_at` and
//! `paused_by` are left as the last pauser's record; they are not a live lock.

use anchor_lang::prelude::*;

use crate::constants::SEED_TREASURY;
use crate::error::AshError;
use crate::events::{TreasuryUnpaused, EVENT_SCHEMA_VERSION};
use crate::state::Treasury;

#[event_cpi]
#[derive(Accounts)]
pub struct Unpause<'info> {
    pub owner: Signer<'info>,

    #[account(
        mut,
        seeds = [SEED_TREASURY, treasury.create_key.as_ref()],
        bump = treasury.bump,
        has_one = owner @ AshError::Unauthorized,
    )]
    pub treasury: Box<Account<'info, Treasury>>,
}

pub fn unpause_handler(ctx: Context<Unpause>) -> Result<()> {
    if !ctx.accounts.treasury.paused {
        return Ok(());
    }

    let now = Clock::get()?.unix_timestamp;
    let by = ctx.accounts.owner.key();
    ctx.accounts.treasury.paused = false;

    emit_cpi!(TreasuryUnpaused {
        treasury: ctx.accounts.treasury.key(),
        schema_version: EVENT_SCHEMA_VERSION,
        by,
        at: now,
    });

    Ok(())
}
