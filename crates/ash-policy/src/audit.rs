//! The per-session audit hash chain (spec §6).
//!
//! Each executed payment folds its own identity into a running head, so an auditor can
//! replay `PaymentExecuted` events ordered by `seq` and compare the result with
//! `AgentSession.audit_head`. Any omitted, reordered, or forged event breaks the chain.
//!
//! The preimage builders are the shared primitive: on-chain the program hands
//! [`audit_preimage`] to the `sol_sha256` syscall, off-chain the `hash` feature does the
//! same bytes in software. Both paths are pinned to the same vectors in
//! `tests/audit_vectors.rs`.

use crate::types::Key;

/// Domain separator for the audit chain, 12 bytes.
pub const DOMAIN_AUDIT: &[u8; 12] = b"ash/audit/v1";

/// Domain separator reserved for v1.1 signed-intent mode, 13 bytes. Documented in v1 so
/// SDKs can already produce the message that v1.1 will verify.
pub const DOMAIN_INTENT: &[u8; 13] = b"ash/intent/v1";

/// `DOMAIN_AUDIT ‖ session_pubkey`.
pub const GENESIS_PREIMAGE_LEN: usize = 12 + 32;

/// `DOMAIN_AUDIT ‖ prev ‖ seq ‖ intent_id ‖ mint ‖ destination_owner ‖ amount ‖ slot`.
pub const AUDIT_PREIMAGE_LEN: usize = 12 + 32 + 8 + 16 + 32 + 32 + 8 + 8;

/// Bytes hashed to produce the genesis head of a session's chain.
pub fn genesis_preimage(session: &Key) -> [u8; GENESIS_PREIMAGE_LEN] {
    let mut buf = [0u8; GENESIS_PREIMAGE_LEN];
    let mut w = Writer::new(&mut buf);
    w.push(DOMAIN_AUDIT);
    w.push(session);
    buf
}

/// Bytes hashed to advance the chain by one executed payment. `seq` is the value *after*
/// the increment, so the first payment of a session commits `seq == 1`.
#[allow(clippy::too_many_arguments)]
pub fn audit_preimage(
    prev: &Key,
    seq: u64,
    intent_id: &[u8; 16],
    mint: &Key,
    destination_owner: &Key,
    amount: u64,
    slot: u64,
) -> [u8; AUDIT_PREIMAGE_LEN] {
    let mut buf = [0u8; AUDIT_PREIMAGE_LEN];
    let mut w = Writer::new(&mut buf);
    w.push(DOMAIN_AUDIT);
    w.push(prev);
    w.push(&seq.to_le_bytes());
    w.push(intent_id);
    w.push(mint);
    w.push(destination_owner);
    w.push(&amount.to_le_bytes());
    w.push(&slot.to_le_bytes());
    buf
}

/// Append-only cursor over a fixed buffer. Sized exactly by the `*_PREIMAGE_LEN` constants,
/// so a mismatch between them and the fields written is caught by the debug assertion in
/// [`Writer::push`] rather than silently producing a short hash.
struct Writer<'a> {
    buf: &'a mut [u8],
    at: usize,
}

impl<'a> Writer<'a> {
    fn new(buf: &'a mut [u8]) -> Self {
        Self { buf, at: 0 }
    }

    fn push(&mut self, bytes: &[u8]) {
        let end = self.at.saturating_add(bytes.len());
        debug_assert!(end <= self.buf.len(), "audit preimage buffer overflow");
        self.buf[self.at..end].copy_from_slice(bytes);
        self.at = end;
    }
}

#[cfg(feature = "hash")]
mod hashing {
    use super::{audit_preimage, genesis_preimage, Key};
    use sha2::{Digest, Sha256};

    fn sha256(bytes: &[u8]) -> Key {
        let mut hasher = Sha256::new();
        hasher.update(bytes);
        hasher.finalize().into()
    }

    /// `audit_head_0 = sha256(DOMAIN_AUDIT ‖ session_pubkey)`.
    pub fn genesis_audit_head(session: &Key) -> Key {
        sha256(&genesis_preimage(session))
    }

    /// `audit_head_n = sha256(DOMAIN_AUDIT ‖ head_{n-1} ‖ seq ‖ intent_id ‖ mint ‖ dest ‖ amount ‖ slot)`.
    #[allow(clippy::too_many_arguments)]
    pub fn next_audit_head(
        prev: &Key,
        seq: u64,
        intent_id: &[u8; 16],
        mint: &Key,
        destination_owner: &Key,
        amount: u64,
        slot: u64,
    ) -> Key {
        sha256(&audit_preimage(
            prev,
            seq,
            intent_id,
            mint,
            destination_owner,
            amount,
            slot,
        ))
    }
}

#[cfg(feature = "hash")]
pub use hashing::{genesis_audit_head, next_audit_head};
