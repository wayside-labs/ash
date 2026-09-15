//! `agent_rails` — programmable spending rails for autonomous agents.
//!
//! An owner funds a `Treasury` and sets a per-mint ceiling. An operator writes `Policy`
//! accounts under that ceiling and hands out short-lived `AgentSession`s to agent keys.
//! An agent signs payments with its session key and can never exceed the policy, which can
//! never exceed the ceiling.
//!
//! This crate deliberately contains only account validation, CPI, and state transitions.
//! All policy arithmetic and the audit hash chain live in `agent-rails-policy`, which has
//! no Solana dependency and is property-tested and model-checked on its own (ADR-008).
//!
//! Byte-level contract: `docs/spec/accounts-and-instructions.md`.

use anchor_lang::prelude::*;

pub mod args;
pub mod constants;
pub mod error;
pub mod events;
pub mod instructions;
pub mod native_allowance;
pub mod state;
pub mod validation;

pub use args::*;
pub use constants::*;
pub use error::AgentRailsError;
pub use state::*;

use instructions::*;

declare_id!("4qjD6vSgYa3oBKde3KVzsH8oCcP9BKsirX1xtD5SS6BS");

#[program]
pub mod agent_rails {
    use super::*;

    /// Creates a treasury and funds its native SOL vault to the rent floor (spec §5.1).
    pub fn create_treasury(
        ctx: Context<CreateTreasury>,
        owner: Pubkey,
        operator: Pubkey,
        recovery_destination: Pubkey,
        allow_any_destination: bool,
        allow_create_destination_ata: bool,
    ) -> Result<()> {
        instructions::create_treasury::create_treasury_handler(
            ctx,
            owner,
            operator,
            recovery_destination,
            allow_any_destination,
            allow_create_destination_ata,
        )
    }

    /// Configures a mint slot and its spending ceiling (spec §5.1).
    pub fn add_mint(ctx: Context<AddMint>, ceiling: MintCeilingArgs) -> Result<()> {
        instructions::add_mint::add_mint_handler(ctx, ceiling)
    }

    /// Switches a configured mint from `IsolatedVault` to `NativeAllowance` funding by
    /// registering a native Solana Subscriptions & Allowances `FixedDelegation` whose
    /// `delegatee` is this treasury's PDA (ADR-014). Owner-only, one-time per mint.
    pub fn enable_native_allowance(
        ctx: Context<EnableNativeAllowance>,
        amount_cap: u64,
        expiry_ts: i64,
    ) -> Result<()> {
        instructions::enable_native_allowance::enable_native_allowance_handler(
            ctx, amount_cap, expiry_ts,
        )
    }

    /// Pays an SPL Token or Token-2022 amount from the vault, subject to the full policy
    /// check sequence (spec §5.3).
    pub fn execute_payment(ctx: Context<ExecutePayment>, intent: PaymentIntent) -> Result<()> {
        instructions::execute_payment::execute_payment_handler(ctx, intent)
    }

    /// The same payment, in native SOL from `sol_vault` (spec §5.3).
    pub fn execute_payment_sol(
        ctx: Context<ExecutePaymentSol>,
        intent: PaymentIntent,
    ) -> Result<()> {
        instructions::execute_payment_sol::execute_payment_sol_handler(ctx, intent)
    }

    /// Creates a named rule set bounded by the treasury's ceilings (spec §5.2).
    pub fn create_policy(
        ctx: Context<CreatePolicy>,
        name: [u8; MAX_NAME_LEN],
        args: PolicyArgs,
    ) -> Result<()> {
        instructions::create_policy::create_policy_handler(ctx, name, args)
    }

    /// Reclaims a policy with no active sessions (spec §5.2).
    pub fn close_policy(ctx: Context<ClosePolicy>) -> Result<()> {
        instructions::close_policy::close_policy_handler(ctx)
    }

    /// Approves one destination wallet for a policy (spec §5.2).
    pub fn add_allowlist_entry(
        ctx: Context<AddAllowlistEntry>,
        destination_owner: Pubkey,
        label: [u8; MAX_NAME_LEN],
        per_tx_max_override: u64,
    ) -> Result<()> {
        instructions::add_allowlist_entry::add_allowlist_entry_handler(
            ctx,
            destination_owner,
            label,
            per_tx_max_override,
        )
    }

