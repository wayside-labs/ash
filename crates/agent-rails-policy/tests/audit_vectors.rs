//! Pinned vectors for the audit hash chain (spec §6).
//!
//! `programs/agent_rails` hashes [`agent_rails_policy::audit_preimage`] with the
//! `sol_sha256` syscall rather than the software SHA-256 behind the `hash` feature, so the
//! two implementations only agree as long as the preimage layout is fixed. These vectors
//! are that pin: the on-chain side asserts the same digests from an SVM test.

use agent_rails_policy::{
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
fn domain_separator_is_twenty_bytes() {
    assert_eq!(DOMAIN_AUDIT.len(), 20);
    assert_eq!(GENESIS_PREIMAGE_LEN, 52);
    assert_eq!(AUDIT_PREIMAGE_LEN, 156);
}

#[test]
fn genesis_preimage_layout() {
    let preimage = genesis_preimage(&SESSION);
    assert_eq!(&preimage[..20], DOMAIN_AUDIT.as_slice());
    assert_eq!(&preimage[20..52], SESSION.as_slice());
}

#[test]
fn step_preimage_layout() {
    let prev = genesis_audit_head(&SESSION);
    let preimage = audit_preimage(&prev, 1, &INTENT_ID, &MINT, &DESTINATION, 1_000_000, 42);

    assert_eq!(&preimage[..20], DOMAIN_AUDIT.as_slice());
    assert_eq!(&preimage[20..52], prev.as_slice());
    assert_eq!(&preimage[52..60], 1u64.to_le_bytes().as_slice());
    assert_eq!(&preimage[60..76], INTENT_ID.as_slice());
    assert_eq!(&preimage[76..108], MINT.as_slice());
    assert_eq!(&preimage[108..140], DESTINATION.as_slice());
    assert_eq!(&preimage[140..148], 1_000_000u64.to_le_bytes().as_slice());
    assert_eq!(&preimage[148..156], 42u64.to_le_bytes().as_slice());
}

/// Digests produced by an independent implementation of spec §6 (plain `sha256` over the
/// documented byte string), not by this crate. Changing either value means the wire format
/// changed and every already-issued audit chain has been invalidated.
#[test]
fn pinned_digests() {
    let genesis = genesis_audit_head(&SESSION);
    assert_eq!(
        hex(&genesis),
        "d8790fb17ba65a49ca67334e1db9e59e8f968b169c60d484c6545ada311abebe"
    );

    let head_1 = next_audit_head(&genesis, 1, &INTENT_ID, &MINT, &DESTINATION, 1_000_000, 42);
    assert_eq!(
        hex(&head_1),
        "d2e5d4062e81892ac36fddc6072b3a5856756412ed3b74163564fc2d73bebfc0"
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
