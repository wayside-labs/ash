//! `add_mint` (spec §5.1) — native SOL, SPL Token, and Token-2022.
//!
//! This instruction is the Token-2022 extension gate (ADR-010). Vault ATAs are created
//! idempotently via the Associated Token Account program so a retry after a dropped
//! confirmation cannot leave the treasury pointing at a mint with no vault.

use anchor_lang::prelude::*;
use anchor_spl::associated_token::{
    self, get_associated_token_address_with_program_id, AssociatedToken,
};
use anchor_spl::token_2022::spl_token_2022::{
    extension::{BaseStateWithExtensions, ExtensionType, StateWithExtensions},
    state::Mint as SplMint,
};
use anchor_spl::token_interface::TokenInterface;

use crate::args::MintCeilingInput;
use crate::constants::{MintFlags, NATIVE_MINT, SEED_TREASURY};
use crate::error::{AshError, IntoAnchorResult};
use crate::events::{MintAdded, EVENT_SCHEMA_VERSION};
use crate::state::{MintConfig, Treasury};

/// Decimals of native SOL (lamports per SOL is 10^9).
const NATIVE_DECIMALS: u8 = 9;

#[event_cpi]
#[derive(Accounts)]
pub struct AddMint<'info> {
    /// Rent payer for a newly created vault ATA. Native SOL does not create one.
    #[account(mut)]
    pub owner: Signer<'info>,

    #[account(
        mut,
        seeds = [SEED_TREASURY, treasury.create_key.as_ref()],
        bump = treasury.bump,
        has_one = owner @ AshError::Unauthorized,
    )]
    pub treasury: Account<'info, Treasury>,

    /// CHECK: `NATIVE_MINT` is a sentinel and need not exist. Otherwise the account must
    /// be an initialized mint owned by SPL Token or Token-2022; the handler enforces that
    /// before reading decimals or extensions.
    pub mint: UncheckedAccount<'info>,

    /// Vault ATA for `(treasury, mint, token_program)`. Omitted for native SOL (spec §5.1).
    ///
    /// CHECK: address is derived in the handler and the account is created idempotently
    /// by the Associated Token Account program, which is the authority on that PDA.
    #[account(mut)]
    pub vault_ata: Option<UncheckedAccount<'info>>,

    /// SPL Token or Token-2022. Omitted for native SOL; the System program is stored
    /// in `MintConfig.token_program` on that path instead.
    pub token_program: Option<Interface<'info, TokenInterface>>,

    /// Omitted for native SOL; required whenever `vault_ata` is created.
    pub associated_token_program: Option<Program<'info, AssociatedToken>>,

    pub system_program: Program<'info, System>,
}

pub fn add_mint_handler(ctx: Context<AddMint>, ceiling: MintCeilingInput) -> Result<()> {
    let ceiling = ceiling.to_state();
    ash_policy::validate_ceiling(&ceiling.to_policy()).or_anchor_err()?;

    let mint = ctx.accounts.mint.key();
    let native = mint == NATIVE_MINT;
    let (token_program, decimals, flags) = if native {
        (
            ctx.accounts.system_program.key(),
            NATIVE_DECIMALS,
            MintFlags::IS_NATIVE,
        )
    } else {
        let prep = prepare_spl_mint(&ctx)?;
        (prep.token_program, prep.decimals, prep.flags)
    };

    // Slot checks before the ATA CPI so a full or duplicate treasury never pays rent.
    require!(
        ctx.accounts.treasury.find_mint(&mint).is_none(),
        AshError::DuplicateMint
    );
    let slot = ctx
        .accounts
        .treasury
        .free_mint_slot()
        .ok_or(AshError::MintSlotsFull)?;

    if !native {
        create_vault_ata_idempotent(&ctx)?;
    }

    let treasury = &mut ctx.accounts.treasury;

    treasury.mints[slot] = MintConfig {
        mint,
        token_program,
        decimals,
        flags,
        funding_mode: crate::state::FundingMode::IsolatedVault,
        _pad: [0u8; 5],
        ceiling,
    };
    treasury.mint_count = treasury
        .mint_count
        .checked_add(1)
        .ok_or(AshError::MathOverflow)?;

    emit_cpi!(MintAdded {
        treasury: treasury.key(),
        schema_version: EVENT_SCHEMA_VERSION,
        mint,
        token_program,
        flags,
        ceiling,
    });

    Ok(())
}

