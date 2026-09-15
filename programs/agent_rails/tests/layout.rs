//! Account layout snapshot (ADR-008, spec §3).
//!
//! `state.rs` already fails the build if a total size drifts. This file covers the case a
//! size check cannot see: two fields swapped, or one widened while another shrinks. Each
//! account is serialized with a distinct byte pattern per field and every absolute offset
//! from the spec table is read back.
//!
//! A failure here is a breaking change for every Codama client and indexer downstream.

use anchor_lang::prelude::Pubkey;
use anchor_lang::AnchorSerialize;

use agent_rails::constants::{RECEIPT_GRACE_SECONDS, SEED_RECEIPT};

use agent_rails::state::{
    AgentSession, AllowlistEntry, FundingMode, IntentReceipt, MintCeiling, MintConfig, MintLimit,
    Policy, SpendCounter, Treasury, DISCRIMINATOR_LEN,
};

/// A pubkey whose every byte is `tag`, so a misplaced field is obvious in a diff.
fn key(tag: u8) -> Pubkey {
    Pubkey::new_from_array([tag; 32])
}

/// Serializes the account body and prefixes the 8 discriminator bytes that Anchor writes,
/// so offsets line up with the absolute ones in the spec.
fn encode<T: AnchorSerialize>(value: &T) -> Vec<u8> {
    let mut bytes = vec![0u8; DISCRIMINATOR_LEN];
    value.serialize(&mut bytes).expect("borsh serialize");
    bytes
}

fn u32_at(data: &[u8], offset: usize) -> u32 {
    u32::from_le_bytes(data[offset..offset + 4].try_into().unwrap())
}

fn u64_at(data: &[u8], offset: usize) -> u64 {
    u64::from_le_bytes(data[offset..offset + 8].try_into().unwrap())
}

fn i64_at(data: &[u8], offset: usize) -> i64 {
    i64::from_le_bytes(data[offset..offset + 8].try_into().unwrap())
}

fn sample_ceiling() -> MintCeiling {
    MintCeiling {
        max_per_tx: 0x1111_1111_1111_1111,
        max_short_window: 0x2222_2222_2222_2222,
        max_long_window: 0x3333_3333_3333_3333,
        max_lifetime: 0x4444_4444_4444_4444,
        min_short_window_seconds: 0x5555_5555,
        min_long_window_seconds: 0x6666_6666,
    }
}

#[test]
fn account_sizes_match_the_spec() {
    assert_eq!(Treasury::LEN, 944);
    assert_eq!(Policy::LEN, 546);
    assert_eq!(AgentSession::LEN, 588);
    assert_eq!(AllowlistEntry::LEN, 186);
    assert_eq!(IntentReceipt::LEN, 243);

    assert_eq!(MintConfig::LEN, 112);
    assert_eq!(MintCeiling::LEN, 40);
    assert_eq!(MintLimit::LEN, 96);
    assert_eq!(SpendCounter::LEN, 80);
}

