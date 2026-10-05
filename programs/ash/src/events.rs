//! Events, emitted via `emit_cpi!` so they survive log truncation (spec §8).
//!
//! Every variant carries `treasury` and `schema_version` so an indexer can route and
//! version a record without joining against anything else.

use anchor_lang::prelude::*;

use crate::constants::{INTENT_ID_LEN, MAX_NAME_LEN};
use crate::state::MintCeiling;

/// Bumped whenever an event's field set changes in a non-additive way.
pub const EVENT_SCHEMA_VERSION: u8 = 1;

#[event]
pub struct TreasuryCreated {
    pub treasury: Pubkey,
    pub schema_version: u8,
    pub owner: Pubkey,
    pub operator: Pubkey,
    pub recovery_destination: Pubkey,
}

#[event]
pub struct MintAdded {
    pub treasury: Pubkey,
    pub schema_version: u8,
    pub mint: Pubkey,
    pub token_program: Pubkey,
    pub flags: u8,
    pub ceiling: MintCeiling,
}

/// One executed agent payment (spec §8).
///
/// `seq` and `audit_head` are what make the log verifiable: an indexer replays these
/// events ordered by `seq`, recomputes the chain with
/// `ash_policy::next_audit_head`, and compares the terminus against
/// `AgentSession.audit_head`. A dropped, reordered, or forged event breaks the hash; a
/// dropped event is additionally visible as a gap in `seq` without hashing anything.
#[event]
pub struct PaymentExecuted {
    pub treasury: Pubkey,
    pub schema_version: u8,
    pub session: Pubkey,
    /// The session sequence number *after* this payment, so the first is 1.
    pub seq: u64,
    pub audit_head: [u8; 32],
    pub intent_id: [u8; INTENT_ID_LEN],
    pub mint: Pubkey,
    pub destination_owner: Pubkey,
    /// Debited from the vault, before any Token-2022 transfer fee.
    pub amount: u64,
    pub slot: u64,
    pub memo_hash: [u8; 32],
    pub receipt: Pubkey,
}

/// A new named rule set under a treasury (spec §8).
///
/// `limits_hash` commits to the exact `PolicyInput` the operator submitted, so an auditor
/// can prove which rules were in force at a point in time without the indexer having to
/// store every limit — and without trusting that a later `update_policy` did not rewrite
/// history.
#[event]
pub struct PolicyCreated {
    pub treasury: Pubkey,
    pub schema_version: u8,
    pub policy: Pubkey,
    pub name: [u8; MAX_NAME_LEN],
    pub limits_hash: [u8; 32],
}

/// A policy account reclaimed. Carries no `limits_hash`: there are no `PolicyInput` to
/// commit to, and the rules that were in force are already on record from `PolicyCreated`.
#[event]
pub struct PolicyClosed {
    pub treasury: Pubkey,
    pub schema_version: u8,
    pub policy: Pubkey,
    pub name: [u8; MAX_NAME_LEN],
}

#[event]
pub struct AllowlistEntryAdded {
    pub treasury: Pubkey,
    pub schema_version: u8,
    pub policy: Pubkey,
    pub destination_owner: Pubkey,
    pub label: [u8; MAX_NAME_LEN],
    pub per_tx_max_override: u64,
}

#[event]
pub struct AllowlistEntryRemoved {
    pub treasury: Pubkey,
    pub schema_version: u8,
    pub policy: Pubkey,
    pub destination_owner: Pubkey,
    pub label: [u8; MAX_NAME_LEN],
    pub per_tx_max_override: u64,
}

#[event]
pub struct SessionCreated {
    pub treasury: Pubkey,
    pub schema_version: u8,
    pub session: Pubkey,
    pub policy: Pubkey,
    pub session_key: Pubkey,
    pub label: [u8; MAX_NAME_LEN],
    pub expires_at: i64,
    pub auth_mode: u8,
}

/// Carries `seq` and `audit_head` so the chain has a witnessed terminus even if the session
/// account is closed before an indexer catches up.
#[event]
pub struct SessionRevoked {
    pub treasury: Pubkey,
    pub schema_version: u8,
    pub session: Pubkey,
    pub by: Pubkey,
    pub seq: u64,
    pub audit_head: [u8; 32],
}