    /// Withdraws that approval and reclaims its rent (spec §5.2).
    pub fn remove_allowlist_entry(ctx: Context<RemoveAllowlistEntry>) -> Result<()> {
        instructions::remove_allowlist_entry::remove_allowlist_entry_handler(ctx)
    }

    /// Issues a time-boxed spending session to one agent key (spec §5.2).
    pub fn create_session(
        ctx: Context<CreateSession>,
        session_key: Pubkey,
        label: [u8; MAX_NAME_LEN],
        expires_at: i64,
        auth_mode: u8,
    ) -> Result<()> {
        instructions::create_session::create_session_handler(
            ctx,
            session_key,
            label,
            expires_at,
            auth_mode,
        )
    }

    /// Stops one agent immediately and permanently (spec §5.2).
    pub fn revoke_session(ctx: Context<RevokeSession>) -> Result<()> {
        instructions::revoke_session::revoke_session_handler(ctx)
    }

    /// Reclaims a revoked or expired session's rent (spec §5.2).
    pub fn close_session(ctx: Context<CloseSession>) -> Result<()> {
        instructions::close_session::close_session_handler(ctx)
    }

    /// Rewrites a live policy's rules, still bounded by the ceiling (spec §5.2).
    pub fn update_policy(ctx: Context<UpdatePolicy>, args: PolicyArgs) -> Result<()> {
        instructions::update_policy::update_policy_handler(ctx, args)
    }

    /// Moves the owner's bound on one mint, and the two destination flags (spec §5.1).
    pub fn set_ceiling(
        ctx: Context<SetCeiling>,
        mint: Pubkey,
        ceiling: MintCeilingArgs,
        allow_any_destination: bool,
        allow_create_destination_ata: bool,
    ) -> Result<()> {
        instructions::set_ceiling::set_ceiling_handler(
            ctx,
            mint,
            ceiling,
            allow_any_destination,
            allow_create_destination_ata,
        )
    }

    /// Delists a mint whose vault is empty, freeing its slot (spec §5.1).
    pub fn remove_mint(ctx: Context<RemoveMint>) -> Result<()> {
        instructions::remove_mint::remove_mint_handler(ctx)
    }

    /// Rotates the owner and/or operator (spec §5.1).
    pub fn set_roles(
        ctx: Context<SetRoles>,
        new_owner: Option<Pubkey>,
        new_operator: Option<Pubkey>,
    ) -> Result<()> {
        instructions::set_roles::set_roles_handler(ctx, new_owner, new_operator)
    }

    /// Registers one guardian key (spec §5.1).
    pub fn add_guardian(ctx: Context<AddGuardian>, guardian: Pubkey) -> Result<()> {
        instructions::add_guardian::add_guardian_handler(ctx, guardian)
    }

    /// Drops one guardian key (spec §5.1).
    pub fn remove_guardian(ctx: Context<RemoveGuardian>, guardian: Pubkey) -> Result<()> {
        instructions::remove_guardian::remove_guardian_handler(ctx, guardian)
    }

    /// Agent kill switch. Owner or a registered guardian (spec §5.1).
    pub fn pause(ctx: Context<Pause>) -> Result<()> {
        instructions::pause::pause_handler(ctx)
    }

    /// Restores agent payments. Owner-only (spec §5.1).
    pub fn unpause(ctx: Context<Unpause>) -> Result<()> {
        instructions::unpause::unpause_handler(ctx)
    }

    /// Owner withdrawal of vault funds, permitted while paused (spec §5.1).
    pub fn withdraw(ctx: Context<Withdraw>, amount: u64) -> Result<()> {
        instructions::withdraw::withdraw_handler(ctx, amount)
    }

    /// Reclaims the treasury once every vault, policy, and session is gone (spec §5.1).
    pub fn close_treasury(ctx: Context<CloseTreasury>) -> Result<()> {
        instructions::close_treasury::close_treasury_handler(ctx)
    }

    /// Permissionless receipt reclamation after expiry plus grace (spec §5.4).
    pub fn close_receipt(ctx: Context<CloseReceipt>) -> Result<()> {
        instructions::close_receipt::close_receipt_handler(ctx)
    }
}
