//! `execute_payment` (spec §5.3) — SPL Token and Token-2022.
//!
//! One program instruction, one token CPI. The Treasury PDA is the vault authority and
//! signs the transfer itself, so no separate authority account exists to be confused or
//! substituted. The destination token account is *derived* from `intent.destination_owner`
//! rather than accepted as an address, which is the difference between an allowlist that
//! constrains where money goes and one that constrains a label.

use anchor_lang::prelude::*;
use anchor_spl::associated_token::{
    self, get_associated_token_address_with_program_id, AssociatedToken,
};
use anchor_spl::token_interface::{self, Mint, TokenAccount, TokenInterface, TransferChecked};

use crate::args::PaymentIntent;
use crate::constants::{
    NATIVE_SUBSCRIPTIONS_PROGRAM, SEED_RECEIPT, SEED_SESSION, SEED_SOL_VAULT, SEED_TREASURY,
};
use crate::error::AgentRailsError;
use crate::events::{PaymentExecuted, EVENT_SCHEMA_VERSION};
use crate::instructions::payment::{self, CommitInputs, PaymentInputs};
use crate::native_allowance::{self, TransferFixedAccounts};
use crate::state::{AgentSession, AllowlistEntry, FundingMode, IntentReceipt, Policy, Treasury};

#[event_cpi]
#[derive(Accounts)]
#[instruction(intent: PaymentIntent)]
pub struct ExecutePayment<'info> {
    /// Pays receipt rent, and destination ATA rent if one is created. Separate from
    /// `session_key` so an operator can sponsor fees today and a relayer can slot in for
    /// v1.1 signed-intent mode without an account-layout change.
    #[account(mut)]
    pub fee_payer: Signer<'info>,

    /// The agent. `has_one` on `session` binds it to the registered key.
    pub session_key: Signer<'info>,

    #[account(
        seeds = [SEED_TREASURY, treasury.create_key.as_ref()],
        bump = treasury.bump,
    )]
    pub treasury: Box<Account<'info, Treasury>>,

    /// No `seeds` constraint, deliberately, and it is not a shortcut. `session` carries
    /// `has_one = policy`, and `session.policy` is written only by `create_session` from a
    /// policy that passed its own seeds check. `Account<Policy>` pins the owner and the
    /// discriminator. Re-deriving `["policy", treasury, name]` here would re-prove something
    /// already proven, at the cost of a `create_program_address` syscall on the hot path.
    pub policy: Box<Account<'info, Policy>>,

    #[account(
        mut,
        seeds = [SEED_SESSION, treasury.key().as_ref(), session_key.key().as_ref()],
        bump = session.bump,
        has_one = treasury @ AgentRailsError::Unauthorized,
        has_one = policy @ AgentRailsError::Unauthorized,
        has_one = session_key @ AgentRailsError::Unauthorized,
    )]
    pub session: Box<Account<'info, AgentSession>>,

    /// Required exactly when `policy.destination_mode == Allowlist`. The handler verifies
    /// the seeds rather than the derive macro, so an entry belonging to another policy
    /// fails with `DestinationNotAllowed` instead of a raw seeds error.
    pub allowlist_entry: Option<Box<Account<'info, AllowlistEntry>>>,

    #[account(address = intent.mint @ AgentRailsError::MintNotConfigured)]
    pub mint: Box<InterfaceAccount<'info, Mint>>,

    /// The vault. `associated_token::*` both derives the address and checks the
    /// deserialized owner, so this is the treasury's canonical account for this mint.
    #[account(
        mut,
        associated_token::mint = mint,
        associated_token::authority = treasury,
        associated_token::token_program = token_program,
    )]
    pub vault_ata: Box<InterfaceAccount<'info, TokenAccount>>,

    /// CHECK: the wallet that will control the funds. Pinned to the intent; the token
    /// account is derived from it below and this account itself is never read or written.
    #[account(address = intent.destination_owner @ AgentRailsError::DestinationNotAllowed)]
    pub destination_owner: UncheckedAccount<'info>,

    /// CHECK: address is derived in the handler from `(destination_owner, mint,
    /// token_program)`. Left unchecked here because creating it is gated on
    /// `policy.create_destination_ata`, which `init_if_needed` could not express: it would
    /// create the account during account validation, before the policy has been consulted.
    #[account(mut)]
    pub destination_ata: UncheckedAccount<'info>,

    /// The idempotency record. `init` is the entire mechanism: a replayed `intent_id`
    /// collides here and the transaction dies before any transfer (ADR-004).
    #[account(
        init,
        payer = fee_payer,
        space = IntentReceipt::LEN,
        seeds = [SEED_RECEIPT, session.key().as_ref(), intent.intent_id.as_ref()],
        bump,
    )]
    pub receipt: Box<Account<'info, IntentReceipt>>,

    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,

    // --- NativeAllowance funding mode (ADR-014) ---------------------------------------
    // All five `Option`al: an `IsolatedVault` mint pays none of the tx-size or CU cost of
    // these accounts, preserving the budget the vault path is tuned for (spec §10: ≤45k CU,
    // ≤1,000 bytes legacy; the measured baseline is in tests/cu-baselines.txt). The handler requires all five together, or none, based on
    // `mint_config.funding_mode` — see `execute_payment_handler`.
    /// CHECK: the owner's own ATA, source of funds when `funding_mode == NativeAllowance`.
    #[account(mut)]
    pub owner_source_ata: Option<UncheckedAccount<'info>>,
    /// CHECK: address re-derived and checked in the handler against
    /// `native_allowance::find_fixed_delegation`.
    #[account(mut)]
    pub native_delegation: Option<UncheckedAccount<'info>>,
    /// CHECK: address re-derived and checked in the handler against
    /// `native_allowance::find_subscription_authority`.
    pub native_subscription_authority: Option<UncheckedAccount<'info>>,
    /// CHECK: address re-derived and checked in the handler against
    /// `native_allowance::find_event_authority`.
    pub native_event_authority: Option<UncheckedAccount<'info>>,
    /// CHECK: address-pinned to `NATIVE_SUBSCRIPTIONS_PROGRAM` in the handler.
    pub native_subscriptions_program: Option<UncheckedAccount<'info>>,
}

