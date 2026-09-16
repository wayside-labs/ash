//! `create_treasury` and `add_mint` against a real SVM (spec §5.1).

mod common;

use anchor_litesvm::{Pubkey, Signer};

use agent_rails::constants::{MintFlags, NATIVE_MINT, PROGRAM_VERSION};
use agent_rails::state::MintCeiling;
use agent_rails::{AgentRailsError, MintCeilingInput};

use common::{
    add_mint_ix, add_native_mint, add_native_mint_ix, add_spl_mint, add_spl_mint_ix,
    assert_program_error, create_spl_token_mint, create_token_2022_plain,
    create_token_2022_with_non_transferable, create_token_2022_with_permanent_delegate,
    create_token_2022_with_transfer_fee, create_token_2022_with_transfer_hook, create_treasury,
    permissive_ceiling, token_2022_program_id, token_program_id, vault_ata, Env,
};

#[test]
fn create_treasury_initializes_state_and_funds_the_sol_vault() {
    let mut env = Env::new();
    let before = env.now();
    let fixture = create_treasury(&mut env, false, false);
    let treasury = env.treasury(&fixture.treasury);

    assert_eq!(treasury.version, PROGRAM_VERSION);
    assert_eq!(treasury.bump, fixture.treasury_bump);
    assert_eq!(treasury.sol_vault_bump, fixture.sol_vault_bump);
    assert_eq!(treasury.create_key, fixture.create_key.pubkey());
    assert_eq!(treasury.owner, fixture.owner.pubkey());
    assert_eq!(treasury.operator, fixture.operator);
    assert_eq!(treasury.recovery_destination, fixture.recovery_destination);

    // A fresh treasury holds nothing and delegates nothing.
    assert_eq!(treasury.guardian_count, 0);
    assert_eq!(treasury.guardians, [Pubkey::default(); 5]);
    assert!(!treasury.paused);
    assert_eq!(treasury.paused_at, 0);
    assert_eq!(treasury.paused_by, Pubkey::default());
    assert_eq!(treasury.mint_count, 0);
    assert_eq!(treasury.active_sessions, 0);
    assert_eq!(treasury.policy_count, 0);
    assert!(treasury.created_at >= before);

    // v1.1 fields and the reserved block must be zero (invariant 12 of spec §11).
    assert_eq!(treasury.timelock_seconds, 0);
    assert_eq!(treasury.reserved, [0u8; 128]);

    // The SOL vault is a system-owned PDA holding exactly the rent floor for 0 data bytes,
    // which is the balance `execute_payment_sol` may never spend below.
    let vault = env
        .ctx
        .svm
        .get_account(&fixture.sol_vault)
        .expect("sol_vault exists");
    assert_eq!(vault.owner, anchor_lang::system_program::ID);
    assert_eq!(vault.data.len(), 0);
    assert_eq!(vault.lamports, 890_880);
}

/// The two ceiling flags are the only thing standing between an operator and an
/// unrestricted-destination policy, so they must round-trip exactly as passed.
#[test]
fn create_treasury_records_the_ceiling_flags() {
    let mut env = Env::new();

    let locked_down = create_treasury(&mut env, false, false);
    let treasury = env.treasury(&locked_down.treasury);
    assert!(!treasury.allow_any_destination);
    assert!(!treasury.allow_create_destination_ata);

    let permissive = create_treasury(&mut env, true, true);
    let treasury = env.treasury(&permissive.treasury);
    assert!(treasury.allow_any_destination);
    assert!(treasury.allow_create_destination_ata);
}

/// The `create_key` seed is what allows unlimited treasuries per owner: two treasuries
/// created by the same owner must land on different PDAs and not collide.
#[test]
fn one_owner_can_hold_many_treasuries() {
    let mut env = Env::new();
    let first = create_treasury(&mut env, false, false);
    let second = create_treasury(&mut env, false, false);

    assert_ne!(first.treasury, second.treasury);
    assert_ne!(first.sol_vault, second.sol_vault);
    assert_eq!(env.treasury(&first.treasury).mint_count, 0);
    assert_eq!(env.treasury(&second.treasury).mint_count, 0);
}

