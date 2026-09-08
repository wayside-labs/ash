//! `remove_mint` (spec §5.1).
//!
//! Delists a mint and frees its slot for reuse. Two preconditions, both of which exist to
//! keep the delisting from stranding value or leaving dangling references:
//!
//! - **The vault must be empty** — zero tokens, or `sol_vault` exactly at its rent floor for
//!   native. Otherwise removing the mint would orphan a balance the owner can no longer
//!   reach through `withdraw`, since `withdraw` resolves the mint through `Treasury.mints`.
//! - **`policy_count == 0`.** The program cannot enumerate policy PDAs, so it cannot check
//!   whether any *particular* policy still names this mint. §5.1 chooses the strict rule for
//!   auditability, and it has a useful consequence: a live policy referencing an
//!   unconfigured mint is unreachable, so `execute_payment`'s `MintNotConfigured` check is
//!   pure defense in depth rather than a load-bearing runtime guard.
//!
//! The vault ATA is left in place, not closed. It is rent-exempt and empty, re-adding the
//! mint finds it via `create_idempotent`, and closing it would need a token CPI signed by
//! the treasury for no benefit the owner asked for.

use anchor_lang::prelude::*;
use anchor_spl::associated_token::get_associated_token_address_with_program_id;
use anchor_spl::token_interface::TokenAccount;

use crate::constants::{SEED_SOL_VAULT, SEED_TREASURY};
use crate::error::AgentRailsError;
use crate::events::{MintRemoved, EVENT_SCHEMA_VERSION};
use crate::state::{MintConfig, Treasury};

#[event_cpi]
#[derive(Accounts)]
pub struct RemoveMint<'info> {
    pub owner: Signer<'info>,

    #[account(
        mut,
        seeds = [SEED_TREASURY, treasury.create_key.as_ref()],
        bump = treasury.bump,
        has_one = owner @ AgentRailsError::Unauthorized,
    )]
    pub treasury: Box<Account<'info, Treasury>>,

    /// CHECK: identified by key only. The slot is found by address in `Treasury.mints`, and
    /// nothing here reads the mint's data — a mint whose account was somehow closed must
    /// still be delistable.
    pub mint: UncheckedAccount<'info>,

    /// Required for SPL and Token-2022, omitted for native SOL. Deserialized so its
    /// `amount` can be checked; the address is re-derived from the stored token program.
    pub vault_ata: Option<Box<InterfaceAccount<'info, TokenAccount>>>,

    /// Required for native SOL, omitted otherwise. Spec §5.1 lists only `vault_ata`, but the
    /// native path has no token account and its emptiness check is "at the rent floor"
    /// instead — so the two are mutually exclusive optionals.
    #[account(
        seeds = [SEED_SOL_VAULT, treasury.key().as_ref()],
        bump = treasury.sol_vault_bump,
    )]
    pub sol_vault: Option<SystemAccount<'info>>,
}

pub fn remove_mint_handler(ctx: Context<RemoveMint>) -> Result<()> {
    // Strict rule from spec §5.1: no policies at all, not "no policy naming this mint".
    require!(
        ctx.accounts.treasury.policy_count == 0,
        AgentRailsError::TreasuryNotEmpty
    );

    let mint = ctx.accounts.mint.key();
    let slot = ctx
        .accounts
        .treasury
        .mints
        .iter()
        .position(|config| config.is_used() && config.mint == mint)
        .ok_or(AgentRailsError::MintNotConfigured)?;
    let config = ctx.accounts.treasury.mints[slot];

    if config.is_native() {
        let sol_vault = ctx
            .accounts
            .sol_vault
            .as_ref()
            .ok_or(AgentRailsError::InsufficientVaultBalance)?;
        // At the floor exactly: anything above it is spendable balance that would be
        // stranded, and the floor itself is never spendable anyway.
        let floor = Rent::get()?.minimum_balance(0);
        require!(
            sol_vault.lamports() <= floor,
            AgentRailsError::TreasuryNotEmpty
        );
    } else {
        let vault_ata = ctx
            .accounts
            .vault_ata
            .as_ref()
            .ok_or(AgentRailsError::TokenProgramMismatch)?;
        let expected = get_associated_token_address_with_program_id(
            &ctx.accounts.treasury.key(),
            &mint,
            &config.token_program,
        );
        require_keys_eq!(
            vault_ata.key(),
            expected,
            AgentRailsError::TokenProgramMismatch
        );
        require!(vault_ata.amount == 0, AgentRailsError::TreasuryNotEmpty);
    }

    let treasury = &mut ctx.accounts.treasury;
    treasury.mints[slot] = MintConfig::EMPTY;
    treasury.mint_count = treasury
        .mint_count
        .checked_sub(1)
        .ok_or(AgentRailsError::MathOverflow)?;

    emit_cpi!(MintRemoved {
        treasury: treasury.key(),
        schema_version: EVENT_SCHEMA_VERSION,
        mint,
        token_program: config.token_program,
        flags: config.flags,
    });

    Ok(())
}