pub fn execute_payment_handler(ctx: Context<ExecutePayment>, intent: PaymentIntent) -> Result<()> {
    let clock = Clock::get()?;
    let treasury_key = ctx.accounts.treasury.key();
    let policy_key = ctx.accounts.policy.key();
    let session_pda = ctx.accounts.session.key();

    // The SOL vault is not an account on this path, but it still has to be rejected as a
    // destination. Deriving it from the stored bump is one syscall and no extra account.
    let sol_vault = Pubkey::create_program_address(
        &[
            SEED_SOL_VAULT,
            treasury_key.as_ref(),
            &[ctx.accounts.treasury.sol_vault_bump],
        ],
        &crate::ID,
    )
    .map_err(|_| error!(AgentRailsError::SelfPaymentForbidden))?;

    let plan = payment::prepare(
        PaymentInputs {
            treasury: &ctx.accounts.treasury,
            treasury_key,
            sol_vault,
            policy: &ctx.accounts.policy,
            policy_key,
            allowlist_entry: ctx
                .accounts
                .allowlist_entry
                .as_ref()
                .map(|entry| (entry.key(), &***entry)),
            intent: &intent,
            now: clock.unix_timestamp,
            native: false,
        },
        &mut ctx.accounts.session,
    )?;

    // The token program is pinned by the owner at `add_mint`, so a Token-2022 mint can
    // never be paid through classic SPL Token or vice versa.
    require_keys_eq!(
        ctx.accounts.token_program.key(),
        plan.token_program,
        AgentRailsError::TokenProgramMismatch
    );

    // 11. Destination ATA. Run after every check so a rejected payment never spends the
    //     fee payer's rent, which is a reordering relative to the spec in the safe
    //     direction: the spec's step 11 precedes evaluation, this does not.
    let expected_destination_ata = get_associated_token_address_with_program_id(
        &intent.destination_owner,
        &intent.mint,
        &plan.token_program,
    );
    require_keys_eq!(
        ctx.accounts.destination_ata.key(),
        expected_destination_ata,
        AgentRailsError::DestinationNotAllowed
    );

    if ctx.accounts.destination_ata.data_is_empty() {
        require!(
            ctx.accounts.policy.create_destination_ata,
            AgentRailsError::DestinationAtaCreationDisabled
        );
        associated_token::create_idempotent(CpiContext::new(
            ctx.accounts.associated_token_program.key(),
            associated_token::Create {
                payer: ctx.accounts.fee_payer.to_account_info(),
                associated_token: ctx.accounts.destination_ata.to_account_info(),
                authority: ctx.accounts.destination_owner.to_account_info(),
                mint: ctx.accounts.mint.to_account_info(),
                system_program: ctx.accounts.system_program.to_account_info(),
                token_program: ctx.accounts.token_program.to_account_info(),
            },
        ))?;
    }

    // 14. The transfer. Every check above ran identically regardless of custody model;
    //     this is the only place that differs, and it decides transport, not amount —
    //     `intent.amount` is the same value `payment::prepare`'s `evaluate()` already
    //     approved, never recomputed here.
    let create_key = ctx.accounts.treasury.create_key;
    let treasury_bump = ctx.accounts.treasury.bump;
    let treasury_seeds: &[&[u8]] = &[SEED_TREASURY, create_key.as_ref(), &[treasury_bump]];

    let mint_config = ctx
        .accounts
        .treasury
        .find_mint(&intent.mint)
        .ok_or(AgentRailsError::MintNotConfigured)?;

    match mint_config.funding_mode {
        FundingMode::IsolatedVault => {
            token_interface::transfer_checked(
                CpiContext::new_with_signer(
                    ctx.accounts.token_program.key(),
                    TransferChecked {
                        from: ctx.accounts.vault_ata.to_account_info(),
                        mint: ctx.accounts.mint.to_account_info(),
                        to: ctx.accounts.destination_ata.to_account_info(),
                        authority: ctx.accounts.treasury.to_account_info(),
                    },
                    &[treasury_seeds],
                ),
                intent.amount,
                plan.decimals,
            )?;
        }
        FundingMode::NativeAllowance => {
            let owner_source_ata = ctx
                .accounts
                .owner_source_ata
                .as_ref()
                .ok_or(AgentRailsError::NativeAllowanceAccountsMissing)?;
            let native_delegation = ctx
                .accounts
                .native_delegation
                .as_ref()
                .ok_or(AgentRailsError::NativeAllowanceAccountsMissing)?;
            let native_subscription_authority = ctx
                .accounts
                .native_subscription_authority
                .as_ref()
                .ok_or(AgentRailsError::NativeAllowanceAccountsMissing)?;
            let native_event_authority = ctx
                .accounts
                .native_event_authority
                .as_ref()
                .ok_or(AgentRailsError::NativeAllowanceAccountsMissing)?;
            let native_subscriptions_program =
                ctx.accounts
                    .native_subscriptions_program
                    .as_ref()
                    .ok_or(AgentRailsError::NativeAllowanceAccountsMissing)?;

            require_keys_eq!(
                native_subscriptions_program.key(),
                NATIVE_SUBSCRIPTIONS_PROGRAM,
                AgentRailsError::Unauthorized
            );

            // Re-derive every native PDA rather than trusting the caller-supplied
            // addresses — the same pattern already used above for `allowlist_entry`.
            let owner = ctx.accounts.treasury.owner;
            let (expected_sa, _) =
                native_allowance::find_subscription_authority(&owner, &intent.mint);
            require_keys_eq!(
                native_subscription_authority.key(),
                expected_sa,
                AgentRailsError::InvalidNativeAllowancePda
            );

            let (expected_delegation, _) =
                native_allowance::find_fixed_delegation(&expected_sa, &owner, &treasury_key);
            require_keys_eq!(
                native_delegation.key(),
                expected_delegation,
                AgentRailsError::InvalidNativeAllowancePda
            );

            let (expected_event_authority, _) = native_allowance::find_event_authority();
            require_keys_eq!(
                native_event_authority.key(),
                expected_event_authority,
                AgentRailsError::InvalidNativeAllowancePda
            );

            native_allowance::transfer_fixed(
                TransferFixedAccounts {
                    native_delegation: native_delegation.to_account_info(),
                    subscription_authority: native_subscription_authority.to_account_info(),
                    delegator_ata: owner_source_ata.to_account_info(),
                    receiver_ata: ctx.accounts.destination_ata.to_account_info(),
                    token_mint: ctx.accounts.mint.to_account_info(),
                    token_program: ctx.accounts.token_program.to_account_info(),
                    // The Treasury PDA signs as delegatee — never `session_key`. An agent
                    // holding only a session key cannot produce this signature, so it
                    // cannot call the native program's `transferFixed` directly and skip
                    // every check `payment::prepare` just ran.
                    delegatee: ctx.accounts.treasury.to_account_info(),
                    event_authority: native_event_authority.to_account_info(),
                    native_program: native_subscriptions_program.to_account_info(),
                },
                intent.amount,
                owner,
                intent.mint,
                treasury_seeds,
            )?;
        }
    }

    // 15.
    let (seq, audit_head) = payment::commit(
        &mut ctx.accounts.session,
        &mut ctx.accounts.receipt,
        CommitInputs {
            session_address: session_pda,
            receipt_bump: ctx.bumps.receipt,
            plan: &plan,
            intent: &intent,
            fee_payer: ctx.accounts.fee_payer.key(),
            clock: &clock,
        },
    )?;

    // 16.
    emit_cpi!(PaymentExecuted {
        treasury: treasury_key,
        schema_version: EVENT_SCHEMA_VERSION,
        session: session_pda,
        seq,
        audit_head,
        intent_id: intent.intent_id,
        mint: intent.mint,
        destination_owner: intent.destination_owner,
        amount: intent.amount,
        slot: clock.slot,
        memo_hash: ctx.accounts.receipt.memo_hash,
        receipt: ctx.accounts.receipt.key(),
    });

    Ok(())
}