/// The headline assertion: a ceiling submitted through `add_mint` is stored byte-for-byte
/// in the treasury's mint slot on the local VM.
#[test]
fn add_mint_stores_the_ceiling_in_the_treasury_slot() {
    let mut env = Env::new();
    let fixture = create_treasury(&mut env, false, false);

    let ceiling = MintCeilingInput {
        max_per_tx: 25_000_000_000,
        max_short_window: 100_000_000_000,
        max_long_window: 400_000_000_000,
        max_lifetime: 2_500_000_000_000,
        min_short_window_seconds: 3_600,
        min_long_window_seconds: 86_400,
    };
    add_native_mint(&mut env, &fixture, ceiling);

    let treasury = env.treasury(&fixture.treasury);
    assert_eq!(treasury.mint_count, 1);

    let slot = treasury.mints[0];
    assert_eq!(slot.mint, NATIVE_MINT);
    assert_eq!(slot.token_program, anchor_lang::system_program::ID);
    assert_eq!(slot.decimals, 9);
    assert_eq!(slot.flags, MintFlags::IS_NATIVE);
    assert!(slot.is_native());
    assert_eq!(
        slot.funding_mode,
        agent_rails::state::FundingMode::IsolatedVault
    );
    assert_eq!(slot._pad, [0u8; 5]);

    assert_eq!(
        slot.ceiling,
        MintCeiling {
            max_per_tx: 25_000_000_000,
            max_short_window: 100_000_000_000,
            max_long_window: 400_000_000_000,
            max_lifetime: 2_500_000_000_000,
            min_short_window_seconds: 3_600,
            min_long_window_seconds: 86_400,
        }
    );

    // Untouched slots stay at the `Pubkey::default()` sentinel so `find_mint` cannot match
    // them and `free_mint_slot` still sees three openings.
    for empty in &treasury.mints[1..] {
        assert_eq!(empty.mint, Pubkey::default());
        assert!(!empty.is_used());
    }
}

/// Decoding through Anchor could hide a layout bug that an off-chain client would hit, so
/// this reads the ceiling straight out of the account bytes at the spec §3.1 offsets.
#[test]
fn ceiling_lands_at_the_offsets_the_spec_promises() {
    let mut env = Env::new();
    let fixture = create_treasury(&mut env, false, false);
    add_native_mint(&mut env, &fixture, permissive_ceiling());

    let data = env.account_data(&fixture.treasury);
    assert_eq!(data.len(), 944);

    // Treasury.mints starts at 351; slot 0's ceiling starts 72 bytes into MintConfig.
    const MINTS_OFFSET: usize = 351;
    const CEILING_OFFSET: usize = MINTS_OFFSET + 72;

    let expected = permissive_ceiling();
    let u64_at = |offset: usize| u64::from_le_bytes(data[offset..offset + 8].try_into().unwrap());
    let u32_at = |offset: usize| u32::from_le_bytes(data[offset..offset + 4].try_into().unwrap());

    assert_eq!(&data[MINTS_OFFSET..MINTS_OFFSET + 32], NATIVE_MINT.as_ref());
    assert_eq!(data[MINTS_OFFSET + 64], 9, "decimals");
    assert_eq!(data[MINTS_OFFSET + 65], MintFlags::IS_NATIVE, "flags");
    assert_eq!(
        &data[MINTS_OFFSET + 66..MINTS_OFFSET + 72],
        &[0u8; 6],
        "_pad"
    );

    assert_eq!(u64_at(CEILING_OFFSET), expected.max_per_tx);
    assert_eq!(u64_at(CEILING_OFFSET + 8), expected.max_short_window);
    assert_eq!(u64_at(CEILING_OFFSET + 16), expected.max_long_window);
    assert_eq!(u64_at(CEILING_OFFSET + 24), expected.max_lifetime);
    assert_eq!(
        u32_at(CEILING_OFFSET + 32),
        expected.min_short_window_seconds
    );
    assert_eq!(
        u32_at(CEILING_OFFSET + 36),
        expected.min_long_window_seconds
    );

    // mint_count at 799, and the reserved tail at 816 is still zero.
    assert_eq!(data[799], 1);
    assert_eq!(&data[816..944], &[0u8; 128]);
}

/// A mint occupies exactly one slot; re-adding it must not consume a second.
#[test]
fn add_mint_rejects_a_duplicate_mint() {
    let mut env = Env::new();
    let fixture = create_treasury(&mut env, false, false);

    add_native_mint(&mut env, &fixture, permissive_ceiling());
    assert_eq!(env.treasury(&fixture.treasury).mint_count, 1);

    let ix = add_native_mint_ix(
        &env,
        &fixture.treasury,
        &fixture.owner.pubkey(),
        permissive_ceiling(),
    );
    let owner = fixture.owner.insecure_clone();
    let result = env.execute(ix, &[&owner]);

    assert_program_error(&result, AgentRailsError::DuplicateMint);
    assert_eq!(env.treasury(&fixture.treasury).mint_count, 1);
}

