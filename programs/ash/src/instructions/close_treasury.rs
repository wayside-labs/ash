//! `close_treasury` (spec §5.1).
//!
//! The last owner instruction. Every dependent account has to be gone first because the
//! program cannot enumerate PDAs: `policy_count == 0` and `active_sessions == 0` are the
//! on-chain proof that the client swept, and `mint_count == 0` is the proof that every
//! vault was emptied through `withdraw` and delisted through `remove_mint`. `sol_vault` is
//! drained of its rent floor to `rent_destination` and then left at zero, so the runtime
//! reclaims it; the treasury account itself is closed by Anchor.
//!
//! `rent_destination` must not be `sol_vault`. Draining a PDA into itself is a no-op, and
//! after this instruction nobody can sign for that address again.

use anchor_lang::prelude::*;
use anchor_lang::system_program::{self, Transfer};

use crate::constants::{SEED_SOL_VAULT, SEED_TREASURY};
use crate::error::AshError;
use crate::events::{TreasuryClosed, EVENT_SCHEMA_VERSION};
use crate::state::Treasury;

#[event_cpi]
#[derive(Accounts)]
pub struct CloseTreasury<'info> {
    pub owner: Signer<'info>,

    #[account(
        mut,
        close = rent_destination,
        seeds = [SEED_TREASURY, treasury.create_key.as_ref()],
        bump = treasury.bump,
        has_one = owner @ AshError::Unauthorized,
    )]
    pub treasury: Box<Account<'info, Treasury>>,

    #[account(
        mut,
        seeds = [SEED_SOL_VAULT, treasury.key().as_ref()],
        bump = treasury.sol_vault_bump,
    )]
    pub sol_vault: SystemAccount<'info>,

    /// CHECK: rent recipient chosen by the owner. Rejected if it is `sol_vault`, which
    /// would strand the floor lamports on a PDA nobody can sign for after close.
    #[account(mut)]
    pub rent_destination: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}

pub fn close_treasury_handler(ctx: Context<CloseTreasury>) -> Result<()> {
    require_keys_neq!(
        ctx.accounts.rent_destination.key(),
        ctx.accounts.sol_vault.key(),
        AshError::Unauthorized
    );

    let treasury = &ctx.accounts.treasury;
    require!(
        treasury.active_sessions == 0 && treasury.policy_count == 0 && treasury.mint_count == 0,
        AshError::TreasuryNotEmpty
    );

    let floor = Rent::get()?.minimum_balance(0);
    require!(
        ctx.accounts.sol_vault.lamports() <= floor,
        AshError::TreasuryNotEmpty
    );

    let treasury_key = ctx.accounts.treasury.key();
    let sol_vault_bump = ctx.accounts.treasury.sol_vault_bump;
    let lamports = ctx.accounts.sol_vault.lamports();
    if lamports > 0 {
        let vault_seeds: &[&[u8]] = &[SEED_SOL_VAULT, treasury_key.as_ref(), &[sol_vault_bump]];
        system_program::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.system_program.key(),
                Transfer {
                    from: ctx.accounts.sol_vault.to_account_info(),
                    to: ctx.accounts.rent_destination.to_account_info(),
                },
                &[vault_seeds],
            ),
            lamports,
        )?;
    }

    emit_cpi!(TreasuryClosed {
        treasury: treasury_key,
        schema_version: EVENT_SCHEMA_VERSION,
    });

    Ok(())
}