#[test]
fn treasury_field_offsets() {
    let treasury = Treasury {
        version: 1,
        bump: 254,
        sol_vault_bump: 253,
        create_key: key(0x11),
        owner: key(0x22),
        operator: key(0x33),
        guardians: [key(0x41), key(0x42), key(0x43), key(0x44), key(0x45)],
        guardian_count: 5,
        paused: true,
        paused_at: 0x0102_0304_0506_0708,
        paused_by: key(0x55),
        allow_any_destination: true,
        allow_create_destination_ata: true,
        timelock_seconds: 0,
        recovery_destination: key(0x66),
        mints: [
            MintConfig {
                mint: key(0x71),
                token_program: key(0x72),
                decimals: 9,
                flags: 0b101,
                funding_mode: FundingMode::NativeAllowance,
                _pad: [0u8; 5],
                ceiling: sample_ceiling(),
            },
            MintConfig::EMPTY,
            MintConfig::EMPTY,
            MintConfig::EMPTY,
        ],
        mint_count: 1,
        active_sessions: 0x1234_5678,
        policy_count: 0x9abc_def0,
        created_at: 0x0a0b_0c0d_0e0f_1011,
        reserved: [0u8; 128],
    };

    let data = encode(&treasury);
    assert_eq!(data.len(), 944);

    assert_eq!(data[8], 1, "version");
    assert_eq!(data[9], 254, "bump");
    assert_eq!(data[10], 253, "sol_vault_bump");
    assert_eq!(&data[11..43], key(0x11).as_ref(), "create_key");
    assert_eq!(&data[43..75], key(0x22).as_ref(), "owner");
    assert_eq!(&data[75..107], key(0x33).as_ref(), "operator");
    assert_eq!(&data[107..139], key(0x41).as_ref(), "guardians[0]");
    assert_eq!(&data[235..267], key(0x45).as_ref(), "guardians[4]");
    assert_eq!(data[267], 5, "guardian_count");
    assert_eq!(data[268], 1, "paused");
    assert_eq!(i64_at(&data, 269), 0x0102_0304_0506_0708, "paused_at");
    assert_eq!(&data[277..309], key(0x55).as_ref(), "paused_by");
    assert_eq!(data[309], 1, "allow_any_destination");
    assert_eq!(data[310], 1, "allow_create_destination_ata");
    assert_eq!(u64_at(&data, 311), 0, "timelock_seconds");
    assert_eq!(&data[319..351], key(0x66).as_ref(), "recovery_destination");

    // mints[0] at 351, each MintConfig 112 bytes.
    assert_eq!(&data[351..383], key(0x71).as_ref(), "mints[0].mint");
    assert_eq!(
        &data[383..415],
        key(0x72).as_ref(),
        "mints[0].token_program"
    );
    assert_eq!(data[415], 9, "mints[0].decimals");
    assert_eq!(data[416], 0b101, "mints[0].flags");
    assert_eq!(data[417], 1, "mints[0].funding_mode (NativeAllowance)");
    assert_eq!(&data[418..423], &[0u8; 5], "mints[0]._pad");
    assert_eq!(u64_at(&data, 423), 0x1111_1111_1111_1111, "max_per_tx");
    assert_eq!(
        u64_at(&data, 431),
        0x2222_2222_2222_2222,
        "max_short_window"
    );
    assert_eq!(u64_at(&data, 439), 0x3333_3333_3333_3333, "max_long_window");
    assert_eq!(u64_at(&data, 447), 0x4444_4444_4444_4444, "max_lifetime");
    assert_eq!(u32_at(&data, 455), 0x5555_5555, "min_short_window_seconds");
    assert_eq!(u32_at(&data, 459), 0x6666_6666, "min_long_window_seconds");
    // mints[3] is the last 112-byte block before mint_count.
    assert_eq!(&data[687..799], &[0u8; 112], "mints[3] empty");

    assert_eq!(data[799], 1, "mint_count");
    assert_eq!(u32_at(&data, 800), 0x1234_5678, "active_sessions");
    assert_eq!(u32_at(&data, 804), 0x9abc_def0, "policy_count");
    assert_eq!(i64_at(&data, 808), 0x0a0b_0c0d_0e0f_1011, "created_at");
    assert_eq!(&data[816..944], &[0u8; 128], "reserved");
}

