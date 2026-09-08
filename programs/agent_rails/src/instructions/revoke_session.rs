//! `revoke_session` (spec §5.2).
//!
//! One of the two independent stops in the design: the operator (or owner) kills a single
//! agent, while any guardian can pause the whole treasury. Either alone is sufficient, and
//! neither needs the other's key.
//!
//! Revocation is permanent. Rotating an agent means issuing a new key and a new session,
//! never un-revoking this one — a session that could be resurrected would turn a
//! containment action into a temporary one.

use anchor_lang::prelude::*;

use crate::constants::{SEED_POLICY, SEED_SESSION, SEED_TREASURY};
use crate::error::AgentRailsError;
use crate::events::{SessionRevoked, EVENT_SCHEMA_VERSION};
use crate::state::{AgentSession, Policy, Treasury};

#[event_cpi]
#[derive(Accounts)]
pub struct RevokeSession<'info> {
    /// Owner or operator. Guardians can only pause, never reach into a session.
    pub authority: Signer<'info>,

    #[account(
        mut,
        seeds = [SEED_TREASURY, treasury.create_key.as_ref()],
        bump = treasury.bump,
    )]
    pub treasury: Box<Account<'info, Treasury>>,

    #[account(
        mut,
        seeds = [SEED_POLICY, treasury.key().as_ref(), policy.name.as_ref()],
        bump = policy.bump,
        has_one = treasury @ AgentRailsError::Unauthorized,
    )]
    pub policy: Box<Account<'info, Policy>>,

    #[account(
        mut,
        seeds = [SEED_SESSION, treasury.key().as_ref(), session.session_key.as_ref()],
        bump = session.bump,
        has_one = treasury @ AgentRailsError::Unauthorized,
        has_one = policy @ AgentRailsError::Unauthorized,
    )]
    pub session: Box<Account<'info, AgentSession>>,
}

pub fn revoke_session_handler(ctx: Context<RevokeSession>) -> Result<()> {
    require!(
        ctx.accounts
            .treasury
            .is_owner_or_operator(&ctx.accounts.authority.key()),
        AgentRailsError::Unauthorized
    );
    require!(
        !ctx.accounts.session.revoked,
        AgentRailsError::AlreadyRevoked
    );

    ctx.accounts.session.revoked = true;
    ctx.accounts.session.revoked_at = Clock::get()?.unix_timestamp;

    // Both counters drop here, not at `close_session`, so `active_sessions` means "sessions
    // that could still pay" rather than "session accounts that still exist".
    ctx.accounts.treasury.active_sessions = ctx
        .accounts
        .treasury
        .active_sessions
        .checked_sub(1)
        .ok_or(AgentRailsError::MathOverflow)?;
    ctx.accounts.policy.active_sessions = ctx
        .accounts
        .policy
        .active_sessions
        .checked_sub(1)
        .ok_or(AgentRailsError::MathOverflow)?;

    emit_cpi!(SessionRevoked {
        treasury: ctx.accounts.treasury.key(),
        schema_version: EVENT_SCHEMA_VERSION,
        session: ctx.accounts.session.key(),
        by: ctx.accounts.authority.key(),
        seq: ctx.accounts.session.seq,
        audit_head: ctx.accounts.session.audit_head,
    });

    Ok(())
}
