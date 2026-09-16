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
    AnchorContext, AnchorLiteSVM, Instruction, Keypair, Pubkey, Signer, TransactionResult,
};

use agent_rails::constants::{NATIVE_MINT, SEED_SOL_VAULT, SEED_TREASURY};
use agent_rails::state::Treasury;
use agent_rails::{AgentRailsError, MintCeilingInput};

use anchor_spl::associated_token::{
    get_associated_token_address_with_program_id, ID as ASSOCIATED_TOKEN_PROGRAM_ID,
};
use anchor_spl::token::ID as TOKEN_PROGRAM_ID;
use anchor_spl::token_2022::spl_token_2022::{
    extension::{
        transfer_fee::instruction as transfer_fee_ix,
        transfer_hook::instruction as transfer_hook_ix, ExtensionType,
    },
    instruction as token_2022_ix,
    state::Mint as Token2022Mint,
};
use anchor_spl::token_2022::ID as TOKEN_2022_PROGRAM_ID;

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
    deploy_so_bytes(
        "agent_rails.so",
        "cargo build-sbf --manifest-path programs/agent_rails/Cargo.toml",
    )
}

/// Locates any other workspace program's compiled `.so` under `<target>/deploy/`, walking
/// up from the running test binary the same way `program_bytes` does for `agent_rails`
/// itself — so this works regardless of where `CARGO_TARGET_DIR` points.
fn deploy_so_bytes(file_name: &str, build_hint: &str) -> Vec<u8> {
    let mut dir: PathBuf = std::env::current_exe().expect("current_exe");
    while dir.pop() {
        let candidate = dir.join("deploy").join(file_name);
        if candidate.is_file() {
            return std::fs::read(candidate).unwrap_or_else(|e| panic!("read {file_name}: {e}"));
        }
    }
    panic!("{file_name} not found. Build it first:\n  {build_hint}");
}

/// A deployed program plus the accounts a test has created against it.
pub struct Env {
    pub ctx: AnchorContext,
    /// Monotonic counter behind every key this harness hands out.
    ///
    /// Deterministic *per test*, which is the whole point. A fresh `Env` starts at zero and
    /// a test issues its keys in a fixed order, so the same test always derives the same
    /// addresses — and therefore the same `find_program_address` bump searches, and the same
    /// compute-unit count. A process-global counter cannot do this: under
    /// `--test-threads > 1` the interleaving decides which test draws which number, which is
    /// exactly what made the first CU measurements swing by ±6k.
    next_key: u64,
}

impl Env {
    /// Boots a LiteSVM instance with `agent_rails` deployed at its declared address.
    pub fn new() -> Self {
        Self {
            ctx: AnchorLiteSVM::build_with_program(agent_rails::ID, &program_bytes()),
            next_key: 0,
        }
    }

    /// The next deterministic 32-byte seed in this `Env`'s sequence.
    ///
    /// `domain` keeps the three kinds of value from ever colliding, so adding a keypair to
    /// a test cannot silently change a pubkey drawn later.
    fn next_seed(&mut self, domain: &str) -> [u8; 32] {
        let index = self.next_key;
        self.next_key = self.next_key.saturating_add(1);
        let mut preimage = Vec::with_capacity(domain.len() + 8);
        preimage.extend_from_slice(domain.as_bytes());
        preimage.extend_from_slice(&index.to_le_bytes());
        sha256(&preimage)
    }

    /// A funded keypair for use as a payer, owner, or operator.
    pub fn keypair(&mut self) -> Keypair {
        let keypair = Keypair::new_from_array(self.next_seed("keypair"));
        self.ctx
            .svm
            .airdrop(&keypair.pubkey(), DEFAULT_FUNDING_LAMPORTS)
            .expect("airdrop");
        keypair
    }

    /// An unfunded keypair — a session key, or a mint about to be created.
    pub fn unfunded_keypair(&mut self) -> Keypair {
        Keypair::new_from_array(self.next_seed("unfunded"))
    }

    /// A fresh address that needs no secret key: a destination wallet, an operator this
    /// test never signs as. Replaces `Pubkey::new_unique()`, which is process-global.
    pub fn unique_pubkey(&mut self) -> Pubkey {
        Pubkey::new_from_array(self.next_seed("pubkey"))
    }

    /// A fresh `intent_id`. Deterministic for the same reason as the keys: it seeds the
    /// `IntentReceipt` PDA, so a varying id varies the bump search and the CU count.
    pub fn next_intent_id(&mut self) -> [u8; INTENT_ID_LEN] {
        let seed = self.next_seed("intent");
        let mut id = [0u8; INTENT_ID_LEN];
        id.copy_from_slice(&seed[..INTENT_ID_LEN]);
        id
    }

    /// Moves `Clock::unix_timestamp` forward, for expiry and window-rollover tests.
    pub fn warp_seconds(&mut self, seconds: i64) {
        let mut clock = self.ctx.svm.get_sysvar::<anchor_lang::prelude::Clock>();
        clock.unix_timestamp = clock.unix_timestamp.saturating_add(seconds);
        self.ctx.svm.set_sysvar(&clock);
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

    /// Several instructions in one transaction (mint setup that must create + initialize).
    pub fn execute_many(
        &mut self,
        ixs: Vec<Instruction>,
        signers: &[&Keypair],
    ) -> TransactionResult {
        self.ctx.svm.expire_blockhash();
        self.ctx
            .execute_instructions(ixs, signers)
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
    /// The warm role. Held as a keypair so tests can exercise the operator path, not just
    /// the owner path, on every instruction that accepts either.
    pub operator_key: Keypair,
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
    let create_key = env.unfunded_keypair();
    let operator_key = env.keypair();
    let operator = operator_key.pubkey();
    let recovery_destination = env.unique_pubkey();

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
        operator_key,
        operator,
        recovery_destination,
        treasury,
        treasury_bump,
        sol_vault,
        sol_vault_bump,
    }
}

/// `create_treasury`, but `owner` is any pubkey rather than always `payer`'s own, and the
/// return type reflects that: `owner` here is not a `Keypair` because it may not have one
/// — a Squads or Realms vault PDA (ADR-002) has no private key at all. `create_treasury`
/// never requires `owner` to sign itself; only `payer` and `create_key` do.
pub struct PdaOwnedTreasuryFixture {
    pub create_key: Keypair,
    pub payer: Keypair,
    pub owner: Pubkey,
    pub operator_key: Keypair,
    pub operator: Pubkey,
    pub treasury: Pubkey,
    pub sol_vault: Pubkey,
}

pub fn create_treasury_with_owner(
    env: &mut Env,
    owner: Pubkey,
    allow_any_destination: bool,
    allow_create_destination_ata: bool,
) -> PdaOwnedTreasuryFixture {
    let payer = env.keypair();
    let create_key = env.unfunded_keypair();
    let operator_key = env.keypair();
    let operator = operator_key.pubkey();
    let recovery_destination = env.unique_pubkey();

    let (treasury, _) = Env::treasury_pda(&create_key.pubkey());
    let (sol_vault, _) = Env::sol_vault_pda(&treasury);

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
            owner,
            operator,
            recovery_destination,
            allow_any_destination,
            allow_create_destination_ata,
        })
        .instruction()
        .expect("build create_treasury instruction");

    env.execute(ix, &[&payer, &create_key]).assert_success();

    PdaOwnedTreasuryFixture {
        create_key,
        payer,
        owner,
        operator_key,
        operator,
        treasury,
        sol_vault,
    }
}

