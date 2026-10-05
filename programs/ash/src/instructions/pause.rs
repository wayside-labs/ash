//! `pause` (spec §5.1).
//!
//! The agent kill switch. It blocks `execute_payment` and nothing else: owner withdrawal
//! still works, which is the emergency exit (ADR-002, ADR-010). Authorization is
//! **owner or any registered guardian**. The operator is excluded on purpose: a compromised
//! warm key already has `revoke_session`, and must not be able to freeze the whole treasury
//! or — worse — to un-freeze a guardian's pause. Guardians can only tighten.
//!
//! Already-paused is a successful no-op with no event, so a monitoring bot can hammer the
//! instruction without inventing a "not paused" race.

use anchor_lang::prelude::*;

use crate::constants::SEED_TREASURY;
use crate::error::AshError;
use crate::events::{TreasuryPaused, EVENT_SCHEMA_VERSION};
use crate::state::Treasury;

#[event_cpi]
#[derive(Accounts)]
pub struct Pause<'info> {
    pub authority: Signer<'info>,

    #[account(
        mut,
        seeds = [SEED_TREASURY, treasury.create_key.as_ref()],
        bump = treasury.bump,
    )]
    pub treasury: Box<Account<'info, Treasury>>,
}

pub fn pause_handler(ctx: Context<Pause>) -> Result<()> {
    require!(
        ctx.accounts
            .treasury
            .can_pause(&ctx.accounts.authority.key()),
        AshError::Unauthorized
    );

    if ctx.accounts.treasury.paused {
        return Ok(());
    }

    let now = Clock::get()?.unix_timestamp;
    let by = ctx.accounts.authority.key();
    let treasury = &mut ctx.accounts.treasury;
    treasury.paused = true;
    treasury.paused_at = now;
    treasury.paused_by = by;

    emit_cpi!(TreasuryPaused {
        treasury: treasury.key(),
        schema_version: EVENT_SCHEMA_VERSION,
        by,
        at: now,
    });

    Ok(())
}
