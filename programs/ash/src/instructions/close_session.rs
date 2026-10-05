//! `close_session` (spec §5.2).
//!
//! Reclaims a session's rent once it can no longer pay — revoked, or past its expiry. The
//! `SessionClosed` event carries the final `seq` and `audit_head` because after this
//! instruction the account is gone and the event is the only remaining on-chain record of
//! where the audit chain terminated (spec §8).
//!
//! **Deviation from spec §5.2.** The spec lists the accounts as `operator (s)`,
//! `treasury` (read-only), `session` (w, close), `rent_destination` (w), yet states the
//! effect "decrements `active_sessions` counters" — plural, and impossible to perform on a
//! read-only treasury with no `policy` account present. `treasury` is writable here and
//! `policy` is added, which is the minimum needed to make the stated effect happen. Worth a
//! spec amendment.

use anchor_lang::prelude::*;

use crate::constants::{SEED_POLICY, SEED_SESSION, SEED_TREASURY};
use crate::error::AshError;
use crate::events::{SessionClosed, EVENT_SCHEMA_VERSION};
use crate::state::{AgentSession, Policy, Treasury};

#[event_cpi]
#[derive(Accounts)]
pub struct CloseSession<'info> {
    pub operator: Signer<'info>,

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
        has_one = treasury @ AshError::Unauthorized,
    )]
    pub policy: Box<Account<'info, Policy>>,

    #[account(
        mut,
        close = rent_destination,
        seeds = [SEED_SESSION, treasury.key().as_ref(), session.session_key.as_ref()],
        bump = session.bump,
        has_one = treasury @ AshError::Unauthorized,
        has_one = policy @ AshError::Unauthorized,
    )]
    pub session: Box<Account<'info, AgentSession>>,

    /// CHECK: rent recipient chosen by the operator, who is already authorized to close
    /// this account.
    #[account(mut)]
    pub rent_destination: UncheckedAccount<'info>,
}

pub fn close_session_handler(ctx: Context<CloseSession>) -> Result<()> {
    require!(
        ctx.accounts
            .treasury
            .is_owner_or_operator(&ctx.accounts.operator.key()),
        AshError::Unauthorized
    );

    let now = Clock::get()?.unix_timestamp;
    let session = &ctx.accounts.session;
    require!(
        session.revoked || now >= session.expires_at,
        AshError::SessionStillActive
    );

    // `revoke_session` already decremented, so decrementing again here would undercount and
    // eventually let `close_treasury` run with live sessions outstanding. Only a session
    // that expired without ever being revoked still owes the counters a decrement.
    if !session.revoked {
        ctx.accounts.treasury.active_sessions = ctx
            .accounts
            .treasury
            .active_sessions
            .checked_sub(1)
            .ok_or(AshError::MathOverflow)?;
        ctx.accounts.policy.active_sessions = ctx
            .accounts
            .policy
            .active_sessions
            .checked_sub(1)
            .ok_or(AshError::MathOverflow)?;
    }

    emit_cpi!(SessionClosed {
        treasury: ctx.accounts.treasury.key(),
        schema_version: EVENT_SCHEMA_VERSION,
        session: ctx.accounts.session.key(),
        seq: ctx.accounts.session.seq,
        audit_head: ctx.accounts.session.audit_head,
    });

    Ok(())
}