#[test]
fn policy_field_offsets() {
    let policy = Policy {
        version: 1,
        bump: 250,
        treasury: key(0x11),
        name: [0x77; 32],
        mint_limits: [
            MintLimit {
                mint: key(0x21),
                per_tx_max: 0x1111_1111_1111_1111,
                short_window_max: 0x2222_2222_2222_2222,
                short_window_seconds: 0x3333_3333,
                long_window_max: 0x4444_4444_4444_4444,
                long_window_seconds: 0x5555_5555,
                lifetime_max: 0x6666_6666_6666_6666,
                approval_threshold: 0,
                cooldown_seconds: 0,
                reserved: [0u8; 12],
            },
            MintLimit::EMPTY,
            MintLimit::EMPTY,
            MintLimit::EMPTY,
        ],
        mint_count: 1,
        destination_mode: 1,
        require_memo: true,
        create_destination_ata: false,
        active_sessions: 0x0bad_cafe,
        created_at: 0x0102_0304_0506_0708,
        updated_at: 0x1112_1314_1516_1718,
        reserved: [0u8; 64],
    };

    let data = encode(&policy);
    assert_eq!(data.len(), 546);

    assert_eq!(data[8], 1, "version");
    assert_eq!(data[9], 250, "bump");
    assert_eq!(&data[10..42], key(0x11).as_ref(), "treasury");
    assert_eq!(&data[42..74], &[0x77u8; 32], "name");

    // mint_limits[0] at 74, each MintLimit 96 bytes.
    assert_eq!(&data[74..106], key(0x21).as_ref(), "limits[0].mint");
    assert_eq!(u64_at(&data, 106), 0x1111_1111_1111_1111, "per_tx_max");
    assert_eq!(
        u64_at(&data, 114),
        0x2222_2222_2222_2222,
        "short_window_max"
    );
    assert_eq!(u32_at(&data, 122), 0x3333_3333, "short_window_seconds");
    assert_eq!(u64_at(&data, 126), 0x4444_4444_4444_4444, "long_window_max");
    assert_eq!(u32_at(&data, 134), 0x5555_5555, "long_window_seconds");
    assert_eq!(u64_at(&data, 138), 0x6666_6666_6666_6666, "lifetime_max");
    assert_eq!(u64_at(&data, 146), 0, "approval_threshold (v1.1)");
    assert_eq!(u32_at(&data, 154), 0, "cooldown_seconds (v1.1)");
    assert_eq!(&data[158..170], &[0u8; 12], "limits[0].reserved");
    assert_eq!(&data[362..458], &[0u8; 96], "limits[3] empty");

    assert_eq!(data[458], 1, "mint_count");
    assert_eq!(data[459], 1, "destination_mode");
    assert_eq!(data[460], 1, "require_memo");
    assert_eq!(data[461], 0, "create_destination_ata");
    assert_eq!(u32_at(&data, 462), 0x0bad_cafe, "active_sessions");
    assert_eq!(i64_at(&data, 466), 0x0102_0304_0506_0708, "created_at");
    assert_eq!(i64_at(&data, 474), 0x1112_1314_1516_1718, "updated_at");
    assert_eq!(&data[482..546], &[0u8; 64], "reserved");
}