/// Builds an `add_mint` instruction, leaving execution to the caller so that negative tests
/// can vary the signer, the mint, or the token-program accounts.
///
/// `spl` is `Some((vault_ata, token_program))` for SPL / Token-2022 and `None` for native SOL.
pub fn add_mint_ix(
    env: &Env,
    treasury: &Pubkey,
    owner: &Pubkey,
    mint: Pubkey,
    ceiling: MintCeilingInput,
    spl: Option<(Pubkey, Pubkey)>,
) -> Instruction {
    let (vault_ata, token_program, associated_token_program) = match spl {
        Some((vault, program)) => (
            Some(vault),
            Some(program),
            Some(ASSOCIATED_TOKEN_PROGRAM_ID),
        ),
        None => (None, None, None),
    };
    env.ctx
        .program()
        .accounts(agent_rails::accounts::AddMint {
            owner: *owner,
            treasury: *treasury,
            mint,
            vault_ata,
            token_program,
            associated_token_program,
            system_program: anchor_lang::system_program::ID,
            event_authority: Env::event_authority(),
            program: agent_rails::ID,
        })
        .args(agent_rails::instruction::AddMint { ceiling })
        .instruction()
        .expect("build add_mint instruction")
}

/// Native SOL path: no vault ATA, no token program.
pub fn add_native_mint_ix(
    env: &Env,
    treasury: &Pubkey,
    owner: &Pubkey,
    ceiling: MintCeilingInput,
) -> Instruction {
    add_mint_ix(env, treasury, owner, NATIVE_MINT, ceiling, None)
}

/// SPL / Token-2022 path: vault ATA derived from `(treasury, mint, token_program)`.
pub fn add_spl_mint_ix(
    env: &Env,
    treasury: &Pubkey,
    owner: &Pubkey,
    mint: Pubkey,
    token_program: Pubkey,
    ceiling: MintCeilingInput,
) -> Instruction {
    let vault_ata = vault_ata(treasury, &mint, &token_program);
    add_mint_ix(
        env,
        treasury,
        owner,
        mint,
        ceiling,
        Some((vault_ata, token_program)),
    )
}

pub fn vault_ata(treasury: &Pubkey, mint: &Pubkey, token_program: &Pubkey) -> Pubkey {
    get_associated_token_address_with_program_id(treasury, mint, token_program)
}

/// Runs `add_mint` for the native SOL sentinel with the given ceiling.
pub fn add_native_mint(env: &mut Env, fixture: &TreasuryFixture, ceiling: MintCeilingInput) {
    let ix = add_native_mint_ix(env, &fixture.treasury, &fixture.owner.pubkey(), ceiling);
    let owner = fixture.owner.insecure_clone();
    env.execute(ix, &[&owner]).assert_success();
}

/// Runs `add_mint` for an SPL Token or Token-2022 mint, creating the vault ATA.
pub fn add_spl_mint(
    env: &mut Env,
    fixture: &TreasuryFixture,
    mint: Pubkey,
    token_program: Pubkey,
    ceiling: MintCeilingInput,
) {
    let ix = add_spl_mint_ix(
        env,
        &fixture.treasury,
        &fixture.owner.pubkey(),
        mint,
        token_program,
        ceiling,
    );
    let owner = fixture.owner.insecure_clone();
    env.execute(ix, &[&owner]).assert_success();
}

/// Classic SPL Token mint (82 bytes, no extensions).
///
/// The mint keypair comes from `Env`'s deterministic sequence rather than
/// `LiteSVM::create_token_mint`, which generates a random one. The mint address feeds both
/// vault and destination ATA derivations, so a random mint means a random number of
/// `find_program_address` iterations and an unstable CU count.
pub fn create_spl_token_mint(env: &mut Env, authority: &Keypair, decimals: u8) -> Pubkey {
    let mint = env.unfunded_keypair();
    let rent = env.ctx.svm.minimum_balance_for_rent_exemption(82);
    let ixs = vec![
        anchor_lang::solana_program::system_instruction::create_account(
            &authority.pubkey(),
            &mint.pubkey(),
            rent,
            82,
            &TOKEN_PROGRAM_ID,
        ),
        token_2022_ix::initialize_mint2(
            &TOKEN_PROGRAM_ID,
            &mint.pubkey(),
            &authority.pubkey(),
            None,
            decimals,
        )
        .expect("initialize_mint2"),
    ];
    env.execute_many(ixs, &[authority, &mint]).assert_success();
    mint.pubkey()
}

/// Token-2022 mint with the given extensions initialized *before* `InitializeMint2`.
pub fn create_token_2022_mint(
    env: &mut Env,
    payer: &Keypair,
    decimals: u8,
    extensions: &[ExtensionType],
    extension_ixs: Vec<Instruction>,
) -> Pubkey {
    let mint = env.unfunded_keypair();
    let space = ExtensionType::try_calculate_account_len::<Token2022Mint>(extensions)
        .expect("mint account length");
    let rent = env.ctx.svm.minimum_balance_for_rent_exemption(space);

    let mut ixs = Vec::with_capacity(extension_ixs.len() + 2);
    ixs.push(
        anchor_lang::solana_program::system_instruction::create_account(
            &payer.pubkey(),
            &mint.pubkey(),
            rent,
            space as u64,
            &TOKEN_2022_PROGRAM_ID,
        ),
    );
    ixs.extend(extension_ixs);
    ixs.push(
        token_2022_ix::initialize_mint2(
            &TOKEN_2022_PROGRAM_ID,
            &mint.pubkey(),
            &payer.pubkey(),
            None,
            decimals,
        )
        .expect("initialize_mint2"),
    );

    env.execute_many(ixs, &[payer, &mint]).assert_success();
    mint.pubkey()
}

pub fn token_program_id() -> Pubkey {
    TOKEN_PROGRAM_ID
}

pub fn token_2022_program_id() -> Pubkey {
    TOKEN_2022_PROGRAM_ID
}

pub fn create_token_2022_plain(env: &mut Env, payer: &Keypair, decimals: u8) -> Pubkey {
    create_token_2022_mint(env, payer, decimals, &[], vec![])
}

pub fn create_token_2022_with_transfer_hook(env: &mut Env, payer: &Keypair) -> Pubkey {
    let mint = env.unfunded_keypair();
    let ix = transfer_hook_ix::initialize(
        &TOKEN_2022_PROGRAM_ID,
        &mint.pubkey(),
        Some(payer.pubkey()),
        Some(Pubkey::new_unique()),
    )
    .expect("init transfer hook");
    create_token_2022_mint_at(
        env,
        payer,
        6,
        &[ExtensionType::TransferHook],
        vec![ix],
        mint,
    )
}

pub fn create_token_2022_with_non_transferable(env: &mut Env, payer: &Keypair) -> Pubkey {
    let mint = env.unfunded_keypair();
    let ix =
        token_2022_ix::initialize_non_transferable_mint(&TOKEN_2022_PROGRAM_ID, &mint.pubkey())
            .expect("init non-transferable");
    create_token_2022_mint_at(
        env,
        payer,
        6,
        &[ExtensionType::NonTransferable],
        vec![ix],
        mint,
    )
}

pub fn create_token_2022_with_transfer_fee(env: &mut Env, payer: &Keypair) -> Pubkey {
    let mint = env.unfunded_keypair();
    let ix = transfer_fee_ix::initialize_transfer_fee_config(
        &TOKEN_2022_PROGRAM_ID,
        &mint.pubkey(),
        Some(&payer.pubkey()),
        Some(&payer.pubkey()),
        100, // 1%
        1_000_000,
    )
    .expect("init transfer fee");
    create_token_2022_mint_at(
        env,
        payer,
        6,
        &[ExtensionType::TransferFeeConfig],
        vec![ix],
        mint,
    )
}

pub fn create_token_2022_with_permanent_delegate(env: &mut Env, payer: &Keypair) -> Pubkey {
    let mint = env.unfunded_keypair();
    let ix = token_2022_ix::initialize_permanent_delegate(
        &TOKEN_2022_PROGRAM_ID,
        &mint.pubkey(),
        &payer.pubkey(),
    )
    .expect("init permanent delegate");
    create_token_2022_mint_at(
        env,
        payer,
        6,
        &[ExtensionType::PermanentDelegate],
        vec![ix],
        mint,
    )
}

