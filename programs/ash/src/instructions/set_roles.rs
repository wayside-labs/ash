//! `set_roles` (spec §5.1).
//!
//! Rotates the cold owner and/or the warm operator. Each `Option` is "leave this one
//! alone"; a `Some` value must be non-default so a caller cannot accidentally (or
//! adversarially) zero a role and lock the treasury. Owner-only: an operator who could
//! rotate the owner would become the owner.

use anchor_lang::prelude::*;

use crate::constants::SEED_TREASURY;
use crate::error::AshError;
use crate::events::{RolesUpdated, EVENT_SCHEMA_VERSION};
use crate::state::Treasury;

#[event_cpi]
#[derive(Accounts)]
pub struct SetRoles<'info> {
    pub owner: Signer<'info>,

    #[account(
        mut,
        seeds = [SEED_TREASURY, treasury.create_key.as_ref()],
        bump = treasury.bump,
        has_one = owner @ AshError::Unauthorized,
    )]
    pub treasury: Box<Account<'info, Treasury>>,
}

pub fn set_roles_handler(
    ctx: Context<SetRoles>,
    new_owner: Option<Pubkey>,
    new_operator: Option<Pubkey>,
) -> Result<()> {
    let treasury = &mut ctx.accounts.treasury;

    if let Some(owner) = new_owner {
        require_keys_neq!(owner, Pubkey::default(), AshError::Unauthorized);
        treasury.owner = owner;
    }
    if let Some(operator) = new_operator {
        require_keys_neq!(operator, Pubkey::default(), AshError::Unauthorized);
        treasury.operator = operator;
    }

    emit_cpi!(RolesUpdated {
        treasury: treasury.key(),
        schema_version: EVENT_SCHEMA_VERSION,
        owner: treasury.owner,
        operator: treasury.operator,
    });

    Ok(())
}
