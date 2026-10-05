//! Pinned vectors for the audit hash chain (spec §6).
//!
//! `programs/ash` hashes [`ash_policy::audit_preimage`] with the
//! `sol_sha256` syscall rather than the software SHA-256 behind the `hash` feature, so the
//! two implementations only agree as long as the preimage layout is fixed. These vectors
//! are that pin: the on-chain side asserts the same digests from an SVM test.

use ash_policy::{
    audit_preimage, genesis_audit_head, genesis_preimage, next_audit_head, AUDIT_PREIMAGE_LEN,
    DOMAIN_AUDIT, GENESIS_PREIMAGE_LEN,
};

const SESSION: [u8; 32] = [7u8; 32];
const MINT: [u8; 32] = [3u8; 32];
const DESTINATION: [u8; 32] = [9u8; 32];
const INTENT_ID: [u8; 16] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16];

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

#[test]
fn domain_separator_is_twelve_bytes() {
    assert_eq!(DOMAIN_AUDIT.len(), 12);
    assert_eq!(GENESIS_PREIMAGE_LEN, 44);
    assert_eq!(AUDIT_PREIMAGE_LEN, 148);
}

#[test]
fn genesis_preimage_layout() {
    let preimage = genesis_preimage(&SESSION);
    assert_eq!(&preimage[..12], DOMAIN_AUDIT.as_slice());
    assert_eq!(&preimage[12..44], SESSION.as_slice());
}

#[test]
fn step_preimage_layout() {
    let prev = genesis_audit_head(&SESSION);
    let preimage = audit_preimage(&prev, 1, &INTENT_ID, &MINT, &DESTINATION, 1_000_000, 42);

    assert_eq!(&preimage[..12], DOMAIN_AUDIT.as_slice());
    assert_eq!(&preimage[12..44], prev.as_slice());
    assert_eq!(&preimage[44..52], 1u64.to_le_bytes().as_slice());
    assert_eq!(&preimage[52..68], INTENT_ID.as_slice());
    assert_eq!(&preimage[68..100], MINT.as_slice());
    assert_eq!(&preimage[100..132], DESTINATION.as_slice());
    assert_eq!(&preimage[132..140], 1_000_000u64.to_le_bytes().as_slice());
    assert_eq!(&preimage[140..148], 42u64.to_le_bytes().as_slice());
}

/// Digests produced by an independent implementation of spec §6 (plain `sha256` over the
/// documented byte string), not by this crate. Changing either value means the wire format
/// changed and every already-issued audit chain has been invalidated.
#[test]
fn pinned_digests() {
    let genesis = genesis_audit_head(&SESSION);
    assert_eq!(
        hex(&genesis),
        "7a4ed8d8a19905354e9acd29e1ec655116c461592dbe033b14f45cd95bc41738"
    );

    let head_1 = next_audit_head(&genesis, 1, &INTENT_ID, &MINT, &DESTINATION, 1_000_000, 42);
    assert_eq!(
        hex(&head_1),
        "6626e677809c46289ef5bc8c0634e18a57b98adff307a5fd04bc4afc1a7e5b5b"
    );
}

/// Reordering two payments must produce a different terminal head — this is the property
/// `verifyChain` relies on.
#[test]
fn chain_is_order_sensitive() {
    let genesis = genesis_audit_head(&SESSION);
    let other_intent = [17u8; 16];

    let forward = {
        let h = next_audit_head(&genesis, 1, &INTENT_ID, &MINT, &DESTINATION, 10, 1);
        next_audit_head(&h, 2, &other_intent, &MINT, &DESTINATION, 20, 2)
    };
    let reversed = {
        let h = next_audit_head(&genesis, 1, &other_intent, &MINT, &DESTINATION, 20, 2);
        next_audit_head(&h, 2, &INTENT_ID, &MINT, &DESTINATION, 10, 1)
    };

    assert_ne!(forward, reversed);
}

/// Two sessions never share a genesis head, so receipts cannot be replayed across sessions.
#[test]
fn genesis_is_session_bound() {
    assert_ne!(
        genesis_audit_head(&[7u8; 32]),
        genesis_audit_head(&[8u8; 32])
    );
}