fn create_token_2022_mint_at(
    env: &mut Env,
    payer: &Keypair,
    decimals: u8,
    extensions: &[ExtensionType],
    extension_ixs: Vec<Instruction>,
    mint: Keypair,
) -> Pubkey {
    let space = ExtensionType::try_calculate_account_len::<Token2022Mint>(extensions)
        .expect("mint account length");
    let rent = env.ctx.svm.minimum_balance_for_rent_exemption(space);
    let mint_pk = mint.pubkey();

    let mut ixs = Vec::with_capacity(extension_ixs.len() + 2);
    ixs.push(
        anchor_lang::solana_program::system_instruction::create_account(
            &payer.pubkey(),
            &mint_pk,
            rent,
            space as u64,
            &TOKEN_2022_PROGRAM_ID,
        ),
    );
    ixs.extend(extension_ixs);
    ixs.push(
        token_2022_ix::initialize_mint2(
            &TOKEN_2022_PROGRAM_ID,
            &mint_pk,
            &payer.pubkey(),
            None,
            decimals,
        )
        .expect("initialize_mint2"),
    );

    env.execute_many(ixs, &[payer, &mint]).assert_success();
    mint_pk
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
pub fn permissive_ceiling() -> MintCeilingInput {
    MintCeilingInput {
        max_per_tx: 10_000_000_000,
        max_short_window: 50_000_000_000,
        max_long_window: 200_000_000_000,
        max_lifetime: 1_000_000_000_000,
        min_short_window_seconds: 3_600,
        min_long_window_seconds: 86_400,
    }
}

// ---------------------------------------------------------------------------------------
// Payment fixtures
// ---------------------------------------------------------------------------------------
//
// `create_policy`, `create_session`, and `add_allowlist_entry` do not exist yet, so the
// payment tests write those three accounts straight into the SVM. This is not a shortcut
// around validation: `execute_payment` re-derives every one of these PDAs from its own
// seeds and re-checks `Policy ≤ Ceiling` at runtime (spec §5.3 step 9), so a seeded account
// is exactly as trusted as an instruction-created one. It also buys something an
// instruction cannot: a session parked one lamport under a window cap, without executing
// the payments that would put it there.
//
// When the operator instructions land, these helpers become thin wrappers over them and the
// tests do not change.

use agent_rails::constants::{
    AuthMode, INTENT_ID_LEN, MAX_NAME_LEN, PROGRAM_VERSION, SEED_ALLOWLIST, SEED_POLICY,
    SEED_RECEIPT, SEED_SESSION,
};
use agent_rails::state::{
    AgentSession, AllowlistEntry, IntentReceipt, MintLimit, Policy, SpendCounter,
};
use agent_rails::PaymentIntent;
use anchor_lang::{AnchorSerialize, Discriminator};
use solana_account::Account as SvmAccount;

/// Serializes an Anchor account and installs it at `address`, rent-exempt and owned by the
/// program. The discriminator comes from the real type, so a decoder that rejects this data
/// would reject the instruction-written version too.
fn set_anchor_account<T: AnchorSerialize + Discriminator>(
    env: &mut Env,
    address: &Pubkey,
    value: &T,
    len: usize,
) {
    let mut data = Vec::with_capacity(len);
    data.extend_from_slice(T::DISCRIMINATOR);
    value.serialize(&mut data).expect("serialize account");
    data.resize(len, 0);
    assert_eq!(
        data.len(),
        len,
        "serialized {address} does not match its LEN"
    );

    let lamports = env.ctx.svm.minimum_balance_for_rent_exemption(len);
    env.ctx
        .svm
        .set_account(
            *address,
            SvmAccount {
                lamports,
                data,
                owner: agent_rails::ID,
                executable: false,
                rent_epoch: 0,
            },
        )
        .expect("set account");
}

pub fn policy_pda(treasury: &Pubkey, name: &[u8; MAX_NAME_LEN]) -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[SEED_POLICY, treasury.as_ref(), name.as_ref()],
        &agent_rails::ID,
    )
}

pub fn session_pda(treasury: &Pubkey, session_key: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[SEED_SESSION, treasury.as_ref(), session_key.as_ref()],
        &agent_rails::ID,
    )
}

pub fn allowlist_pda(policy: &Pubkey, destination_owner: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[SEED_ALLOWLIST, policy.as_ref(), destination_owner.as_ref()],
        &agent_rails::ID,
    )
}

pub fn receipt_pda(session: &Pubkey, intent_id: &[u8; INTENT_ID_LEN]) -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[SEED_RECEIPT, session.as_ref(), intent_id.as_ref()],
        &agent_rails::ID,
    )
}

/// 32-byte zero-padded UTF-8, the encoding every name and label uses.
pub fn padded_name(name: &str) -> [u8; MAX_NAME_LEN] {
    let mut out = [0u8; MAX_NAME_LEN];
    let bytes = name.as_bytes();
    assert!(bytes.len() <= MAX_NAME_LEN, "name too long");
    out[..bytes.len()].copy_from_slice(bytes);
    out
}

/// A limit that fits comfortably inside [`permissive_ceiling`], for tests whose subject is
/// not the limit itself.
pub fn permissive_limit(mint: Pubkey) -> MintLimit {
    MintLimit {
        mint,
        per_tx_max: 1_000_000_000,
        short_window_max: 5_000_000_000,
        short_window_seconds: 3_600,
        long_window_max: 20_000_000_000,
        long_window_seconds: 86_400,
        lifetime_max: 100_000_000_000,
        ..MintLimit::EMPTY
    }
}

/// How a seeded policy constrains destinations. Mirrors `DestinationMode` plus the two
/// booleans a payment test usually wants to vary alongside it.
pub struct PolicySpec {
    pub name: [u8; MAX_NAME_LEN],
    pub limits: Vec<MintLimit>,
    pub destination_mode: u8,
    pub require_memo: bool,
    pub create_destination_ata: bool,
}

impl PolicySpec {
    /// `DestinationMode::Any`, no memo requirement, no ATA creation.
    pub fn open(limits: Vec<MintLimit>) -> Self {
        Self {
            name: padded_name("default"),
            limits,
            destination_mode: 0,
            require_memo: false,
            create_destination_ata: false,
        }
    }

    pub fn allowlist(mut self) -> Self {
        self.destination_mode = 1;
        self
    }

    pub fn require_memo(mut self) -> Self {
        self.require_memo = true;
        self
    }

    pub fn create_destination_ata(mut self) -> Self {
        self.create_destination_ata = true;
        self
    }
}

/// Writes a `Policy` at its canonical PDA and returns the address.
pub fn seed_policy(env: &mut Env, treasury: &Pubkey, spec: &PolicySpec) -> Pubkey {
    let (address, bump) = policy_pda(treasury, &spec.name);
    let mut mint_limits = [MintLimit::EMPTY; agent_rails::constants::MAX_MINTS];
    for (slot, limit) in mint_limits.iter_mut().zip(spec.limits.iter()) {
        *slot = *limit;
    }

    let policy = Policy {
        version: PROGRAM_VERSION,
        bump,
        treasury: *treasury,
        name: spec.name,
        mint_limits,
        mint_count: spec.limits.len() as u8,
        destination_mode: spec.destination_mode,
        require_memo: spec.require_memo,
        create_destination_ata: spec.create_destination_ata,
        active_sessions: 1,
        created_at: env.now(),
        updated_at: env.now(),
        reserved: [0u8; 64],
    };
    set_anchor_account(env, &address, &policy, Policy::LEN);
    address
}

/// The keys and addresses a payment test needs after [`seed_session`].
pub struct SessionFixture {
    pub session_key: Keypair,
    pub session: Pubkey,
    pub policy: Pubkey,
    pub genesis_head: [u8; 32],
}