/// A ceiling with a sub-minimum window must be rejected by the policy crate before it can
/// be written, since every policy validated against it would inherit the bad bound.
#[test]
fn add_mint_rejects_an_invalid_ceiling() {
    let mut env = Env::new();
    let fixture = create_treasury(&mut env, false, false);

    let ix = add_native_mint_ix(
        &env,
        &fixture.treasury,
        &fixture.owner.pubkey(),
        MintCeilingInput {
            min_short_window_seconds: 30, // below MIN_WINDOW_SECONDS
            ..permissive_ceiling()
        },
    );
    let owner = fixture.owner.insecure_clone();
    let result = env.execute(ix, &[&owner]);

    assert_program_error(&result, AgentRailsError::InvalidWindow);
    assert_eq!(env.treasury(&fixture.treasury).mint_count, 0);
}

/// Only the cold owner key may widen the ceiling; the operator is deliberately excluded.
#[test]
fn add_mint_rejects_a_non_owner_signer() {
    let mut env = Env::new();
    let fixture = create_treasury(&mut env, false, false);
    let impostor = env.keypair();

    let ix = add_native_mint_ix(
        &env,
        &fixture.treasury,
        &impostor.pubkey(),
        permissive_ceiling(),
    );
    let result = env.execute(ix, &[&impostor]);

    assert_program_error(&result, AgentRailsError::Unauthorized);
    assert_eq!(env.treasury(&fixture.treasury).mint_count, 0);
}

/// A pubkey that is not an SPL / Token-2022 mint must not occupy a slot.
#[test]
fn add_mint_rejects_a_non_mint_account() {
    let mut env = Env::new();
    let fixture = create_treasury(&mut env, false, false);

    let ix = add_mint_ix(
        &env,
        &fixture.treasury,
        &fixture.owner.pubkey(),
        Pubkey::new_unique(),
        permissive_ceiling(),
        None,
    );
    let owner = fixture.owner.insecure_clone();
    let result = env.execute(ix, &[&owner]);

    assert_program_error(&result, AgentRailsError::TokenProgramMismatch);
    assert_eq!(env.treasury(&fixture.treasury).mint_count, 0);
}

/// SPL Token mints are stored with the token program id, cached decimals, and a vault ATA
/// owned by the treasury PDA (spec §5.1, ADR-010).
#[test]
fn add_mint_creates_a_vault_ata_for_an_spl_token() {
    let mut env = Env::new();
    let fixture = create_treasury(&mut env, false, false);
    let owner = fixture.owner.insecure_clone();
    let mint = create_spl_token_mint(&mut env, &owner, 6);

    add_spl_mint(
        &mut env,
        &fixture,
        mint,
        token_program_id(),
        permissive_ceiling(),
    );

    let treasury = env.treasury(&fixture.treasury);
    assert_eq!(treasury.mint_count, 1);
    let slot = treasury.mints[0];
    assert_eq!(slot.mint, mint);
    assert_eq!(slot.token_program, token_program_id());
    assert_eq!(slot.decimals, 6);
    assert_eq!(slot.flags, 0);
    assert!(!slot.is_native());

    let vault = vault_ata(&fixture.treasury, &mint, &token_program_id());
    let vault_account = env.ctx.svm.get_account(&vault).expect("vault ATA exists");
    assert_eq!(vault_account.owner, token_program_id());
}

/// Creating the vault ATA twice is a no-op: a pre-existing ATA must not block `add_mint`.
#[test]
fn add_mint_is_idempotent_when_the_vault_ata_already_exists() {
    let mut env = Env::new();
    let fixture = create_treasury(&mut env, false, false);
    let owner = fixture.owner.insecure_clone();
    let mint = create_spl_token_mint(&mut env, &owner, 9);

    let create_ata = spl_associated_token_account::instruction::create_associated_token_account(
        &owner.pubkey(),
        &fixture.treasury,
        &mint,
        &token_program_id(),
    );
    env.execute(create_ata, &[&owner]).assert_success();

    add_spl_mint(
        &mut env,
        &fixture,
        mint,
        token_program_id(),
        permissive_ceiling(),
    );
    assert_eq!(env.treasury(&fixture.treasury).mint_count, 1);
}

