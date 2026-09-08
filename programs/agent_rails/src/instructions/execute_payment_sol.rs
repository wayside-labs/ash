//! `execute_payment_sol` (spec §5.3) — native SOL.
//!
//! Same rules as `execute_payment`, four fewer accounts, and a System program transfer in
//! place of the token CPI. `sol_vault` is a system-owned PDA with zero data bytes, which is
//! what lets lamports leave it with nothing but `invoke_signed` — no token account, no ATA
//! rent, no wrapping. The rent-exempt floor is never spendable, so the vault cannot be
//! drained into deallocation.

use anchor_lang::prelude::*;
use anchor_lang::system_program::{self, Transfer};

use crate::args::PaymentIntent;
use crate::constants::{SEED_RECEIPT, SEED_SESSION, SEED_SOL_VAULT, SEED_TREASURY};
use crate::error::AgentRailsError;
use crate::events::{PaymentExecuted, EVENT_SCHEMA_VERSION};
use crate::instructions::payment::{self, CommitInputs, PaymentInputs};
use crate::state::{AgentSession, AllowlistEntry, IntentReceipt, Policy, Treasury};

#[event_cpi]
#[derive(Accounts)]
#[instruction(intent: PaymentIntent)]
pub struct ExecutePaymentSol<'info> {
    #[account(mut)]
    pub fee_payer: Signer<'info>,

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

    /// Required exactly when `policy.destination_mode == Allowlist`; seeds verified by the
    /// handler.
    pub allowlist_entry: Option<Box<Account<'info, AllowlistEntry>>>,

    #[account(
        mut,
        seeds = [SEED_SOL_VAULT, treasury.key().as_ref()],
        bump = treasury.sol_vault_bump,
    )]
    pub sol_vault: SystemAccount<'info>,

    /// `SystemAccount` is the point: lamports may only be sent to a system-owned wallet,
    /// never to a program-owned account this instruction could be tricked into writing.
    #[account(
        mut,
        address = intent.destination_owner @ AgentRailsError::DestinationNotAllowed,
    )]
    pub destination_owner: SystemAccount<'info>,

    #[account(
        init,
        payer = fee_payer,
        space = IntentReceipt::LEN,
        seeds = [SEED_RECEIPT, session.key().as_ref(), intent.intent_id.as_ref()],
        bump,
    )]
    pub receipt: Box<Account<'info, IntentReceipt>>,

    pub system_program: Program<'info, System>,
}

pub fn execute_payment_sol_handler(
    ctx: Context<ExecutePaymentSol>,
    intent: PaymentIntent,
) -> Result<()> {
    let clock = Clock::get()?;
    let treasury_key = ctx.accounts.treasury.key();
    let policy_key = ctx.accounts.policy.key();
    let session_pda = ctx.accounts.session.key();
    let sol_vault_key = ctx.accounts.sol_vault.key();

    let plan = payment::prepare(
        PaymentInputs {
            treasury: &ctx.accounts.treasury,
            treasury_key,
            sol_vault: sol_vault_key,
            policy: &ctx.accounts.policy,
            policy_key,
            allowlist_entry: ctx
                .accounts
                .allowlist_entry
                .as_ref()
                .map(|entry| (entry.key(), &***entry)),
            intent: &intent,
            now: clock.unix_timestamp,
            native: true,
        },
        &mut ctx.accounts.session,
    )?;

    // The sentinel is what selects this path in a client, so a `MintConfig` whose native
    // flag was set for some other mint must not reach the System transfer.
    require_keys_eq!(
        intent.mint,
        crate::constants::NATIVE_MINT,
        AgentRailsError::WrongPaymentPath
    );

    // 14a. The floor is read from the Rent sysvar, not hardcoded: an account that drops
    //      below rent exemption is reclaimed by the runtime, and the vault PDA disappearing
    //      would take its address — and every allowlist assumption about it — with it.
    let floor = Rent::get()?.minimum_balance(0);
    let spendable = ctx
        .accounts
        .sol_vault
        .lamports()
        .checked_sub(floor)
        .ok_or(AgentRailsError::InsufficientVaultBalance)?;
    require!(
        intent.amount <= spendable,
        AgentRailsError::InsufficientVaultBalance
    );

    // 14b.
    let sol_vault_bump = ctx.accounts.treasury.sol_vault_bump;
    let vault_seeds: &[&[u8]] = &[SEED_SOL_VAULT, treasury_key.as_ref(), &[sol_vault_bump]];
    system_program::transfer(
        CpiContext::new_with_signer(
            ctx.accounts.system_program.key(),
            Transfer {
                from: ctx.accounts.sol_vault.to_account_info(),
                to: ctx.accounts.destination_owner.to_account_info(),
            },
            &[vault_seeds],
        ),
        intent.amount,
    )?;

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