#[test]
fn agent_session_field_offsets() {
    let session = AgentSession {
        version: 1,
        bump: 249,
        treasury: key(0x11),
        policy: key(0x22),
        session_key: key(0x33),
        auth_mode: 0,
        label: [0x44; 32],
        created_at: 0x0102_0304_0506_0708,
        expires_at: 0x1112_1314_1516_1718,
        revoked: true,
        revoked_at: 0x2122_2324_2526_2728,
        seq: 0x3132_3334_3536_3738,
        audit_head: [0x55; 32],
        spend: [
            SpendCounter {
                mint: key(0x61),
                short_window_start: 0x0101_0101_0101_0101,
                short_spent: 0x0202_0202_0202_0202,
                long_window_start: 0x0303_0303_0303_0303,
                long_spent: 0x0404_0404_0404_0404,
                lifetime_spent: 0x0505_0505_0505_0505,
                last_payment_at: 0x0606_0606_0606_0606,
            },
            SpendCounter::EMPTY,
            SpendCounter::EMPTY,
            SpendCounter::EMPTY,
        ],
        reserved: [0u8; 64],
    };

    let data = encode(&session);
    assert_eq!(data.len(), 588);

    assert_eq!(data[8], 1, "version");
    assert_eq!(data[9], 249, "bump");
    assert_eq!(&data[10..42], key(0x11).as_ref(), "treasury");
    assert_eq!(&data[42..74], key(0x22).as_ref(), "policy");
    assert_eq!(&data[74..106], key(0x33).as_ref(), "session_key");
    assert_eq!(data[106], 0, "auth_mode");
    assert_eq!(&data[107..139], &[0x44u8; 32], "label");
    assert_eq!(i64_at(&data, 139), 0x0102_0304_0506_0708, "created_at");
    assert_eq!(i64_at(&data, 147), 0x1112_1314_1516_1718, "expires_at");
    assert_eq!(data[155], 1, "revoked");
    assert_eq!(i64_at(&data, 156), 0x2122_2324_2526_2728, "revoked_at");
    assert_eq!(u64_at(&data, 164), 0x3132_3334_3536_3738, "seq");
    assert_eq!(&data[172..204], &[0x55u8; 32], "audit_head");

    // spend[0] at 204, each SpendCounter 80 bytes.
    assert_eq!(&data[204..236], key(0x61).as_ref(), "spend[0].mint");
    assert_eq!(
        i64_at(&data, 236),
        0x0101_0101_0101_0101,
        "short_window_start"
    );
    assert_eq!(u64_at(&data, 244), 0x0202_0202_0202_0202, "short_spent");
    assert_eq!(
        i64_at(&data, 252),
        0x0303_0303_0303_0303,
        "long_window_start"
    );
    assert_eq!(u64_at(&data, 260), 0x0404_0404_0404_0404, "long_spent");
    assert_eq!(u64_at(&data, 268), 0x0505_0505_0505_0505, "lifetime_spent");
    assert_eq!(i64_at(&data, 276), 0x0606_0606_0606_0606, "last_payment_at");
    assert_eq!(&data[444..524], &[0u8; 80], "spend[3] empty");

    assert_eq!(&data[524..588], &[0u8; 64], "reserved");
}

#[test]
fn allowlist_entry_field_offsets() {
    let entry = AllowlistEntry {
        version: 1,
        bump: 248,
        policy: key(0x11),
        destination_owner: key(0x22),
        label: [0x33; 32],
        per_tx_max_override: 0x0102_0304_0506_0708,
        added_at: 0x1112_1314_1516_1718,
        added_by: key(0x44),
        reserved: [0u8; 32],
    };

    let data = encode(&entry);
    assert_eq!(data.len(), 186);

    assert_eq!(data[8], 1, "version");
    assert_eq!(data[9], 248, "bump");
    assert_eq!(&data[10..42], key(0x11).as_ref(), "policy");
    assert_eq!(&data[42..74], key(0x22).as_ref(), "destination_owner");
    assert_eq!(&data[74..106], &[0x33u8; 32], "label");
    assert_eq!(
        u64_at(&data, 106),
        0x0102_0304_0506_0708,
        "per_tx_max_override"
    );
    assert_eq!(i64_at(&data, 114), 0x1112_1314_1516_1718, "added_at");
    assert_eq!(&data[122..154], key(0x44).as_ref(), "added_by");
    assert_eq!(&data[154..186], &[0u8; 32], "reserved");
}

