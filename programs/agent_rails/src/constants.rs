//! Program-wide constants and PDA seeds (spec §1 and §2).
//!
//! Seeds are ASCII literals without a trailing NUL. Every bump is stored on the account it
//! belongs to and re-verified with `seeds = [...], bump = account.bump`.

use anchor_lang::prelude::*;

/// Written into the `version` field of every account this program creates.
pub const PROGRAM_VERSION: u8 = 1;

/// Fixed guardian slots in a `Treasury`.
pub const MAX_GUARDIANS: usize = 5;

/// Fixed mint slots in a `Treasury` and a `Policy`.
pub const MAX_MINTS: usize = agent_rails_policy::MAX_MINTS;

/// Maximum `PaymentIntent.memo` length, in bytes.
pub const MAX_MEMO_LEN: usize = 64;

/// Maximum length of a policy name or label; UTF-8, zero-padded.
pub const MAX_NAME_LEN: usize = 32;

/// Upper bound on `intent.expires_at - now`.
pub const MAX_INTENT_TTL_SECONDS: i64 = 3_600;

/// Lower bound on `intent.expires_at - now`; guards against pre-expired intents.
pub const MIN_INTENT_TTL_SECONDS: i64 = 5;

/// `close_receipt` is permitted once `now ≥ receipt.expires_at + RECEIPT_GRACE_SECONDS`.
pub const RECEIPT_GRACE_SECONDS: i64 = 3_600;

/// Lower bound on any configurable window duration.
pub const MIN_WINDOW_SECONDS: u32 = agent_rails_policy::MIN_WINDOW_SECONDS;

/// 365 days; upper bound on `create_session`.
pub const MAX_SESSION_TTL_SECONDS: i64 = 31_536_000;

/// Sentinel mint for native SOL in `MintConfig`, `MintLimit`, and `SpendCounter`.
pub const NATIVE_MINT: Pubkey =
    Pubkey::from_str_const("So11111111111111111111111111111111111111112");

pub const SEED_TREASURY: &[u8] = b"treasury";
pub const SEED_SOL_VAULT: &[u8] = b"sol_vault";
pub const SEED_POLICY: &[u8] = b"policy";
pub const SEED_ALLOWLIST: &[u8] = b"allow";
pub const SEED_SESSION: &[u8] = b"session";
pub const SEED_RECEIPT: &[u8] = b"receipt";

/// Bitfield stored in `MintConfig.flags` (spec §1).
pub struct MintFlags;

impl MintFlags {
    pub const IS_NATIVE: u8 = 1 << 0;
    pub const HAS_TRANSFER_FEE: u8 = 1 << 1;
    pub const HAS_PERMANENT_DELEGATE: u8 = 1 << 2;
}

/// `AgentSession.auth_mode` (spec §1). Only `DirectSigner` is accepted in v1.
pub struct AuthMode;

impl AuthMode {
    pub const DIRECT_SIGNER: u8 = 0;
    /// Reserved for v1.1.
    pub const SIGNED_INTENT: u8 = 1;
}

/// `IntentReceipt.status` (spec §1).
pub struct ReceiptStatus;

impl ReceiptStatus {
    pub const EXECUTED: u8 = 1;
}
