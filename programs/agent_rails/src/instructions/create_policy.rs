//! `create_policy` (spec §5.2).
//!
//! The operator's only lever. Everything it may write is bounded by the owner's ceiling,
//! and the bound is checked as a whole by `agent_rails_policy::policy_leq_ceiling` — the
//! same pure function the payment path re-runs at execution time (spec §5.3 step 9). Having
//! one implementation of "is this policy legal" is what makes the two checks agree.

use anchor_lang::prelude::*;

use crate::args::PolicyInput;
use crate::constants::{MAX_NAME_LEN, SEED_POLICY, SEED_TREASURY};
use crate::error::AgentRailsError;
use crate::events::{PolicyCreated, EVENT_SCHEMA_VERSION};
use crate::instructions::policy::{limits_hash, validated_limits};
use crate::state::{Policy, PolicyInit, Treasury};
use crate::validation::validate_padded_name;

#[event_cpi]
#[derive(Accounts)]
#[instruction(name: [u8; MAX_NAME_LEN])]
pub struct CreatePolicy<'info> {
    /// Operator or owner; also the rent payer. Checked in the handler because `has_one`
    /// cannot express "either of two fields".
    #[account(mut)]
    pub operator: Signer<'info>,

    #[account(
        mut,
        seeds = [SEED_TREASURY, treasury.create_key.as_ref()],
        bump = treasury.bump,
    )]
    pub treasury: Box<Account<'info, Treasury>>,

    #[account(
        init,
        payer = operator,
        space = Policy::LEN,
        seeds = [SEED_POLICY, treasury.key().as_ref(), name.as_ref()],
        bump,
    )]
    pub policy: Box<Account<'info, Policy>>,

    pub system_program: Program<'info, System>,
}

pub fn create_policy_handler(
    ctx: Context<CreatePolicy>,
    name: [u8; MAX_NAME_LEN],
    args: PolicyInput,
) -> Result<()> {
    require!(
        ctx.accounts
            .treasury
            .is_owner_or_operator(&ctx.accounts.operator.key()),
        AgentRailsError::Unauthorized
    );
    validate_padded_name(&name)?;

    let (mint_limits, mint_count) = validated_limits(&args, &ctx.accounts.treasury)?;

    ctx.accounts.policy.initialize(PolicyInit {
        bump: ctx.bumps.policy,
        treasury: ctx.accounts.treasury.key(),
        name,
        mint_limits,
        mint_count,
        destination_mode: args.destination_mode,
        require_memo: args.require_memo,
        create_destination_ata: args.create_destination_ata,
        created_at: Clock::get()?.unix_timestamp,
    });

    ctx.accounts.treasury.policy_count = ctx
        .accounts
        .treasury
        .policy_count
        .checked_add(1)
        .ok_or(AgentRailsError::MathOverflow)?;

    emit_cpi!(PolicyCreated {
        treasury: ctx.accounts.treasury.key(),
        schema_version: EVENT_SCHEMA_VERSION,
        policy: ctx.accounts.policy.key(),
        name,
        limits_hash: limits_hash(&args),
    });

    Ok(())
}