#[test]
fn intent_receipt_field_offsets() {
    let receipt = IntentReceipt {
        version: 1,
        bump: 247,
        session: key(0x11),
        intent_id: [0x22; 16],
        mint: key(0x33),
        destination_owner: key(0x44),
        amount: 0x0102_0304_0506_0708,
        seq: 0x1112_1314_1516_1718,
        slot: 0x2122_2324_2526_2728,
        timestamp: 0x3132_3334_3536_3738,
        expires_at: 0x4142_4344_4546_4748,
        status: 1,
        fee_payer: key(0x55),
        memo_hash: [0x66; 32],
        reserved: [0u8; 16],
    };

    let data = encode(&receipt);
    assert_eq!(data.len(), 243);

    assert_eq!(data[8], 1, "version");
    assert_eq!(data[9], 247, "bump");
    assert_eq!(&data[10..42], key(0x11).as_ref(), "session");
    assert_eq!(&data[42..58], &[0x22u8; 16], "intent_id");
    assert_eq!(&data[58..90], key(0x33).as_ref(), "mint");
    assert_eq!(&data[90..122], key(0x44).as_ref(), "destination_owner");
    assert_eq!(u64_at(&data, 122), 0x0102_0304_0506_0708, "amount");
    assert_eq!(u64_at(&data, 130), 0x1112_1314_1516_1718, "seq");
    assert_eq!(u64_at(&data, 138), 0x2122_2324_2526_2728, "slot");
    assert_eq!(i64_at(&data, 146), 0x3132_3334_3536_3738, "timestamp");
    assert_eq!(i64_at(&data, 154), 0x4142_4344_4546_4748, "expires_at");
    assert_eq!(data[162], 1, "status");
    assert_eq!(&data[163..195], key(0x55).as_ref(), "fee_payer");
    assert_eq!(&data[195..227], &[0x66u8; 32], "memo_hash");
    assert_eq!(&data[227..243], &[0u8; 16], "reserved");
}

/// `intent_id` is a raw 16-byte seed, so the receipt PDA must be sensitive to every byte of
/// it: two intents differing in one bit have to land on different accounts or idempotency
/// degrades into collision.
#[test]
fn receipt_seeds_separate_adjacent_intent_ids() {
    let session = key(0x11);

    let pda = |intent_id: &[u8; 16]| {
        Pubkey::find_program_address(
            &[SEED_RECEIPT, session.as_ref(), intent_id],
            &agent_rails::ID,
        )
        .0
    };

    let base = [0u8; 16];
    let baseline = pda(&base);

    for byte in 0..16 {
        for bit in 0..8 {
            let mut flipped = base;
            flipped[byte] |= 1 << bit;
            assert_ne!(
                pda(&flipped),
                baseline,
                "flipping bit {bit} of intent_id[{byte}] did not move the receipt PDA"
            );
        }
    }
}

/// A receipt may only be reclaimed once the whole grace period past its intent's expiry has
/// elapsed (spec §5.4), because closing it early would reopen the replay window.
#[test]
fn receipt_is_closable_only_after_the_grace_period() {
    let mut receipt = IntentReceipt {
        version: 1,
        bump: 0,
        session: Pubkey::default(),
        intent_id: [0u8; 16],
        mint: Pubkey::default(),
        destination_owner: Pubkey::default(),
        amount: 0,
        seq: 0,
        slot: 0,
        timestamp: 0,
        expires_at: 1_000,
        status: 1,
        fee_payer: Pubkey::default(),
        memo_hash: [0u8; 32],
        reserved: [0u8; 16],
    };

    let closable_at = 1_000 + RECEIPT_GRACE_SECONDS;
    assert!(!receipt.is_closable(1_000), "at expiry, grace has not run");
    assert!(!receipt.is_closable(closable_at - 1));
    assert!(receipt.is_closable(closable_at), "boundary is inclusive");
    assert!(receipt.is_closable(closable_at + 1));

    // A corrupted `expires_at` must fail closed rather than wrap into the past.
    receipt.expires_at = i64::MAX;
    assert!(!receipt.is_closable(i64::MAX));
}

/// An allowlist override may only tighten the policy's per-tx cap (spec §5.3 step 10).
#[test]
fn allowlist_override_only_tightens() {
    let mut entry = AllowlistEntry {
        version: 1,
        bump: 0,
        policy: Pubkey::default(),
        destination_owner: Pubkey::default(),
        label: [0u8; 32],
        per_tx_max_override: 0,
        added_at: 0,
        added_by: Pubkey::default(),
        reserved: [0u8; 32],
    };

    assert_eq!(entry.effective_per_tx(100), 100, "0 means no override");

    entry.per_tx_max_override = 40;
    assert_eq!(entry.effective_per_tx(100), 40);

    entry.per_tx_max_override = 400;
    assert_eq!(entry.effective_per_tx(100), 100, "override cannot loosen");
}