/// Writes an `AgentSession` at its canonical PDA with the genesis audit head the real
/// `create_session` would compute, counters zeroed and index-aligned with the policy.
pub fn seed_session(
    env: &mut Env,
    treasury: &Pubkey,
    policy: &Pubkey,
    limits: &[MintLimit],
) -> SessionFixture {
    seed_session_with(env, treasury, policy, limits, |_| {})
}

/// [`seed_session`] with an escape hatch for tests that need a revoked, expired, or
/// already-spent session.
pub fn seed_session_with(
    env: &mut Env,
    treasury: &Pubkey,
    policy: &Pubkey,
    limits: &[MintLimit],
    adjust: impl FnOnce(&mut AgentSession),
) -> SessionFixture {
    let session_key = env.unfunded_keypair();
    let (session, bump) = session_pda(treasury, &session_key.pubkey());
    let genesis_head = agent_rails_policy::genesis_audit_head(&session.to_bytes());

    let mut spend = [SpendCounter::EMPTY; agent_rails::constants::MAX_MINTS];
    for (slot, limit) in spend.iter_mut().zip(limits.iter()) {
        slot.mint = limit.mint;
    }

    let now = env.now();
    let mut account = AgentSession {
        version: PROGRAM_VERSION,
        bump,
        treasury: *treasury,
        policy: *policy,
        session_key: session_key.pubkey(),
        auth_mode: AuthMode::DIRECT_SIGNER,
        label: padded_name("test-agent"),
        created_at: now,
        expires_at: now + 86_400,
        revoked: false,
        revoked_at: 0,
        seq: 0,
        audit_head: genesis_head,
        spend,
        reserved: [0u8; 64],
    };
    adjust(&mut account);

    set_anchor_account(env, &session, &account, AgentSession::LEN);
    SessionFixture {
        session_key,
        session,
        policy: *policy,
        genesis_head,
    }
}

/// Writes an `AllowlistEntry` at `["allow", policy, destination_owner]`.
pub fn seed_allowlist_entry(
    env: &mut Env,
    policy: &Pubkey,
    destination_owner: &Pubkey,
    per_tx_max_override: u64,
) -> Pubkey {
    let (address, bump) = allowlist_pda(policy, destination_owner);
    let entry = AllowlistEntry {
        version: PROGRAM_VERSION,
        bump,
        policy: *policy,
        destination_owner: *destination_owner,
        label: padded_name("vendor"),
        per_tx_max_override,
        added_at: env.now(),
        added_by: Pubkey::new_unique(),
        reserved: [0u8; 32],
    };
    set_anchor_account(env, &address, &entry, AllowlistEntry::LEN);
    address
}

pub fn session_account(env: &Env, address: &Pubkey) -> AgentSession {
    env.ctx.get_account(address).expect("decode AgentSession")
}

pub fn receipt_account(env: &Env, address: &Pubkey) -> IntentReceipt {
    env.ctx.get_account(address).expect("decode IntentReceipt")
}

/// A well-formed intent expiring in the middle of the allowed TTL band.
///
/// Takes `&mut Env` because the `intent_id` comes from the deterministic sequence: it seeds
/// the `IntentReceipt` PDA, so drawing it from a process-global counter would make the
/// receipt's bump search — and the instruction's CU count — depend on test scheduling.
pub fn intent(
    env: &mut Env,
    mint: Pubkey,
    destination_owner: Pubkey,
    amount: u64,
) -> PaymentIntent {
    let expires_at = env.now() + 300;
    PaymentIntent {
        intent_id: env.next_intent_id(),
        mint,
        destination_owner,
        amount,
        expires_at,
        memo: Vec::new(),
    }
}

/// Builds `execute_payment`. `allowlist_entry` is `None` in `DestinationMode::Any`.
pub fn execute_payment_ix(
    env: &Env,
    fixture: &TreasuryFixture,
    session: &SessionFixture,
    fee_payer: &Pubkey,
    token_program: Pubkey,
    allowlist_entry: Option<Pubkey>,
    intent: &PaymentIntent,
) -> Instruction {
    let destination_ata = get_associated_token_address_with_program_id(
        &intent.destination_owner,
        &intent.mint,
        &token_program,
    );
    env.ctx
        .program()
        .accounts(agent_rails::accounts::ExecutePayment {
            fee_payer: *fee_payer,
            session_key: session.session_key.pubkey(),
            treasury: fixture.treasury,
            policy: session.policy,
            session: session.session,
            allowlist_entry,
            mint: intent.mint,
            vault_ata: vault_ata(&fixture.treasury, &intent.mint, &token_program),
            destination_owner: intent.destination_owner,
            destination_ata,
            receipt: receipt_pda(&session.session, &intent.intent_id).0,
            token_program,
            associated_token_program: ASSOCIATED_TOKEN_PROGRAM_ID,
            system_program: anchor_lang::system_program::ID,
            event_authority: Env::event_authority(),
            program: agent_rails::ID,
            // NativeAllowance funding mode (ADR-014); unused by every fixture, which is
            // always IsolatedVault.
            owner_source_ata: None,
            native_delegation: None,
            native_subscription_authority: None,
            native_event_authority: None,
            native_subscriptions_program: None,
        })
        .args(agent_rails::instruction::ExecutePayment {
            intent: intent.clone(),
        })
        .instruction()
        .expect("build execute_payment instruction")
}

// ---------------------------------------------------------------------------------------
// NativeAllowance funding mode (ADR-014)
// ---------------------------------------------------------------------------------------

/// Loads the real, devnet-dumped Subscriptions & Allowances program
/// (`De1egAFMkMWZSN5rYXRj9CAdheBamobVNubTsi9avR44`) into this `Env`'s LiteSVM instance, so
/// `NativeAllowance`-mode tests CPI into the actual deployed program rather than a stub.
///
/// Not loaded by `Env::new()`: almost no test touches this path, and loading an extra
/// ~130KB program into every LiteSVM instance would be pure overhead for the rest.
/// Re-dump with `solana program dump De1egAFMkMWZSN5rYXRj9CAdheBamobVNubTsi9avR44
/// tests/fixtures/subscriptions_devnet.so --url https://api.devnet.solana.com` if the
/// native program upgrades.
pub fn load_native_subscriptions_program(env: &mut Env) {
    let path = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/tests/fixtures/subscriptions_devnet.so"
    );
    env.ctx
        .svm
        .add_program_from_file(agent_rails::constants::NATIVE_SUBSCRIPTIONS_PROGRAM, path)
        .expect("load native subscriptions program fixture");
}

/// The native-program PDAs one `NativeAllowance` mint needs, derived exactly the way
/// `enable_native_allowance` and `execute_payment` re-derive and check them.
pub struct NativeAllowanceAccounts {
    pub subscription_authority: Pubkey,
    pub native_delegation: Pubkey,
    pub event_authority: Pubkey,
}

pub fn native_allowance_accounts(
    owner: &Pubkey,
    mint: &Pubkey,
    treasury: &Pubkey,
) -> NativeAllowanceAccounts {
    let (subscription_authority, _) =
        agent_rails::native_allowance::find_subscription_authority(owner, mint);
    let (native_delegation, _) = agent_rails::native_allowance::find_fixed_delegation(
        &subscription_authority,
        owner,
        treasury,
    );
    let (event_authority, _) = agent_rails::native_allowance::find_event_authority();
    NativeAllowanceAccounts {
        subscription_authority,
        native_delegation,
        event_authority,
    }
}

