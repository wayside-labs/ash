//! `close_policy` (spec §5.2).
//!
//! Reclaims a policy's rent once nothing depends on it. The gate is `active_sessions == 0`,
//! counted by the program rather than trusted from the client, because a closed policy
//! whose sessions are still live would leave those sessions pointing at an address that
//! anyone could later reuse.
//!
//! Allowlist entries are *not* swept here. The program cannot enumerate PDAs, so entries
//! must be removed by the client first; a dangling entry is harmless because its seeds bind
//! it to this policy's address and `remove_allowlist_entry` accepts a closed policy
//! (spec §5.2).

use anchor_lang::prelude::*;

use crate::constants::{SEED_POLICY, SEED_TREASURY};
use crate::error::AshError;
use crate::events::{PolicyClosed, EVENT_SCHEMA_VERSION};
use crate::state::{Policy, Treasury};

#[event_cpi]
#[derive(Accounts)]
pub struct ClosePolicy<'info> {
    pub operator: Signer<'info>,

    #[account(
        mut,
        seeds = [SEED_TREASURY, treasury.create_key.as_ref()],
        bump = treasury.bump,
    )]
    pub treasury: Box<Account<'info, Treasury>>,

    #[account(
        mut,
        close = rent_destination,
        seeds = [SEED_POLICY, treasury.key().as_ref(), policy.name.as_ref()],
        bump = policy.bump,
        has_one = treasury @ AshError::Unauthorized,
    )]
    pub policy: Box<Account<'info, Policy>>,

    /// CHECK: rent recipient chosen by the operator, who is already authorized to close
    /// this account. Never read or written by the program beyond the lamport transfer.
    #[account(mut)]
    pub rent_destination: UncheckedAccount<'info>,
}

pub fn close_policy_handler(ctx: Context<ClosePolicy>) -> Result<()> {
    require!(
        ctx.accounts
            .treasury
            .is_owner_or_operator(&ctx.accounts.operator.key()),
        AshError::Unauthorized
    );
    require!(
        ctx.accounts.policy.active_sessions == 0,
        AshError::PolicyInUse
    );

    ctx.accounts.treasury.policy_count = ctx
        .accounts
        .treasury
        .policy_count
        .checked_sub(1)
        .ok_or(AshError::MathOverflow)?;

    emit_cpi!(PolicyClosed {
        treasury: ctx.accounts.treasury.key(),
        schema_version: EVENT_SCHEMA_VERSION,
        policy: ctx.accounts.policy.key(),
        name: ctx.accounts.policy.name,
    });

    Ok(())
}
