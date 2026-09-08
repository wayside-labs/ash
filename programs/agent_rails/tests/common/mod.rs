//! Shared LiteSVM harness for the `agent_rails` integration tests (layer 2 of ADR-008).
//!
//! The goal is that a test reads like the instruction it exercises: derive the PDAs, build
//! the instruction from the Anchor-generated client types, execute, assert. Everything
//! repetitive — locating the SBF artifact, deploying it, deriving seeds, funding
//! keypairs — lives here.
//!
//! Run `cargo build-sbf --manifest-path programs/agent_rails/Cargo.toml` before
//! `cargo test`; these tests execute the real compiled program, not a host-native stub.

#![allow(dead_code)]

use std::path::PathBuf;

use anchor_litesvm::{
    AnchorContext, AnchorLiteSVM, Instruction, Keypair, Pubkey, Signer, TestHelpers,
    TransactionResult,
};

use agent_rails::constants::{NATIVE_MINT, SEED_SOL_VAULT, SEED_TREASURY};
use agent_rails::state::Treasury;
use agent_rails::{AgentRailsError, MintCeilingArgs};

/// Default funding for harness-created keypairs: 100 SOL, far above any rent or fee here.
pub const DEFAULT_FUNDING_LAMPORTS: u64 = 100_000_000_000;

/// Locates `agent_rails.so`.
///
/// The path is resolved from the running test binary rather than hardcoded, because
/// `CARGO_TARGET_DIR` may point outside the workspace (CI caches, sandboxes). Set
/// `AGENT_RAILS_SO` to override.
fn program_bytes() -> Vec<u8> {
    if let Ok(path) = std::env::var("AGENT_RAILS_SO") {
        return std::fs::read(&path)
            .unwrap_or_else(|e| panic!("AGENT_RAILS_SO={path} could not be read: {e}"));
    }

    // The test binary lives at `<target>/<profile>/deps/<name>`, so walking up finds
    // `<target>/deploy/agent_rails.so` regardless of where the target directory is.
    let mut dir: PathBuf = std::env::current_exe().expect("current_exe");
    while dir.pop() {
        let candidate = dir.join("deploy").join("agent_rails.so");
        if candidate.is_file() {
            return std::fs::read(candidate).expect("read agent_rails.so");
        }
    }

    panic!(
        "agent_rails.so not found. Build it first:\n  \
         cargo build-sbf --manifest-path programs/agent_rails/Cargo.toml"
    );
}

/// A deployed program plus the accounts a test has created against it.
pub struct Env {
    pub ctx: AnchorContext,
}

impl Env {
    /// Boots a LiteSVM instance with `agent_rails` deployed at its declared address.
    pub fn new() -> Self {
        Self {
            ctx: AnchorLiteSVM::build_with_program(agent_rails::ID, &program_bytes()),
        }
    }

    /// A funded keypair for use as a payer, owner, or operator.
    pub fn keypair(&mut self) -> Keypair {
        self.ctx
            .svm
            .create_funded_account(DEFAULT_FUNDING_LAMPORTS)
            .expect("fund keypair")
    }

    /// Executes one instruction, expiring the blockhash first.
    ///
    /// Without the expiry, replaying an identical instruction with the same signers in the
    /// same LiteSVM instance produces a byte-identical transaction, and the runtime rejects
    /// it as `AlreadyProcessed` before the program ever runs. That would silently turn
    /// "the program rejected this" tests into "the runtime deduplicated this" tests.
    pub fn execute(&mut self, ix: Instruction, signers: &[&Keypair]) -> TransactionResult {
        self.ctx.svm.expire_blockhash();
        self.ctx
            .execute_instruction(ix, signers)
            .expect("submit transaction")
    }

    /// The `unix_timestamp` the program will read from `Clock::get()`.
    pub fn now(&self) -> i64 {
        self.ctx
            .svm
            .get_sysvar::<anchor_lang::prelude::Clock>()
            .unix_timestamp
    }

    pub fn lamports(&self, address: &Pubkey) -> u64 {
        self.ctx
            .svm
            .get_account(address)
            .map(|account| account.lamports)
            .unwrap_or(0)
    }

    /// Raw account data, for tests that assert on byte offsets rather than decoded fields.
    pub fn account_data(&self, address: &Pubkey) -> Vec<u8> {
        self.ctx
            .svm
            .get_account(address)
            .unwrap_or_else(|| panic!("account {address} does not exist"))
            .data
    }

    pub fn treasury(&self, address: &Pubkey) -> Treasury {
        self.ctx.get_account(address).expect("decode Treasury")
    }

    // -- PDA derivations (spec §2) ------------------------------------------------------

    pub fn treasury_pda(create_key: &Pubkey) -> (Pubkey, u8) {
        Pubkey::find_program_address(&[SEED_TREASURY, create_key.as_ref()], &agent_rails::ID)
    }

    pub fn sol_vault_pda(treasury: &Pubkey) -> (Pubkey, u8) {
        Pubkey::find_program_address(&[SEED_SOL_VAULT, treasury.as_ref()], &agent_rails::ID)
    }