/// Builds `enable_native_allowance`. `owner_ata` must already exist (the real instruction
/// never creates it — see the instruction's doc comment).
///
/// Takes `treasury` and `owner` as plain values rather than a `&TreasuryFixture` — a
/// `TreasuryFixture.owner` is a `Keypair`, which a program-derived owner (Squads/Realms
/// vault PDA, `tests/pda_owner.rs`) does not have. The PDAs are derived from the `owner`
/// argument directly, so a negative test can also pass a stranger's pubkey here (the same
/// pattern every other `_is_owner_only` test in this suite uses) and hit `has_one = owner`
/// on-chain rather than a client-side signature-building failure.
#[allow(clippy::too_many_arguments)]
pub fn enable_native_allowance_ix(
    env: &Env,
    treasury: Pubkey,
    owner: Pubkey,
    mint: Pubkey,
    owner_ata: Pubkey,
    token_program: Pubkey,
    amount_cap: u64,
    expiry_ts: i64,
) -> Instruction {
    let native = native_allowance_accounts(&owner, &mint, &treasury);
    env.ctx
        .program()
        .accounts(agent_rails::accounts::EnableNativeAllowance {
            owner,
            treasury,
            mint,
            owner_ata,
            subscription_authority: native.subscription_authority,
            native_delegation: native.native_delegation,
            token_program,
            system_program: anchor_lang::system_program::ID,
            native_subscriptions_program: agent_rails::constants::NATIVE_SUBSCRIPTIONS_PROGRAM,
            event_authority: Env::event_authority(),
            program: agent_rails::ID,
        })
        .args(agent_rails::instruction::EnableNativeAllowance {
            amount_cap,
            expiry_ts,
        })
        .instruction()
        .expect("build enable_native_allowance instruction")
}

/// Runs `enable_native_allowance` for a wallet-owned treasury, owner-signed. Not usable for
/// a `PdaOwnedTreasuryFixture` — build and relay the instruction directly instead (see
/// `tests/pda_owner.rs`).
pub fn enable_native_allowance(
    env: &mut Env,
    fixture: &TreasuryFixture,
    mint: Pubkey,
    owner_ata: Pubkey,
    token_program: Pubkey,
    amount_cap: u64,
    expiry_ts: i64,
) {
    let ix = enable_native_allowance_ix(
        env,
        fixture.treasury,
        fixture.owner.pubkey(),
        mint,
        owner_ata,
        token_program,
        amount_cap,
        expiry_ts,
    );
    let owner = fixture.owner.insecure_clone();
    env.execute(ix, &[&owner]).assert_success();
}

/// `execute_payment` with the five `NativeAllowance` accounts populated, mirroring
/// `execute_payment_ix` (vault mode) but pulling from `owner_ata` via the native program
/// instead of `vault_ata`. Takes `treasury` and `owner` as plain values for the same reason
/// as `enable_native_allowance_ix`.
#[allow(clippy::too_many_arguments)]
pub fn execute_payment_native_allowance_ix(
    env: &Env,
    treasury: Pubkey,
    owner: Pubkey,
    session: &SessionFixture,
    fee_payer: &Pubkey,
    token_program: Pubkey,
    owner_ata: Pubkey,
    allowlist_entry: Option<Pubkey>,
    intent: &PaymentIntent,
) -> Instruction {
    let destination_ata = get_associated_token_address_with_program_id(
        &intent.destination_owner,
        &intent.mint,
        &token_program,
    );
    let native = native_allowance_accounts(&owner, &intent.mint, &treasury);
    env.ctx
        .program()
        .accounts(agent_rails::accounts::ExecutePayment {
            fee_payer: *fee_payer,
            session_key: session.session_key.pubkey(),
            treasury,
            policy: session.policy,
            session: session.session,
            allowlist_entry,
            mint: intent.mint,
            vault_ata: vault_ata(&treasury, &intent.mint, &token_program),
            destination_owner: intent.destination_owner,
            destination_ata,
            receipt: receipt_pda(&session.session, &intent.intent_id).0,
            token_program,
            associated_token_program: ASSOCIATED_TOKEN_PROGRAM_ID,
            system_program: anchor_lang::system_program::ID,
            event_authority: Env::event_authority(),
            program: agent_rails::ID,
            owner_source_ata: Some(owner_ata),
            native_delegation: Some(native.native_delegation),
            native_subscription_authority: Some(native.subscription_authority),
            native_event_authority: Some(native.event_authority),
            native_subscriptions_program: Some(
                agent_rails::constants::NATIVE_SUBSCRIPTIONS_PROGRAM,
            ),
        })
        .args(agent_rails::instruction::ExecutePayment {
            intent: intent.clone(),
        })
        .instruction()
        .expect("build execute_payment (NativeAllowance) instruction")
}

// ---------------------------------------------------------------------------------------
// PDA-as-owner verification fixture (ADR-014 "Squads/Realms owner" open item)
// ---------------------------------------------------------------------------------------

/// Loads `test_pda_relay.so` (see its own module doc) at a fresh deterministic address,
/// funds its PDA with enough lamports to act as a real owner (it pays rent for whatever it
/// creates, same as a real wallet owner would), and returns `(relay_program_id, relay_pda,
/// relay_bump)`.
pub fn load_pda_relay_program(env: &mut Env) -> (Pubkey, Pubkey, u8) {
    let program_id = env.unique_pubkey();
    let bytes = deploy_so_bytes(
        "test_pda_relay.so",
        "cargo build-sbf --manifest-path programs/test_pda_relay/Cargo.toml",
    );
    env.ctx
        .svm
        .add_program(program_id, &bytes)
        .expect("load test_pda_relay fixture");
    let (pda, bump) = Pubkey::find_program_address(&[b"owner"], &program_id);
    env.ctx
        .svm
        .airdrop(&pda, DEFAULT_FUNDING_LAMPORTS)
        .expect("airdrop pda owner");
    (program_id, pda, bump)
}

/// Wraps `inner` — any instruction whose account at index 0 is an `owner: Signer` slot,
/// which is every owner-gated instruction in this program — so it runs via
/// `test_pda_relay`'s CPI instead of a direct wallet signature. Proves `owner` can be a
/// program-owned PDA (the Squads/Realms vault-PDA pattern, ADR-002), not just a wallet.
pub fn relay_owner_ix(relay_program_id: Pubkey, relay_bump: u8, inner: Instruction) -> Instruction {
    let mut data = Vec::with_capacity(1 + 32 + inner.data.len());
    data.push(relay_bump);
    data.extend_from_slice(&inner.program_id.to_bytes());
    data.extend_from_slice(&inner.data);

    // The outer account list mirrors the inner instruction's exactly, except index 0 (the
    // owner/PDA slot) cannot claim `is_signer` at the top level — only the relay's own
    // `invoke_signed` can grant that, once it runs.
    let mut accounts = inner.accounts;
    accounts[0].is_signer = false;

    Instruction {
        program_id: relay_program_id,
        accounts,
        data,
    }
}

/// Builds `execute_payment_sol`.
pub fn execute_payment_sol_ix(
    env: &Env,
    fixture: &TreasuryFixture,
    session: &SessionFixture,
    fee_payer: &Pubkey,
    allowlist_entry: Option<Pubkey>,
    intent: &PaymentIntent,
) -> Instruction {
    env.ctx
        .program()
        .accounts(agent_rails::accounts::ExecutePaymentSol {
            fee_payer: *fee_payer,
            session_key: session.session_key.pubkey(),
            treasury: fixture.treasury,
            policy: session.policy,
            session: session.session,
            allowlist_entry,
            sol_vault: fixture.sol_vault,
            destination_owner: intent.destination_owner,
            receipt: receipt_pda(&session.session, &intent.intent_id).0,
            system_program: anchor_lang::system_program::ID,
            event_authority: Env::event_authority(),
            program: agent_rails::ID,
        })
        .args(agent_rails::instruction::ExecutePaymentSol {
            intent: intent.clone(),
        })
        .instruction()
        .expect("build execute_payment_sol instruction")
}

/// Mints `amount` into the treasury's vault ATA for `mint`.
pub fn fund_vault(
    env: &mut Env,
    treasury: &Pubkey,
    mint: &Pubkey,
    mint_authority: &Keypair,
    token_program: Pubkey,
    amount: u64,
) {
    let vault = vault_ata(treasury, mint, &token_program);
    let ix = spl_token_2022_mint_to(
        &token_program,
        mint,
        &vault,
        &mint_authority.pubkey(),
        amount,
    );
    env.execute(ix, &[mint_authority]).assert_success();
}