struct SplMintPrep {
    token_program: Pubkey,
    decimals: u8,
    flags: u8,
}

/// Account and mint checks with no external effects. The vault ATA CPI is a separate
/// step so a failed validation never creates an account.
fn prepare_spl_mint(ctx: &Context<AddMint>) -> Result<SplMintPrep> {
    let token_program = ctx
        .accounts
        .token_program
        .as_ref()
        .ok_or(AshError::TokenProgramMismatch)?;
    let vault_ata = ctx
        .accounts
        .vault_ata
        .as_ref()
        .ok_or(AshError::TokenProgramMismatch)?;
    ctx.accounts
        .associated_token_program
        .as_ref()
        .ok_or(AshError::TokenProgramMismatch)?;

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
    require_keys_eq!(vault_ata.key(), expected_vault);

    let is_token_2022 = token_program_key == anchor_spl::token_2022::ID;
    let (decimals, flags) = parse_mint(&ctx.accounts.mint.to_account_info(), is_token_2022)?;

    Ok(SplMintPrep {
        token_program: token_program_key,
        decimals,
        flags,
    })
}

fn create_vault_ata_idempotent(ctx: &Context<AddMint>) -> Result<()> {
    let token_program = ctx
        .accounts
        .token_program
        .as_ref()
        .ok_or(AshError::TokenProgramMismatch)?;
    let vault_ata = ctx
        .accounts
        .vault_ata
        .as_ref()
        .ok_or(AshError::TokenProgramMismatch)?;
    let associated_token_program = ctx
        .accounts
        .associated_token_program
        .as_ref()
        .ok_or(AshError::TokenProgramMismatch)?;

    associated_token::create_idempotent(CpiContext::new(
        associated_token_program.key(),
        associated_token::Create {
            payer: ctx.accounts.owner.to_account_info(),
            associated_token: vault_ata.to_account_info(),
            authority: ctx.accounts.treasury.to_account_info(),
            mint: ctx.accounts.mint.to_account_info(),
            system_program: ctx.accounts.system_program.to_account_info(),
            token_program: token_program.to_account_info(),
        },
    ))
}

fn parse_mint(mint: &AccountInfo, is_token_2022: bool) -> Result<(u8, u8)> {
    let data = mint.try_borrow_data()?;
    let state = StateWithExtensions::<SplMint>::unpack(&data)
        .map_err(|_| error!(AshError::TokenProgramMismatch))?;
    require!(state.base.is_initialized, AshError::TokenProgramMismatch);

    let flags = if is_token_2022 {
        flags_from_extensions(&state)?
    } else {
        0
    };
    Ok((state.base.decimals, flags))
}

/// Rejects the extensions ADR-010 forbids and records the ones the payment path
/// has to treat specially. Anything unlisted is allowed through with no flag.
fn flags_from_extensions(state: &StateWithExtensions<SplMint>) -> Result<u8> {
    let mut flags = 0u8;
    for ext in state
        .get_extension_types()
        .map_err(|_| error!(AshError::TokenProgramMismatch))?
    {
        match ext {
            ExtensionType::TransferHook
            | ExtensionType::ConfidentialTransferMint
            | ExtensionType::NonTransferable => {
                return err!(AshError::UnsupportedMintExtension);
            }
            ExtensionType::TransferFeeConfig => flags |= MintFlags::HAS_TRANSFER_FEE,
            ExtensionType::PermanentDelegate => flags |= MintFlags::HAS_PERMANENT_DELEGATE,
            _ => {}
        }
    }
    Ok(flags)
}