/// Passing the classic Token program with a Token-2022 mint is a program mismatch, not a
/// silent re-tag (the stored id is what `execute_payment` will CPI into).
#[test]
fn add_mint_rejects_a_token_program_that_does_not_own_the_mint() {
    let mut env = Env::new();
    let fixture = create_treasury(&mut env, false, false);
    let owner = fixture.owner.insecure_clone();
    let mint = create_token_2022_plain(&mut env, &owner, 6);

    let ix = add_spl_mint_ix(
        &env,
        &fixture.treasury,
        &owner.pubkey(),
        mint,
        token_program_id(),
        permissive_ceiling(),
    );
    let result = env.execute(ix, &[&owner]);

    assert_program_error(&result, AgentRailsError::TokenProgramMismatch);
    assert_eq!(env.treasury(&fixture.treasury).mint_count, 0);
}

#[test]
fn add_mint_accepts_token_2022_and_records_transfer_fee() {
    let mut env = Env::new();
    let fixture = create_treasury(&mut env, false, false);
    let owner = fixture.owner.insecure_clone();
    let mint = create_token_2022_with_transfer_fee(&mut env, &owner);

    add_spl_mint(
        &mut env,
        &fixture,
        mint,
        token_2022_program_id(),
        permissive_ceiling(),
    );

    let slot = env.treasury(&fixture.treasury).mints[0];
    assert_eq!(slot.mint, mint);
    assert_eq!(slot.token_program, token_2022_program_id());
    assert_eq!(slot.flags, MintFlags::HAS_TRANSFER_FEE);
    assert_eq!(slot.decimals, 6);

    let vault = vault_ata(&fixture.treasury, &mint, &token_2022_program_id());
    let vault_account = env
        .ctx
        .svm
        .get_account(&vault)
        .expect("Token-2022 vault ATA exists");
    assert_eq!(vault_account.owner, token_2022_program_id());
}

#[test]
fn add_mint_records_a_permanent_delegate_flag() {
    let mut env = Env::new();
    let fixture = create_treasury(&mut env, false, false);
    let owner = fixture.owner.insecure_clone();
    let mint = create_token_2022_with_permanent_delegate(&mut env, &owner);

    add_spl_mint(
        &mut env,
        &fixture,
        mint,
        token_2022_program_id(),
        permissive_ceiling(),
    );

    assert_eq!(
        env.treasury(&fixture.treasury).mints[0].flags,
        MintFlags::HAS_PERMANENT_DELEGATE
    );
}

#[test]
fn add_mint_rejects_transfer_hook() {
    let mut env = Env::new();
    let fixture = create_treasury(&mut env, false, false);
    let owner = fixture.owner.insecure_clone();
    let mint = create_token_2022_with_transfer_hook(&mut env, &owner);

    let ix = add_spl_mint_ix(
        &env,
        &fixture.treasury,
        &owner.pubkey(),
        mint,
        token_2022_program_id(),
        permissive_ceiling(),
    );
    let result = env.execute(ix, &[&owner]);

    assert_program_error(&result, AgentRailsError::UnsupportedMintExtension);
    assert_eq!(env.treasury(&fixture.treasury).mint_count, 0);
}

#[test]
fn add_mint_rejects_non_transferable() {
    let mut env = Env::new();
    let fixture = create_treasury(&mut env, false, false);
    let owner = fixture.owner.insecure_clone();
    let mint = create_token_2022_with_non_transferable(&mut env, &owner);

    let ix = add_spl_mint_ix(
        &env,
        &fixture.treasury,
        &owner.pubkey(),
        mint,
        token_2022_program_id(),
        permissive_ceiling(),
    );
    let result = env.execute(ix, &[&owner]);

    assert_program_error(&result, AgentRailsError::UnsupportedMintExtension);
    assert_eq!(env.treasury(&fixture.treasury).mint_count, 0);
}

#[test]
fn add_mint_fills_every_slot_then_rejects_the_fifth() {
    let mut env = Env::new();
    let fixture = create_treasury(&mut env, false, false);
    let owner = fixture.owner.insecure_clone();

    add_native_mint(&mut env, &fixture, permissive_ceiling());
    for _ in 0..3 {
        let mint = create_spl_token_mint(&mut env, &owner, 6);
        add_spl_mint(
            &mut env,
            &fixture,
            mint,
            token_program_id(),
            permissive_ceiling(),
        );
    }
    assert_eq!(env.treasury(&fixture.treasury).mint_count, 4);

    let extra = create_spl_token_mint(&mut env, &owner, 6);
    let ix = add_spl_mint_ix(
        &env,
        &fixture.treasury,
        &owner.pubkey(),
        extra,
        token_program_id(),
        permissive_ceiling(),
    );
    let result = env.execute(ix, &[&owner]);

    assert_program_error(&result, AgentRailsError::MintSlotsFull);
    assert_eq!(env.treasury(&fixture.treasury).mint_count, 4);
}
