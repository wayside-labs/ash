//! `update_policy` (spec §5.2).
//!
//! Rewrites a live policy's rules in place. The account address is seeded by `name`, so the
//! name is the one field an update cannot change — a policy's identity is stable across
//! revisions, which is what lets an auditor chain `PolicyCreated` → `PolicyUpdated` events
//! for one address and reconstruct its whole history.
//!
//! **Sessions keep their counters.** Spend is looked up by mint, never by slot index
//! (spec §3.3.1), so an update that reorders, drops, or adds mints cannot misattribute what
//! an agent has already spent. Dropping a mint does not refund its counter either: the slot
//! stays occupied and the next payment for it fails `MintNotInPolicy`, which is the
//! tightening direction.

use anchor_lang::prelude::*;

use crate::args::PolicyArgs;
use crate::constants::{SEED_POLICY, SEED_TREASURY};
use crate::error::AgentRailsError;
use crate::events::{PolicyUpdated, EVENT_SCHEMA_VERSION};
use crate::instructions::policy::{args_from_policy, limits_hash, validated_limits};
use crate::state::{Policy, Treasury};

#[event_cpi]
#[derive(Accounts)]
pub struct UpdatePolicy<'info> {
    /// Operator or owner. Checked in the handler because `has_one` cannot express
    /// "either of two fields".
    pub operator: Signer<'info>,

    /// Read-only: an update changes no treasury state. `policy_count` is unaffected because
    /// no policy is created or destroyed.
    #[account(
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
}

pub fn update_policy_handler(ctx: Context<UpdatePolicy>, args: PolicyArgs) -> Result<()> {
    require!(
        ctx.accounts
            .treasury
            .is_owner_or_operator(&ctx.accounts.operator.key()),
        AgentRailsError::Unauthorized
    );

    // Identical validation to `create_policy`, from the same function. An operator must not
    // be able to reach a state by editing that they could not have reached by creating.
    let (mint_limits, mint_count) = validated_limits(&args, &ctx.accounts.treasury)?;

    // Captured before the write so the event carries both digests (spec §5.2).
    let previous_limits_hash = limits_hash(&args_from_policy(&ctx.accounts.policy));

    let policy = &mut ctx.accounts.policy;
    policy.mint_limits = mint_limits;
    policy.mint_count = mint_count;
    policy.destination_mode = args.destination_mode;
    policy.require_memo = args.require_memo;
    policy.create_destination_ata = args.create_destination_ata;
    policy.updated_at = Clock::get()?.unix_timestamp;
    // `version`, `bump`, `treasury`, `name`, `active_sessions`, `created_at`, and `reserved`
    // are deliberately untouched: identity, provenance, and the live-session count survive
    // a revision.

    emit_cpi!(PolicyUpdated {
        treasury: ctx.accounts.treasury.key(),
        schema_version: EVENT_SCHEMA_VERSION,
        policy: ctx.accounts.policy.key(),
        name: ctx.accounts.policy.name,
        previous_limits_hash,
        limits_hash: limits_hash(&args),
    });

    Ok(())
}