/// Creates `owner`'s ATA for `mint` so a payment test can choose whether the destination
/// account already exists.
pub fn create_destination_ata(
    env: &mut Env,
    payer: &Keypair,
    owner: &Pubkey,
    mint: &Pubkey,
    token_program: Pubkey,
) -> Pubkey {
    let ata = get_associated_token_address_with_program_id(owner, mint, &token_program);
    let ix = spl_associated_token_account::instruction::create_associated_token_account_idempotent(
        &payer.pubkey(),
        owner,
        mint,
        &token_program,
    );
    env.execute(ix, &[payer]).assert_success();
    ata
}

/// `mint_to` against whichever token program owns the mint.
pub fn spl_token_2022_mint_to(
    token_program: &Pubkey,
    mint: &Pubkey,
    destination: &Pubkey,
    authority: &Pubkey,
    amount: u64,
) -> Instruction {
    token_2022_ix::mint_to(token_program, mint, destination, authority, &[], amount)
        .expect("mint_to instruction")
}

pub fn token_balance(env: &Env, token_account: &Pubkey) -> u64 {
    use anchor_spl::token_2022::spl_token_2022::extension::StateWithExtensions;
    use anchor_spl::token_2022::spl_token_2022::state::Account as TokenAccountState;

    let data = env.account_data(token_account);
    StateWithExtensions::<TokenAccountState>::unpack(&data)
        .expect("unpack token account")
        .base
        .amount
}

/// Flips `Treasury.paused` in place without going through `pause()`. Prefer the real
/// instruction unless the test needs a paused treasury without a guardian or owner
/// signature (the byte offset is the one `tests/layout.rs` pins, spec §3.1).
pub fn force_pause(env: &mut Env, treasury: &Pubkey) {
    const PAUSED_OFFSET: usize = 268;
    let mut account = env.ctx.svm.get_account(treasury).expect("treasury account");
    account.data[PAUSED_OFFSET] = 1;
    env.ctx
        .svm
        .set_account(*treasury, account)
        .expect("set treasury");
}

/// Decodes the single `emit_cpi!` event of type `T` from a transaction.
///
/// `TransactionResult::parse_events` cannot see these: it scans `Program data:` logs, which
/// is where `emit!` writes. `emit_cpi!` instead self-CPIs with the event as instruction
/// data — that is the entire point of using it (spec §8), since inner-instruction data
/// survives log truncation — so the event has to be read out of the inner instructions.
pub fn emitted_event<T: anchor_lang::AnchorDeserialize + anchor_lang::Discriminator>(
    result: &TransactionResult,
) -> T {
    let tag = anchor_lang::event::EVENT_IX_TAG_LE;
    let prefix_len = tag.len() + T::DISCRIMINATOR.len();

    result
        .inner()
        .inner_instructions
        .iter()
        .flatten()
        .filter_map(|inner| {
            let data = &inner.instruction.data;
            if data.len() < prefix_len
                || &data[..tag.len()] != tag
                || &data[tag.len()..prefix_len] != T::DISCRIMINATOR
            {
                return None;
            }
            Some(T::try_from_slice(&data[prefix_len..]).expect("deserialize event"))
        })
        .next()
        .unwrap_or_else(|| {
            panic!(
                "no {} event was emitted.\nLogs:\n{}",
                std::any::type_name::<T>(),
                result.logs().join("\n")
            )
        })
}

/// Software SHA-256, for cross-checking what the program produced with the `sol_sha256`
/// syscall.
pub fn sha256(bytes: &[u8]) -> [u8; 32] {
    use sha2::{Digest, Sha256};
    Sha256::digest(bytes).into()
}

// ---------------------------------------------------------------------------------------
// Operator instructions (spec §5.2)
// ---------------------------------------------------------------------------------------

use agent_rails::args::{MintLimitInput, PolicyInput};

/// `MintLimitInput` matching [`permissive_limit`], so a test can build a policy through the
/// real instruction and still get limits that fit inside [`permissive_ceiling`].
pub fn permissive_limit_args(mint: Pubkey) -> MintLimitInput {
    let limit = permissive_limit(mint);
    MintLimitInput {
        mint,
        per_tx_max: limit.per_tx_max,
        short_window_max: limit.short_window_max,
        short_window_seconds: limit.short_window_seconds,
        long_window_max: limit.long_window_max,
        long_window_seconds: limit.long_window_seconds,
        lifetime_max: limit.lifetime_max,
    }
}

/// `PolicyInput` with one permissive limit and `DestinationMode::Any`.
pub fn permissive_policy_args(mint: Pubkey) -> PolicyInput {
    PolicyInput {
        mint_limits: vec![permissive_limit_args(mint)],
        destination_mode: 0,
        require_memo: false,
        create_destination_ata: false,
    }
}

pub fn create_policy_ix(
    env: &Env,
    treasury: &Pubkey,
    operator: &Pubkey,
    name: [u8; MAX_NAME_LEN],
    args: PolicyInput,
) -> Instruction {
    env.ctx
        .program()
        .accounts(agent_rails::accounts::CreatePolicy {
            operator: *operator,
            treasury: *treasury,
            policy: policy_pda(treasury, &name).0,
            system_program: anchor_lang::system_program::ID,
            event_authority: Env::event_authority(),
            program: agent_rails::ID,
        })
        .args(agent_rails::instruction::CreatePolicy { name, args })
        .instruction()
        .expect("build create_policy instruction")
}

/// Runs `create_policy` as the treasury owner and returns the policy address.
pub fn create_policy(
    env: &mut Env,
    fixture: &TreasuryFixture,
    name: [u8; MAX_NAME_LEN],
    args: PolicyInput,
) -> Pubkey {
    let ix = create_policy_ix(env, &fixture.treasury, &fixture.owner.pubkey(), name, args);
    let owner = fixture.owner.insecure_clone();
    env.execute(ix, &[&owner]).assert_success();
    policy_pda(&fixture.treasury, &name).0
}

pub fn close_policy_ix(
    env: &Env,
    treasury: &Pubkey,
    operator: &Pubkey,
    policy: &Pubkey,
    rent_destination: &Pubkey,
) -> Instruction {
    env.ctx
        .program()
        .accounts(agent_rails::accounts::ClosePolicy {
            operator: *operator,
            treasury: *treasury,
            policy: *policy,
            rent_destination: *rent_destination,
            event_authority: Env::event_authority(),
            program: agent_rails::ID,
        })
        .args(agent_rails::instruction::ClosePolicy {})
        .instruction()
        .expect("build close_policy instruction")
}

pub fn add_allowlist_entry_ix(
    env: &Env,
    treasury: &Pubkey,
    operator: &Pubkey,
    policy: &Pubkey,
    destination_owner: Pubkey,
    label: [u8; MAX_NAME_LEN],
    per_tx_max_override: u64,
) -> Instruction {
    env.ctx
        .program()
        .accounts(agent_rails::accounts::AddAllowlistEntry {
            operator: *operator,
            treasury: *treasury,
            policy: *policy,
            entry: allowlist_pda(policy, &destination_owner).0,
            system_program: anchor_lang::system_program::ID,
            event_authority: Env::event_authority(),
            program: agent_rails::ID,
        })
        .args(agent_rails::instruction::AddAllowlistEntry {
            destination_owner,
            label,
            per_tx_max_override,
        })
        .instruction()
        .expect("build add_allowlist_entry instruction")
}

/// Runs `add_allowlist_entry` as the owner and returns the entry address.
pub fn add_allowlist_entry(
    env: &mut Env,
    fixture: &TreasuryFixture,
    policy: &Pubkey,
    destination_owner: Pubkey,
    per_tx_max_override: u64,
) -> Pubkey {
    let ix = add_allowlist_entry_ix(
        env,
        &fixture.treasury,
        &fixture.owner.pubkey(),
        policy,
        destination_owner,
        padded_name("vendor"),
        per_tx_max_override,
    );
    let owner = fixture.owner.insecure_clone();
    env.execute(ix, &[&owner]).assert_success();
    allowlist_pda(policy, &destination_owner).0
}

