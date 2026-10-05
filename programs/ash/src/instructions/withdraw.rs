//! `withdraw` (spec §5.1).
//!
//! The owner's emergency exit. It is authorized by role alone: it does not consult the
//! pause flag, the policy, or even `Treasury.mints`. That last part is load-bearing. Vault
//! ATAs survive `remove_mint`, and `sol_vault` accepts permissionless deposits from the
//! moment `create_treasury` lands, so requiring a configured slot would trap funds the
//! owner can see but not reach. "Any mint, any amount, any destination, even while paused"
//! (ARCHITECTURE §3) means exactly that.
//!
//! Native SOL keeps the rent-exempt floor unspendable, the same rule `execute_payment_sol`
//! uses, so a withdraw cannot deallocate the vault PDA out from under a live treasury.

use anchor_lang::prelude::*;
use anchor_lang::system_program::{self, Transfer};
use anchor_spl::associated_token::get_associated_token_address_with_program_id;
use anchor_spl::token_2022::spl_token_2022::{
    extension::StateWithExtensions, state::Mint as SplMint,
};
use anchor_spl::token_interface::{self, TokenAccount, TokenInterface, TransferChecked};

use crate::constants::{NATIVE_MINT, SEED_SOL_VAULT, SEED_TREASURY};
use crate::error::AshError;
use crate::events::{Withdrawn, EVENT_SCHEMA_VERSION};
use crate::state::Treasury;

#[event_cpi]
#[derive(Accounts)]
pub struct Withdraw<'info> {
    pub owner: Signer<'info>,

    /// Read-only: the treasury signs the transfer as a PDA but is not mutated.
    #[account(
        seeds = [SEED_TREASURY, treasury.create_key.as_ref()],
        bump = treasury.bump,
        has_one = owner @ AshError::Unauthorized,
    )]
    pub treasury: Box<Account<'info, Treasury>>,

    /// CHECK: `NATIVE_MINT` is a sentinel and need not exist. Otherwise this must be an
    /// initialized mint; the handler unpacks it before the token CPI.
    pub mint: UncheckedAccount<'info>,

    /// Required for SPL / Token-2022, omitted for native SOL.
    #[account(mut)]
    pub vault_ata: Option<Box<InterfaceAccount<'info, TokenAccount>>>,

    /// Required for native SOL, omitted otherwise.
    #[account(
        mut,
        seeds = [SEED_SOL_VAULT, treasury.key().as_ref()],
        bump = treasury.sol_vault_bump,
    )]
    pub sol_vault: Option<SystemAccount<'info>>,

    /// Token account for SPL, system account for SOL. Validated in the handler because
    /// the two paths disagree on owner and layout.
    ///
    /// CHECK: see handler.
    #[account(mut)]
    pub destination: UncheckedAccount<'info>,

    /// Required for SPL / Token-2022, omitted for native SOL.
    pub token_program: Option<Interface<'info, TokenInterface>>,

    pub system_program: Program<'info, System>,
}

pub fn withdraw_handler(ctx: Context<Withdraw>, amount: u64) -> Result<()> {
    require!(amount > 0, AshError::AmountZero);

    let mint = ctx.accounts.mint.key();
    if mint == NATIVE_MINT {
        withdraw_sol(&ctx, amount)?;
    } else {
        withdraw_spl(&ctx, amount)?;
    }

    emit_cpi!(Withdrawn {
        treasury: ctx.accounts.treasury.key(),
        schema_version: EVENT_SCHEMA_VERSION,
        mint,
        amount,
        destination: ctx.accounts.destination.key(),
        by: ctx.accounts.owner.key(),
    });

    Ok(())
}

fn withdraw_sol(ctx: &Context<Withdraw>, amount: u64) -> Result<()> {
    let sol_vault = ctx
        .accounts
        .sol_vault
        .as_ref()
        .ok_or(AshError::WrongPaymentPath)?;

    require_keys_eq!(
        *ctx.accounts.destination.owner,
        system_program::ID,
        AshError::DestinationNotAllowed
    );

    let floor = Rent::get()?.minimum_balance(0);
    let spendable = sol_vault
        .lamports()
        .checked_sub(floor)
        .ok_or(AshError::InsufficientVaultBalance)?;
    require!(amount <= spendable, AshError::InsufficientVaultBalance);

    let treasury_key = ctx.accounts.treasury.key();
    let vault_seeds: &[&[u8]] = &[
        SEED_SOL_VAULT,
        treasury_key.as_ref(),
        &[ctx.accounts.treasury.sol_vault_bump],
    ];
    system_program::transfer(
        CpiContext::new_with_signer(
            ctx.accounts.system_program.key(),
            Transfer {
                from: sol_vault.to_account_info(),
                to: ctx.accounts.destination.to_account_info(),
            },
            &[vault_seeds],
        ),
        amount,
    )
}

fn withdraw_spl(ctx: &Context<Withdraw>, amount: u64) -> Result<()> {
    let token_program = ctx
        .accounts
        .token_program
        .as_ref()
        .ok_or(AshError::WrongPaymentPath)?;
    let vault_ata = ctx
        .accounts
        .vault_ata
        .as_ref()
        .ok_or(AshError::WrongPaymentPath)?;

    let token_program_key = token_program.key();
    require_keys_eq!(
        *ctx.accounts.mint.owner,
        token_program_key,
        AshError::TokenProgramMismatch
    );

    let expected_vault = get_associated_token_address_with_program_id(
        &ctx.accounts.treasury.key(),
        &ctx.accounts.mint.key(),
        &token_program_key,
    );
    require_keys_eq!(
        vault_ata.key(),
        expected_vault,
        AshError::TokenProgramMismatch
    );
    require_keys_eq!(
        vault_ata.mint,
        ctx.accounts.mint.key(),
        AshError::TokenProgramMismatch
    );
    require_keys_eq!(
        vault_ata.owner,
        ctx.accounts.treasury.key(),
        AshError::TokenProgramMismatch
    );
    require!(
        vault_ata.amount >= amount,
        AshError::InsufficientVaultBalance
    );

    let decimals = parse_mint_decimals(&ctx.accounts.mint.to_account_info())?;

    let create_key = ctx.accounts.treasury.create_key;
    let treasury_bump = ctx.accounts.treasury.bump;
    let treasury_seeds: &[&[u8]] = &[SEED_TREASURY, create_key.as_ref(), &[treasury_bump]];
    token_interface::transfer_checked(
        CpiContext::new_with_signer(
            token_program.key(),
            TransferChecked {
                from: vault_ata.to_account_info(),
                mint: ctx.accounts.mint.to_account_info(),
                to: ctx.accounts.destination.to_account_info(),
                authority: ctx.accounts.treasury.to_account_info(),
            },
            &[treasury_seeds],
        ),
        amount,
        decimals,
    )
}

fn parse_mint_decimals(mint: &AccountInfo) -> Result<u8> {
    let data = mint.try_borrow_data()?;
    let state = StateWithExtensions::<SplMint>::unpack(&data)
        .map_err(|_| error!(AshError::TokenProgramMismatch))?;
    require!(state.base.is_initialized, AshError::TokenProgramMismatch);
    Ok(state.base.decimals)
}