    /// Anchor's `emit_cpi!` authority, an implicit account on every emitting instruction.
    pub fn event_authority() -> Pubkey {
        Pubkey::find_program_address(&[b"__event_authority"], &agent_rails::ID).0
    }
}

/// The addresses and keys produced by [`create_treasury`], bundled so a test can chain
/// follow-up instructions without re-deriving anything.
pub struct TreasuryFixture {
    pub create_key: Keypair,
    pub payer: Keypair,
    pub owner: Keypair,
    pub operator: Pubkey,
    pub recovery_destination: Pubkey,
    pub treasury: Pubkey,
    pub treasury_bump: u8,
    pub sol_vault: Pubkey,
    pub sol_vault_bump: u8,
}

/// Runs `create_treasury` with the given ceiling flags and a fresh ephemeral `create_key`.
///
/// `payer` and `owner` are the same keypair, which is the common case; tests that care
/// about the distinction build the instruction themselves.
pub fn create_treasury(
    env: &mut Env,
    allow_any_destination: bool,
    allow_create_destination_ata: bool,
) -> TreasuryFixture {
    let payer = env.keypair();
    let owner = payer.insecure_clone();
    let create_key = Keypair::new();
    let operator = Pubkey::new_unique();
    let recovery_destination = Pubkey::new_unique();

    let (treasury, treasury_bump) = Env::treasury_pda(&create_key.pubkey());
    let (sol_vault, sol_vault_bump) = Env::sol_vault_pda(&treasury);

    let ix = env
        .ctx
        .program()
        .accounts(agent_rails::accounts::CreateTreasury {
            payer: payer.pubkey(),
            create_key: create_key.pubkey(),
            treasury,
            sol_vault,
            system_program: anchor_lang::system_program::ID,
            event_authority: Env::event_authority(),
            program: agent_rails::ID,
        })
        .args(agent_rails::instruction::CreateTreasury {
            owner: owner.pubkey(),
            operator,
            recovery_destination,
            allow_any_destination,
            allow_create_destination_ata,
        })
        .instruction()
        .expect("build create_treasury instruction");

    env.execute(ix, &[&payer, &create_key]).assert_success();

    TreasuryFixture {
        create_key,
        payer,
        owner,
        operator,
        recovery_destination,
        treasury,
        treasury_bump,
        sol_vault,
        sol_vault_bump,
    }
}

/// Builds an `add_mint` instruction, leaving execution to the caller so that negative tests
/// can vary the signer or the mint.
pub fn add_mint_ix(
    env: &Env,
    treasury: &Pubkey,
    owner: &Pubkey,
    mint: Pubkey,
    ceiling: MintCeilingArgs,
) -> Instruction {
    env.ctx
        .program()
        .accounts(agent_rails::accounts::AddMint {
            owner: *owner,
            treasury: *treasury,
            mint,
            system_program: anchor_lang::system_program::ID,
            event_authority: Env::event_authority(),
            program: agent_rails::ID,
        })
        .args(agent_rails::instruction::AddMint { ceiling })
        .instruction()
        .expect("build add_mint instruction")
}

/// Runs `add_mint` for the native SOL sentinel with the given ceiling.
pub fn add_native_mint(env: &mut Env, fixture: &TreasuryFixture, ceiling: MintCeilingArgs) {
    let ix = add_mint_ix(
        env,
        &fixture.treasury,
        &fixture.owner.pubkey(),
        NATIVE_MINT,
        ceiling,
    );
    let owner = fixture.owner.insecure_clone();
    env.execute(ix, &[&owner]).assert_success();
}

/// Asserts the transaction failed with a specific `AgentRailsError`.
///
/// `TransactionResult::assert_error_code` is not usable here: it looks for the RPC-style
/// `"custom program error: 0x..."` string, which LiteSVM never produces — its error is the
/// `Debug` form `InstructionError(0, Custom(6024))`. Matching the numeric code directly also
/// keeps the assertion tied to spec §9 rather than to a message.
pub fn assert_program_error(result: &TransactionResult, expected: AgentRailsError) {
    let code = u32::from(expected);
    let actual = result.error().unwrap_or_else(|| {
        panic!(
            "expected the transaction to fail with {expected:?} ({code}), but it succeeded.\nLogs:\n{}",
            result.logs().join("\n")
        )
    });

    assert!(
        actual.contains(&format!("Custom({code})")),
        "expected {expected:?} ({code}), got: {actual}\nLogs:\n{}",
        result.logs().join("\n")
    );
}

/// A ceiling that is permissive but still valid, for tests whose subject is not the ceiling
/// itself.
pub fn permissive_ceiling() -> MintCeilingArgs {
    MintCeilingArgs {
        max_per_tx: 10_000_000_000,
        max_short_window: 50_000_000_000,
        max_long_window: 200_000_000_000,
        max_lifetime: 1_000_000_000_000,
        min_short_window_seconds: 3_600,
        min_long_window_seconds: 86_400,
    }
}