/// The last word on a session's audit chain: after this the account is gone, and this event
/// is the only remaining on-chain proof of where the chain ended.
#[event]
pub struct SessionClosed {
    pub treasury: Pubkey,
    pub schema_version: u8,
    pub session: Pubkey,
    pub seq: u64,
    pub audit_head: [u8; 32],
}

/// A policy's rules rewritten in place (spec §8).
///
/// Carries *both* digests, per spec §5.2: `previous_limits_hash` lets an indexer verify it
/// has not missed a revision, the same way `AgentSession.seq` does for payments. The policy
/// address and `name` are stable across revisions, so the two chain cleanly.
#[event]
pub struct PolicyUpdated {
    pub treasury: Pubkey,
    pub schema_version: u8,
    pub policy: Pubkey,
    pub name: [u8; MAX_NAME_LEN],
    pub previous_limits_hash: [u8; 32],
    pub limits_hash: [u8; 32],
}

/// An owner-set ceiling changed (spec §8).
///
/// Both treasury-wide destination flags ride along because they are part of the same
/// bound: a policy is legal only if its limits fit the per-mint ceiling *and* its
/// destination mode fits these.
#[event]
pub struct CeilingUpdated {
    pub treasury: Pubkey,
    pub schema_version: u8,
    pub mint: Pubkey,
    pub ceiling: MintCeiling,
    pub allow_any_destination: bool,
    pub allow_create_destination_ata: bool,
}

/// A mint's settlement switched from `IsolatedVault` to `NativeAllowance` (ADR-014).
/// Owner-only, one-way in v1: there is no `disable_native_allowance` — reverting means
/// removing and re-adding the mint. `native_delegation` and `subscription_authority` are
/// the native program's own PDAs, included so an indexer can join against its events too.
#[event]
pub struct NativeAllowanceEnabled {
    pub treasury: Pubkey,
    pub schema_version: u8,
    pub mint: Pubkey,
    pub subscription_authority: Pubkey,
    pub native_delegation: Pubkey,
    pub amount_cap: u64,
    pub expiry_ts: i64,
}

#[event]
pub struct MintRemoved {
    pub treasury: Pubkey,
    pub schema_version: u8,
    pub mint: Pubkey,
    pub token_program: Pubkey,
    pub flags: u8,
}

#[event]
pub struct RolesUpdated {
    pub treasury: Pubkey,
    pub schema_version: u8,
    pub owner: Pubkey,
    pub operator: Pubkey,
}

#[event]
pub struct GuardianAdded {
    pub treasury: Pubkey,
    pub schema_version: u8,
    pub guardian: Pubkey,
}

#[event]
pub struct GuardianRemoved {
    pub treasury: Pubkey,
    pub schema_version: u8,
    pub guardian: Pubkey,
}

#[event]
pub struct TreasuryPaused {
    pub treasury: Pubkey,
    pub schema_version: u8,
    pub by: Pubkey,
    pub at: i64,
}

#[event]
pub struct TreasuryUnpaused {
    pub treasury: Pubkey,
    pub schema_version: u8,
    pub by: Pubkey,
    pub at: i64,
}

/// Owner withdrawal of vault funds (spec §8). `destination` is the token account for SPL
/// and the system account for native SOL — the account that actually received the funds.
#[event]
pub struct Withdrawn {
    pub treasury: Pubkey,
    pub schema_version: u8,
    pub mint: Pubkey,
    pub amount: u64,
    pub destination: Pubkey,
    pub by: Pubkey,
}

#[event]
pub struct TreasuryClosed {
    pub treasury: Pubkey,
    pub schema_version: u8,
}

/// A receipt reclaimed after `expires_at + RECEIPT_GRACE_SECONDS` (spec §8).
///
/// `treasury` is `Pubkey::default()`. `close_receipt` is permissionless and must succeed
/// after the session — and even the treasury — has been closed, so the instruction has
/// neither account. Indexers should route this variant on `session`.
#[event]
pub struct ReceiptClosed {
    pub treasury: Pubkey,
    pub schema_version: u8,
    pub session: Pubkey,
    pub intent_id: [u8; INTENT_ID_LEN],
    pub receipt: Pubkey,
}
