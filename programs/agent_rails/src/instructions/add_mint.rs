//! `add_mint` (spec §5.1) — native SOL path.
//!
//! Scope note: only the `NATIVE_MINT` branch is wired up. The SPL Token / Token-2022 branch
//! (mint deserialization, extension rejection, and idempotent vault-ATA creation) lands
//! with the token payment instructions, and until then a non-native mint is rejected with
//! `TokenProgramMismatch`. The account list already carries the optional token accounts so
//! the instruction's client-facing shape will not change when that branch arrives.

use anchor_lang::prelude::*;

use crate::args::MintCeilingArgs;
use crate::constants::{MintFlags, NATIVE_MINT, SEED_TREASURY};
use crate::error::{AgentRailsError, IntoAnchorResult};
use crate::events::{MintAdded, EVENT_SCHEMA_VERSION};
use crate::state::{MintConfig, Treasury};

/// Decimals of native SOL (lamports per SOL is 10^9).
const NATIVE_DECIMALS: u8 = 9;

#[event_cpi]
#[derive(Accounts)]
pub struct AddMint<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,

    #[account(
        mut,
        seeds = [SEED_TREASURY, treasury.create_key.as_ref()],
        bump = treasury.bump,
        has_one = owner @ AgentRailsError::Unauthorized,
    )]
    pub treasury: Account<'info, Treasury>,

    /// CHECK: compared against `NATIVE_MINT` in the handler. Once the SPL branch exists,
    /// this becomes an `InterfaceAccount<Mint>` whose owner pins the token program.
    pub mint: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}

pub fn add_mint_handler(ctx: Context<AddMint>, ceiling: MintCeilingArgs) -> Result<()> {
    let ceiling = ceiling.to_state();
    agent_rails_policy::validate_ceiling(&ceiling.to_policy()).or_anchor_err()?;

    let mint = ctx.accounts.mint.key();
    require_keys_eq!(mint, NATIVE_MINT, AgentRailsError::TokenProgramMismatch);

    let treasury = &mut ctx.accounts.treasury;
    require!(
        treasury.find_mint(&mint).is_none(),
        AgentRailsError::DuplicateMint
    );
    let slot = treasury
        .free_mint_slot()
        .ok_or(AgentRailsError::MintSlotsFull)?;

    // Native SOL has no token program; the System program is recorded so that every slot
    // has a non-default `token_program` and clients can branch on it uniformly.
    let token_program = ctx.accounts.system_program.key();
    treasury.mints[slot] = MintConfig {
        mint,
        token_program,
        decimals: NATIVE_DECIMALS,
        flags: MintFlags::IS_NATIVE,
        _pad: [0u8; 6],
        ceiling,
    };
    treasury.mint_count = treasury
        .mint_count
        .checked_add(1)
        .ok_or(AgentRailsError::MathOverflow)?;

    emit_cpi!(MintAdded {
        treasury: treasury.key(),
        schema_version: EVENT_SCHEMA_VERSION,
        mint,
        token_program,
        flags: MintFlags::IS_NATIVE,
        ceiling,
    });

    Ok(())
}
