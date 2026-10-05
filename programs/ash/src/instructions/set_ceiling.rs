//! `set_ceiling` (spec §5.1).
//!
//! The owner's lever, and the top of the "loosening flows downhill only" ordering: the owner
//! sets ceilings, the operator writes policies under them, the agent sets nothing. Owner-only
//! — an operator who could raise a ceiling could raise their own limits, which would collapse
//! the whole separation into a single role.
//!
//! **Live policies are deliberately not rewritten.** Lowering a ceiling under an existing
//! policy leaves that policy on-chain exceeding its bound, and `execute_payment` refuses it
//! at runtime via the step-9 re-check (spec §5.3). That is the fail-closed choice: the
//! alternative is for this instruction to walk every policy, which it cannot do — the
//! program cannot enumerate PDAs — so a partial rewrite would silently leave some policies
//! loose. Tightening therefore takes effect on the very next payment, and the operator
//! brings policies back into compliance with `update_policy` at their own pace.

use anchor_lang::prelude::*;

use crate::args::MintCeilingInput;
use crate::constants::SEED_TREASURY;
use crate::error::{AshError, IntoAnchorResult};
use crate::events::{CeilingUpdated, EVENT_SCHEMA_VERSION};
use crate::state::Treasury;

#[event_cpi]
#[derive(Accounts)]
pub struct SetCeiling<'info> {
    pub owner: Signer<'info>,

    #[account(
        mut,
        seeds = [SEED_TREASURY, treasury.create_key.as_ref()],
        bump = treasury.bump,
        has_one = owner @ AshError::Unauthorized,
    )]
    pub treasury: Box<Account<'info, Treasury>>,
}

pub fn set_ceiling_handler(
    ctx: Context<SetCeiling>,
    mint: Pubkey,
    ceiling: MintCeilingInput,
    allow_any_destination: bool,
    allow_create_destination_ata: bool,
) -> Result<()> {
    let ceiling = ceiling.to_state();
    ash_policy::validate_ceiling(&ceiling.to_policy()).or_anchor_err()?;

    let slot = ctx
        .accounts
        .treasury
        .mints
        .iter()
        .position(|config| config.is_used() && config.mint == mint)
        .ok_or(AshError::MintNotConfigured)?;

    let treasury = &mut ctx.accounts.treasury;
    treasury.mints[slot].ceiling = ceiling;
    treasury.allow_any_destination = allow_any_destination;
    treasury.allow_create_destination_ata = allow_create_destination_ata;

    emit_cpi!(CeilingUpdated {
        treasury: treasury.key(),
        schema_version: EVENT_SCHEMA_VERSION,
        mint,
        ceiling,
        allow_any_destination,
        allow_create_destination_ata,
    });

    Ok(())
}
