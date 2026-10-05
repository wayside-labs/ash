//! `enable_native_allowance` (ADR-014) — owner-only, one-time per mint.
//!
//! Switches one already-configured mint from `FundingMode::IsolatedVault` to
//! `FundingMode::NativeAllowance` by registering the owner's wallet with the native
//! Solana Subscriptions & Allowances program and creating a `FixedDelegation` whose
//! `delegatee` is the Treasury PDA — never the agent's session key. This does not run on
//! the payment hot path: it is administrative setup, the same trust tier as `add_mint`.
//!
//! Custody model is a strictly stronger decision than spending policy, so like every
//! other treasury-shape change it is owner-only: the operator can set a policy under the
//! ceiling and the agent can spend under the policy, but neither may decide where the
//! money actually lives.

use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenInterface};

use crate::constants::{NATIVE_SUBSCRIPTIONS_PROGRAM, SEED_TREASURY};
use crate::error::AshError;
use crate::events::{NativeAllowanceEnabled, EVENT_SCHEMA_VERSION};
use crate::native_allowance::{
    self, CreateFixedDelegationAccounts, InitSubscriptionAuthorityAccounts,
};
use crate::state::{FundingMode, Treasury};

#[event_cpi]
#[derive(Accounts)]
pub struct EnableNativeAllowance<'info> {
    /// Pays rent for the native program's `SubscriptionAuthority` and `FixedDelegation`
    /// accounts. Always the owner in v1 — see `native_allowance::init_subscription_authority`
    /// for why `payer` is omitted from the native CPI rather than threaded through.
    #[account(mut)]
    pub owner: Signer<'info>,

    #[account(
        mut,
        seeds = [SEED_TREASURY, treasury.create_key.as_ref()],
        bump = treasury.bump,
        has_one = owner @ AshError::Unauthorized,
    )]
    pub treasury: Box<Account<'info, Treasury>>,

    pub mint: Box<InterfaceAccount<'info, Mint>>,

    /// The owner's own associated token account for `mint`. The source of funds once
    /// `NativeAllowance` is active; must already exist — ASH does not create or
    /// otherwise manage the owner's wallet.
    ///
    /// CHECK: passed straight through to the native program, which validates it as the
    /// token account backing `subscription_authority`'s delegation.
    #[account(mut)]
    pub owner_ata: UncheckedAccount<'info>,

    /// CHECK: address re-derived and checked in the handler against
    /// `native_allowance::find_subscription_authority(owner, mint)`.
    #[account(mut)]
    pub subscription_authority: UncheckedAccount<'info>,

    /// CHECK: address re-derived and checked in the handler against
    /// `native_allowance::find_fixed_delegation(subscription_authority, owner, treasury)`.
    #[account(mut)]
    pub native_delegation: UncheckedAccount<'info>,

    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,

    /// CHECK: address-pinned to `NATIVE_SUBSCRIPTIONS_PROGRAM` in the handler.
    pub native_subscriptions_program: UncheckedAccount<'info>,
}

pub fn enable_native_allowance_handler(
    ctx: Context<EnableNativeAllowance>,
    amount_cap: u64,
    expiry_ts: i64,
) -> Result<()> {
    require_keys_eq!(
        ctx.accounts.native_subscriptions_program.key(),
        NATIVE_SUBSCRIPTIONS_PROGRAM,
        AshError::Unauthorized
    );
    require!(amount_cap > 0, AshError::AmountZero);

    let treasury_key = ctx.accounts.treasury.key();
    let owner = ctx.accounts.owner.key();
    let mint_key = ctx.accounts.mint.key();

    let mint_slot = ctx
        .accounts
        .treasury
        .mints
        .iter()
        .position(|config| config.is_used() && config.mint == mint_key)
        .ok_or(AshError::MintNotConfigured)?;
    require!(
        ctx.accounts.treasury.mints[mint_slot].funding_mode == FundingMode::IsolatedVault,
        AshError::Unauthorized
    );

    // Re-derive both native PDAs instead of trusting the caller-supplied addresses — the
    // same pattern `execute_payment` already uses for `allowlist_entry`.
    let (expected_sa, _) = native_allowance::find_subscription_authority(&owner, &mint_key);
    require_keys_eq!(
        ctx.accounts.subscription_authority.key(),
        expected_sa,
        AshError::InvalidNativeAllowancePda
    );

    let (expected_delegation, _) =
        native_allowance::find_fixed_delegation(&expected_sa, &owner, &treasury_key);
    require_keys_eq!(
        ctx.accounts.native_delegation.key(),
        expected_delegation,
        AshError::InvalidNativeAllowancePda
    );

    // 1) init_subscription_authority — idempotent on the native side: a no-op if this
    //    (owner, mint) pair already has one, which lets an owner enable NativeAllowance
    //    on a second mint under the same wallet without a special case here.
    native_allowance::init_subscription_authority(InitSubscriptionAuthorityAccounts {
        owner: ctx.accounts.owner.to_account_info(),
        subscription_authority: ctx.accounts.subscription_authority.to_account_info(),
        token_mint: ctx.accounts.mint.to_account_info(),
        user_ata: ctx.accounts.owner_ata.to_account_info(),
        system_program: ctx.accounts.system_program.to_account_info(),
        token_program: ctx.accounts.token_program.to_account_info(),
    })?;

    // The native `createFixedDelegation` binds to a specific incarnation of the
    // SubscriptionAuthority via `expected_subscription_authority_init_id`; read it back
    // now that step 1 guarantees the account exists.
    let init_id = native_allowance::read_subscription_authority_init_id(
        &ctx.accounts.subscription_authority.to_account_info(),
    )?;

    // 2) create_fixed_delegation — delegatee is the Treasury PDA. This is the load-bearing
    //    security property of the whole feature: see the module doc on `native_allowance`.
    native_allowance::create_fixed_delegation(
        CreateFixedDelegationAccounts {
            owner: ctx.accounts.owner.to_account_info(),
            subscription_authority: ctx.accounts.subscription_authority.to_account_info(),
            native_delegation: ctx.accounts.native_delegation.to_account_info(),
            delegatee: ctx.accounts.treasury.to_account_info(),
            system_program: ctx.accounts.system_program.to_account_info(),
        },
        amount_cap,
        expiry_ts,
        init_id,
    )?;

    ctx.accounts.treasury.mints[mint_slot].funding_mode = FundingMode::NativeAllowance;

    emit_cpi!(NativeAllowanceEnabled {
        treasury: treasury_key,
        schema_version: EVENT_SCHEMA_VERSION,
        mint: mint_key,
        subscription_authority: expected_sa,
        native_delegation: expected_delegation,
        amount_cap,
        expiry_ts,
    });

    Ok(())
}
