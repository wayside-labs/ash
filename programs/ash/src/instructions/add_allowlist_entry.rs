//! `add_allowlist_entry` (spec §5.2).
//!
//! One PDA per approved destination *wallet owner*, never per token account. That is what
//! makes the allowlist unbounded in size but O(1) to check: `execute_payment` re-derives
//! `["allow", policy, destination_owner]` and the existence of the account at that address
//! is the authorization (spec §5.3 step 10). It also means one entry covers every mint,
//! since the destination's token account is derived at payment time rather than stored.

use anchor_lang::prelude::*;
use anchor_spl::associated_token::get_associated_token_address_with_program_id;

use crate::constants::{MAX_NAME_LEN, SEED_ALLOWLIST, SEED_POLICY, SEED_SOL_VAULT, SEED_TREASURY};
use crate::error::AshError;
use crate::events::{AllowlistEntryAdded, EVENT_SCHEMA_VERSION};
use crate::state::{AllowlistEntry, AllowlistEntryInit, Policy, Treasury};
use crate::validation::validate_padded_name;

#[event_cpi]
#[derive(Accounts)]
#[instruction(destination_owner: Pubkey)]
pub struct AddAllowlistEntry<'info> {
    #[account(mut)]
    pub operator: Signer<'info>,

    #[account(
        seeds = [SEED_TREASURY, treasury.create_key.as_ref()],
        bump = treasury.bump,
    )]
    pub treasury: Box<Account<'info, Treasury>>,

    #[account(
        seeds = [SEED_POLICY, treasury.key().as_ref(), policy.name.as_ref()],
        bump = policy.bump,
        has_one = treasury @ AshError::Unauthorized,
    )]
    pub policy: Box<Account<'info, Policy>>,

    #[account(
        init,
        payer = operator,
        space = AllowlistEntry::LEN,
        seeds = [SEED_ALLOWLIST, policy.key().as_ref(), destination_owner.as_ref()],
        bump,
    )]
    pub entry: Box<Account<'info, AllowlistEntry>>,

    pub system_program: Program<'info, System>,
}

pub fn add_allowlist_entry_handler(
    ctx: Context<AddAllowlistEntry>,
    destination_owner: Pubkey,
    label: [u8; MAX_NAME_LEN],
    per_tx_max_override: u64,
) -> Result<()> {
    require!(
        ctx.accounts
            .treasury
            .is_owner_or_operator(&ctx.accounts.operator.key()),
        AshError::Unauthorized
    );
    validate_padded_name(&label)?;
    require_keys_neq!(
        destination_owner,
        Pubkey::default(),
        AshError::DestinationNotAllowed
    );

    reject_treasury_owned_destination(
        &ctx.accounts.treasury,
        ctx.accounts.treasury.key(),
        &destination_owner,
    )?;

    // An override may only tighten, and it is bounded by the *tightest* mint slot because a
    // single entry applies to all of them.
    if per_tx_max_override != 0 {
        let floor = ctx
            .accounts
            .policy
            .min_per_tx_max()
            .ok_or(AshError::InvalidLimit)?;
        require!(per_tx_max_override <= floor, AshError::InvalidLimit);
    }

    ctx.accounts.entry.initialize(AllowlistEntryInit {
        bump: ctx.bumps.entry,
        policy: ctx.accounts.policy.key(),
        destination_owner,
        label,
        per_tx_max_override,
        added_at: Clock::get()?.unix_timestamp,
        added_by: ctx.accounts.operator.key(),
    });

    emit_cpi!(AllowlistEntryAdded {
        treasury: ctx.accounts.treasury.key(),
        schema_version: EVENT_SCHEMA_VERSION,
        policy: ctx.accounts.policy.key(),
        destination_owner,
        label,
        per_tx_max_override,
    });

    Ok(())
}

/// Refuses a destination the treasury already controls (spec §5.2, `SelfPaymentForbidden`).
///
/// `execute_payment` rejects the treasury and `sol_vault` at payment time, but a vault ATA
/// can only be recognized here, where the configured mints and their token programs are in
/// hand. Catching all three at configuration time also means the operator learns about the
/// mistake once, rather than every agent payment failing later.
fn reject_treasury_owned_destination(
    treasury: &Treasury,
    treasury_key: Pubkey,
    destination: &Pubkey,
) -> Result<()> {
    require_keys_neq!(*destination, treasury_key, AshError::SelfPaymentForbidden);

    let sol_vault = Pubkey::create_program_address(
        &[
            SEED_SOL_VAULT,
            treasury_key.as_ref(),
            &[treasury.sol_vault_bump],
        ],
        &crate::ID,
    )
    .map_err(|_| error!(AshError::SelfPaymentForbidden))?;
    require_keys_neq!(*destination, sol_vault, AshError::SelfPaymentForbidden);

    for config in treasury.mints.iter() {
        // The native slot stores the System program as its "token program" and has no ATA.
        if !config.is_used() || config.is_native() {
            continue;
        }
        let vault = get_associated_token_address_with_program_id(
            &treasury_key,
            &config.mint,
            &config.token_program,
        );
        require_keys_neq!(*destination, vault, AshError::SelfPaymentForbidden);
    }

    Ok(())
}
