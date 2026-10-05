//! `create_treasury` (spec §5.1).

use anchor_lang::prelude::*;
use anchor_lang::system_program::{transfer, Transfer};

use crate::constants::{SEED_SOL_VAULT, SEED_TREASURY};
use crate::error::AshError;
use crate::events::{TreasuryCreated, EVENT_SCHEMA_VERSION};
use crate::state::{Treasury, TreasuryInit};

#[event_cpi]
#[derive(Accounts)]
pub struct CreateTreasury<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    /// Ephemeral keypair that seeds the treasury PDA. It signs exactly once, here, and is
    /// then discarded — which is what lets one owner hold unlimited treasuries without the
    /// program tracking an index.
    pub create_key: Signer<'info>,

    #[account(
        init,
        payer = payer,
        space = Treasury::LEN,
        seeds = [SEED_TREASURY, create_key.key().as_ref()],
        bump,
    )]
    pub treasury: Account<'info, Treasury>,

    /// System-owned PDA with zero data bytes. It is never `init`ed as a program account:
    /// lamports are simply transferred in, which leaves it spendable by
    /// `system_program::transfer` with `invoke_signed` and keeps SOL payments cheap.
    #[account(
        mut,
        seeds = [SEED_SOL_VAULT, treasury.key().as_ref()],
        bump,
    )]
    pub sol_vault: SystemAccount<'info>,

    pub system_program: Program<'info, System>,
}

pub fn create_treasury_handler(
    ctx: Context<CreateTreasury>,
    owner: Pubkey,
    operator: Pubkey,
    recovery_destination: Pubkey,
    allow_any_destination: bool,
    allow_create_destination_ata: bool,
) -> Result<()> {
    require_keys_neq!(owner, Pubkey::default(), AshError::Unauthorized);
    require_keys_neq!(operator, Pubkey::default(), AshError::Unauthorized);

    // The floor is read from the Rent sysvar rather than hardcoded, so the vault stays
    // rent-exempt if rent parameters ever change.
    let floor = Rent::get()?.minimum_balance(0);
    let vault_balance = ctx.accounts.sol_vault.lamports();
    if vault_balance < floor {
        transfer(
            CpiContext::new(
                ctx.accounts.system_program.key(),
                Transfer {
                    from: ctx.accounts.payer.to_account_info(),
                    to: ctx.accounts.sol_vault.to_account_info(),
                },
            ),
            floor
                .checked_sub(vault_balance)
                .ok_or(AshError::MathOverflow)?,
        )?;
    }

    ctx.accounts.treasury.initialize(TreasuryInit {
        bump: ctx.bumps.treasury,
        sol_vault_bump: ctx.bumps.sol_vault,
        create_key: ctx.accounts.create_key.key(),
        owner,
        operator,
        recovery_destination,
        allow_any_destination,
        allow_create_destination_ata,
        created_at: Clock::get()?.unix_timestamp,
    });

    emit_cpi!(TreasuryCreated {
        treasury: ctx.accounts.treasury.key(),
        schema_version: EVENT_SCHEMA_VERSION,
        owner,
        operator,
        recovery_destination,
    });

    Ok(())
}