pub fn remove_allowlist_entry_ix(
    env: &Env,
    treasury: &Pubkey,
    operator: &Pubkey,
    policy: &Pubkey,
    destination_owner: &Pubkey,
    rent_destination: &Pubkey,
) -> Instruction {
    env.ctx
        .program()
        .accounts(agent_rails::accounts::RemoveAllowlistEntry {
            operator: *operator,
            treasury: *treasury,
            policy: *policy,
            entry: allowlist_pda(policy, destination_owner).0,
            rent_destination: *rent_destination,
            event_authority: Env::event_authority(),
            program: agent_rails::ID,
        })
        .args(agent_rails::instruction::RemoveAllowlistEntry {})
        .instruction()
        .expect("build remove_allowlist_entry instruction")
}

/// The four `create_session` arguments, grouped so negative tests can vary one at a time.
pub struct SessionSpec {
    pub session_key: Pubkey,
    pub label: [u8; MAX_NAME_LEN],
    pub expires_at: i64,
    pub auth_mode: u8,
}

pub fn create_session_ix(
    env: &Env,
    treasury: &Pubkey,
    operator: &Pubkey,
    policy: &Pubkey,
    spec: SessionSpec,
) -> Instruction {
    let SessionSpec {
        session_key,
        label,
        expires_at,
        auth_mode,
    } = spec;
    env.ctx
        .program()
        .accounts(agent_rails::accounts::CreateSession {
            operator: *operator,
            treasury: *treasury,
            policy: *policy,
            session: session_pda(treasury, &session_key).0,
            system_program: anchor_lang::system_program::ID,
            event_authority: Env::event_authority(),
            program: agent_rails::ID,
        })
        .args(agent_rails::instruction::CreateSession {
            session_key,
            label,
            expires_at,
            auth_mode,
        })
        .instruction()
        .expect("build create_session instruction")
}

/// Runs `create_session` as the owner with a fresh deterministic agent key.
pub fn create_session(
    env: &mut Env,
    fixture: &TreasuryFixture,
    policy: &Pubkey,
    ttl_seconds: i64,
) -> SessionFixture {
    let session_key = env.unfunded_keypair();
    let session = session_pda(&fixture.treasury, &session_key.pubkey()).0;
    let expires_at = env.now() + ttl_seconds;

    let ix = create_session_ix(
        env,
        &fixture.treasury,
        &fixture.owner.pubkey(),
        policy,
        SessionSpec {
            session_key: session_key.pubkey(),
            label: padded_name("test-agent"),
            expires_at,
            auth_mode: agent_rails::constants::AuthMode::DIRECT_SIGNER,
        },
    );
    let owner = fixture.owner.insecure_clone();
    env.execute(ix, &[&owner]).assert_success();

    SessionFixture {
        session_key,
        session,
        policy: *policy,
        genesis_head: agent_rails_policy::genesis_audit_head(&session.to_bytes()),
    }
}

/// `create_session`, signed by an explicit keypair (typically the operator) against a
/// plain treasury address rather than a `TreasuryFixture` — the escape hatch a
/// `PdaOwnedTreasuryFixture` needs, since operator-signed instructions never touch the
/// owner/PDA distinction at all.
pub fn create_session_as(
    env: &mut Env,
    treasury: Pubkey,
    signer: &Keypair,
    policy: &Pubkey,
    ttl_seconds: i64,
) -> SessionFixture {
    let session_key = env.unfunded_keypair();
    let session = session_pda(&treasury, &session_key.pubkey()).0;
    let expires_at = env.now() + ttl_seconds;

    let ix = create_session_ix(
        env,
        &treasury,
        &signer.pubkey(),
        policy,
        SessionSpec {
            session_key: session_key.pubkey(),
            label: padded_name("test-agent"),
            expires_at,
            auth_mode: agent_rails::constants::AuthMode::DIRECT_SIGNER,
        },
    );
    env.execute(ix, &[signer]).assert_success();

    SessionFixture {
        session_key,
        session,
        policy: *policy,
        genesis_head: agent_rails_policy::genesis_audit_head(&session.to_bytes()),
    }
}

pub fn revoke_session_ix(
    env: &Env,
    treasury: &Pubkey,
    authority: &Pubkey,
    policy: &Pubkey,
    session: &Pubkey,
) -> Instruction {
    env.ctx
        .program()
        .accounts(agent_rails::accounts::RevokeSession {
            authority: *authority,
            treasury: *treasury,
            policy: *policy,
            session: *session,
            event_authority: Env::event_authority(),
            program: agent_rails::ID,
        })
        .args(agent_rails::instruction::RevokeSession {})
        .instruction()
        .expect("build revoke_session instruction")
}

pub fn close_session_ix(
    env: &Env,
    treasury: &Pubkey,
    operator: &Pubkey,
    policy: &Pubkey,
    session: &Pubkey,
    rent_destination: &Pubkey,
) -> Instruction {
    env.ctx
        .program()
        .accounts(agent_rails::accounts::CloseSession {
            operator: *operator,
            treasury: *treasury,
            policy: *policy,
            session: *session,
            rent_destination: *rent_destination,
            event_authority: Env::event_authority(),
            program: agent_rails::ID,
        })
        .args(agent_rails::instruction::CloseSession {})
        .instruction()
        .expect("build close_session instruction")
}

pub fn policy_account(env: &Env, address: &Pubkey) -> Policy {
    env.ctx.get_account(address).expect("decode Policy")
}

pub fn allowlist_account(env: &Env, address: &Pubkey) -> AllowlistEntry {
    env.ctx.get_account(address).expect("decode AllowlistEntry")
}

pub fn account_exists(env: &Env, address: &Pubkey) -> bool {
    env.ctx
        .svm
        .get_account(address)
        .is_some_and(|account| !account.data.is_empty())
}

// ---------------------------------------------------------------------------------------
// Owner administration (spec §5.1) and policy updates (spec §5.2)
// ---------------------------------------------------------------------------------------

pub fn update_policy_ix(
    env: &Env,
    treasury: &Pubkey,
    operator: &Pubkey,
    policy: &Pubkey,
    args: PolicyInput,
) -> Instruction {
    env.ctx
        .program()
        .accounts(agent_rails::accounts::UpdatePolicy {
            operator: *operator,
            treasury: *treasury,
            policy: *policy,
            event_authority: Env::event_authority(),
            program: agent_rails::ID,
        })
        .args(agent_rails::instruction::UpdatePolicy { args })
        .instruction()
        .expect("build update_policy instruction")
}

pub fn set_ceiling_ix(
    env: &Env,
    treasury: &Pubkey,
    owner: &Pubkey,
    mint: Pubkey,
    ceiling: MintCeilingInput,
    allow_any_destination: bool,
    allow_create_destination_ata: bool,
) -> Instruction {
    env.ctx
        .program()
        .accounts(agent_rails::accounts::SetCeiling {
            owner: *owner,
            treasury: *treasury,
            event_authority: Env::event_authority(),
            program: agent_rails::ID,
        })
        .args(agent_rails::instruction::SetCeiling {
            mint,
            ceiling,
            allow_any_destination,
            allow_create_destination_ata,
        })
        .instruction()
        .expect("build set_ceiling instruction")
}

/// Runs `set_ceiling` as the owner, keeping both destination flags permissive.
pub fn set_ceiling(
    env: &mut Env,
    fixture: &TreasuryFixture,
    mint: Pubkey,
    ceiling: MintCeilingInput,
) {
    let ix = set_ceiling_ix(
        env,
        &fixture.treasury,
        &fixture.owner.pubkey(),
        mint,
        ceiling,
        true,
        true,
    );
    let owner = fixture.owner.insecure_clone();
    env.execute(ix, &[&owner]).assert_success();
}

