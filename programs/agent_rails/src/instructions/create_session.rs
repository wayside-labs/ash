//! `create_session` (spec §5.2).
//!
//! Hands one agent key a time-boxed, revocable budget under an existing policy. Sessions
//! are where spend state lives, deliberately separate from the policy that bounds it: many
//! sessions may share one rule set without sharing counters, so revoking or exhausting one
//! agent never touches another.

use anchor_lang::prelude::*;

use agent_rails_policy::genesis_preimage;

use crate::constants::{
    AuthMode, MAX_MINTS, MAX_NAME_LEN, MAX_SESSION_TTL_SECONDS, SEED_POLICY, SEED_SESSION,
    SEED_TREASURY,
};
use crate::error::AgentRailsError;
use crate::events::{SessionCreated, EVENT_SCHEMA_VERSION};
use crate::state::{AgentSession, AgentSessionInit, Policy, SpendCounter, Treasury};
use crate::validation::validate_padded_name;

#[event_cpi]
#[derive(Accounts)]
#[instruction(session_key: Pubkey)]
pub struct CreateSession<'info> {
    #[account(mut)]
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
        has_one = treasury @ AgentRailsError::Unauthorized,
    )]
    pub policy: Box<Account<'info, Policy>>,

    #[account(
        init,
        payer = operator,
        space = AgentSession::LEN,
        seeds = [SEED_SESSION, treasury.key().as_ref(), session_key.as_ref()],
        bump,
    )]
    pub session: Box<Account<'info, AgentSession>>,

    pub system_program: Program<'info, System>,
}

pub fn create_session_handler(
    ctx: Context<CreateSession>,
    session_key: Pubkey,
    label: [u8; MAX_NAME_LEN],
    expires_at: i64,
    auth_mode: u8,
) -> Result<()> {
    require!(
        ctx.accounts
            .treasury
            .is_owner_or_operator(&ctx.accounts.operator.key()),
        AgentRailsError::Unauthorized
    );
    validate_padded_name(&label)?;

    // v1 has exactly one auth mode. Accepting `SignedIntent` now would mint sessions that
    // this program cannot verify signatures for, and `execute_payment` would refuse them
    // anyway — better to fail where the operator can see it.
    require!(
        auth_mode == AuthMode::DIRECT_SIGNER,
        AgentRailsError::InvalidAuthMode
    );

    // Privilege separation: a hot agent key must not also be a key that can widen limits,
    // add mints, or pause. Otherwise a compromised agent escalates instead of being boxed
    // in, which is the whole premise of the design.
    require_keys_neq!(
        session_key,
        Pubkey::default(),
        AgentRailsError::PrivilegedKeyAsSession
    );
    require!(
        !ctx.accounts.treasury.is_privileged(&session_key),
        AgentRailsError::PrivilegedKeyAsSession
    );

    let now = Clock::get()?.unix_timestamp;
    require!(now < expires_at, AgentRailsError::InvalidExpiry);
    let ttl = expires_at
        .checked_sub(now)
        .ok_or(AgentRailsError::InvalidExpiry)?;
    require!(
        ttl <= MAX_SESSION_TTL_SECONDS,
        AgentRailsError::InvalidExpiry
    );

    // Counters start index-aligned with the policy's slots. `execute_payment` still looks
    // them up by mint, so a later `update_policy` that reorders slots cannot misattribute
    // spend (spec §3.3.1).
    let mut spend = [SpendCounter::EMPTY; MAX_MINTS];
    for (counter, limit) in spend.iter_mut().zip(ctx.accounts.policy.mint_limits.iter()) {
        if limit.is_used() {
            counter.mint = limit.mint;
        }
    }

    let session_address = ctx.accounts.session.key();
    ctx.accounts.session.initialize(AgentSessionInit {
        bump: ctx.bumps.session,
        treasury: ctx.accounts.treasury.key(),
        policy: ctx.accounts.policy.key(),
        session_key,
        auth_mode,
        label,
        created_at: now,
        expires_at,
        audit_head: solana_sha256_hasher::hash(&genesis_preimage(&session_address.to_bytes()))
            .to_bytes(),
        spend,
    });

    ctx.accounts.treasury.active_sessions = ctx
        .accounts
        .treasury
        .active_sessions
        .checked_add(1)
        .ok_or(AgentRailsError::MathOverflow)?;
    ctx.accounts.policy.active_sessions = ctx
        .accounts
        .policy
        .active_sessions
        .checked_add(1)
        .ok_or(AgentRailsError::MathOverflow)?;

    emit_cpi!(SessionCreated {
        treasury: ctx.accounts.treasury.key(),
        schema_version: EVENT_SCHEMA_VERSION,
        session: session_address,
        policy: ctx.accounts.policy.key(),
        session_key,
        label,
        expires_at,
        auth_mode,
    });

    Ok(())
}
