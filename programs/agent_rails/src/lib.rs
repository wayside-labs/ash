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
pub mod state;

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
}