/// Runs `set_ceiling` to flip the two treasury-wide destination flags, leaving the mint's
/// amount ceiling untouched.
pub fn set_destination_flags(
    env: &mut Env,
    fixture: &TreasuryFixture,
    mint: Pubkey,
    allow_any_destination: bool,
    allow_create_destination_ata: bool,
) {
    let ix = set_ceiling_ix(
        env,
        &fixture.treasury,
        &fixture.owner.pubkey(),
        mint,
        permissive_ceiling(),
        allow_any_destination,
        allow_create_destination_ata,
    );
    let owner = fixture.owner.insecure_clone();
    env.execute(ix, &[&owner]).assert_success();
}

/// Builds `remove_mint`. `vault_ata` is `Some` for SPL / Token-2022 and `None` for native
/// SOL, where `sol_vault` takes its place.
pub fn remove_mint_ix(
    env: &Env,
    fixture: &TreasuryFixture,
    owner: &Pubkey,
    mint: Pubkey,
    vault_ata: Option<Pubkey>,
) -> Instruction {
    let sol_vault = vault_ata.is_none().then_some(fixture.sol_vault);
    env.ctx
        .program()
        .accounts(agent_rails::accounts::RemoveMint {
            owner: *owner,
            treasury: fixture.treasury,
            mint,
            vault_ata,
            sol_vault,
            event_authority: Env::event_authority(),
            program: agent_rails::ID,
        })
        .args(agent_rails::instruction::RemoveMint {})
        .instruction()
        .expect("build remove_mint instruction")
}

/// Token supply helper, used when a test needs to know what was minted into a vault.
pub fn token_supply(env: &Env, mint: &Pubkey) -> u64 {
    use anchor_spl::token_2022::spl_token_2022::extension::StateWithExtensions;
    use anchor_spl::token_2022::spl_token_2022::state::Mint as MintState;

    let data = env.account_data(mint);
    StateWithExtensions::<MintState>::unpack(&data)
        .expect("unpack mint")
        .base
        .supply
}

// ---------------------------------------------------------------------------------------
// Roles, pause, withdraw, teardown (spec §5.1, §5.4)
// ---------------------------------------------------------------------------------------

pub fn set_roles_ix(
    env: &Env,
    treasury: &Pubkey,
    owner: &Pubkey,
    new_owner: Option<Pubkey>,
    new_operator: Option<Pubkey>,
) -> Instruction {
    env.ctx
        .program()
        .accounts(agent_rails::accounts::SetRoles {
            owner: *owner,
            treasury: *treasury,
            event_authority: Env::event_authority(),
            program: agent_rails::ID,
        })
        .args(agent_rails::instruction::SetRoles {
            new_owner,
            new_operator,
        })
        .instruction()
        .expect("build set_roles instruction")
}

pub fn add_guardian_ix(
    env: &Env,
    treasury: &Pubkey,
    owner: &Pubkey,
    guardian: Pubkey,
) -> Instruction {
    env.ctx
        .program()
        .accounts(agent_rails::accounts::AddGuardian {
            owner: *owner,
            treasury: *treasury,
            event_authority: Env::event_authority(),
            program: agent_rails::ID,
        })
        .args(agent_rails::instruction::AddGuardian { guardian })
        .instruction()
        .expect("build add_guardian instruction")
}

pub fn add_guardian(env: &mut Env, fixture: &TreasuryFixture, guardian: Pubkey) {
    let ix = add_guardian_ix(env, &fixture.treasury, &fixture.owner.pubkey(), guardian);
    let owner = fixture.owner.insecure_clone();
    env.execute(ix, &[&owner]).assert_success();
}

pub fn remove_guardian_ix(
    env: &Env,
    treasury: &Pubkey,
    owner: &Pubkey,
    guardian: Pubkey,
) -> Instruction {
    env.ctx
        .program()
        .accounts(agent_rails::accounts::RemoveGuardian {
            owner: *owner,
            treasury: *treasury,
            event_authority: Env::event_authority(),
            program: agent_rails::ID,
        })
        .args(agent_rails::instruction::RemoveGuardian { guardian })
        .instruction()
        .expect("build remove_guardian instruction")
}

pub fn pause_ix(env: &Env, treasury: &Pubkey, authority: &Pubkey) -> Instruction {
    env.ctx
        .program()
        .accounts(agent_rails::accounts::Pause {
            authority: *authority,
            treasury: *treasury,
            event_authority: Env::event_authority(),
            program: agent_rails::ID,
        })
        .args(agent_rails::instruction::Pause {})
        .instruction()
        .expect("build pause instruction")
}

pub fn pause(env: &mut Env, fixture: &TreasuryFixture) {
    let ix = pause_ix(env, &fixture.treasury, &fixture.owner.pubkey());
    let owner = fixture.owner.insecure_clone();
    env.execute(ix, &[&owner]).assert_success();
}

pub fn unpause_ix(env: &Env, treasury: &Pubkey, owner: &Pubkey) -> Instruction {
    env.ctx
        .program()
        .accounts(agent_rails::accounts::Unpause {
            owner: *owner,
            treasury: *treasury,
            event_authority: Env::event_authority(),
            program: agent_rails::ID,
        })
        .args(agent_rails::instruction::Unpause {})
        .instruction()
        .expect("build unpause instruction")
}

pub fn unpause(env: &mut Env, fixture: &TreasuryFixture) {
    let ix = unpause_ix(env, &fixture.treasury, &fixture.owner.pubkey());
    let owner = fixture.owner.insecure_clone();
    env.execute(ix, &[&owner]).assert_success();
}

/// Builds `withdraw`. `spl` is `Some((vault_ata, token_program))` for tokens and `None`
/// for native SOL, matching `add_mint_ix`.
pub fn withdraw_ix(
    env: &Env,
    fixture: &TreasuryFixture,
    owner: &Pubkey,
    mint: Pubkey,
    amount: u64,
    destination: Pubkey,
    spl: Option<(Pubkey, Pubkey)>,
) -> Instruction {
    let (vault_ata, token_program, sol_vault) = match spl {
        Some((vault, program)) => (Some(vault), Some(program), None),
        None => (None, None, Some(fixture.sol_vault)),
    };
    env.ctx
        .program()
        .accounts(agent_rails::accounts::Withdraw {
            owner: *owner,
            treasury: fixture.treasury,
            mint,
            vault_ata,
            sol_vault,
            destination,
            token_program,
            system_program: anchor_lang::system_program::ID,
            event_authority: Env::event_authority(),
            program: agent_rails::ID,
        })
        .args(agent_rails::instruction::Withdraw { amount })
        .instruction()
        .expect("build withdraw instruction")
}

pub fn close_treasury_ix(
    env: &Env,
    fixture: &TreasuryFixture,
    owner: &Pubkey,
    rent_destination: &Pubkey,
) -> Instruction {
    env.ctx
        .program()
        .accounts(agent_rails::accounts::CloseTreasury {
            owner: *owner,
            treasury: fixture.treasury,
            sol_vault: fixture.sol_vault,
            rent_destination: *rent_destination,
            system_program: anchor_lang::system_program::ID,
            event_authority: Env::event_authority(),
            program: agent_rails::ID,
        })
        .args(agent_rails::instruction::CloseTreasury {})
        .instruction()
        .expect("build close_treasury instruction")
}

pub fn close_receipt_ix(
    env: &Env,
    receipt: &Pubkey,
    anyone: &Pubkey,
    fee_payer: &Pubkey,
) -> Instruction {
    env.ctx
        .program()
        .accounts(agent_rails::accounts::CloseReceipt {
            anyone: *anyone,
            receipt: *receipt,
            fee_payer: *fee_payer,
            event_authority: Env::event_authority(),
            program: agent_rails::ID,
        })
        .args(agent_rails::instruction::CloseReceipt {})
        .instruction()
        .expect("build close_receipt instruction")
}
