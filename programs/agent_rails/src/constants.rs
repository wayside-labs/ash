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

/// Length of `PaymentIntent.intent_id`, which is also a raw `IntentReceipt` seed.
pub const INTENT_ID_LEN: usize = 16;

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

/// The Solana Foundation's native Subscriptions & Allowances program
/// (`github.com/solana-foundation/subscriptions`, IDL v0.5.0, audited by Cantina/Spearbit).
/// Not an Anchor program: Pinocchio-based, single-byte instruction discriminators, no
/// Borsh vec-length prefixes. See `native_allowance.rs`.
pub const NATIVE_SUBSCRIPTIONS_PROGRAM: Pubkey =
    Pubkey::from_str_const("De1egAFMkMWZSN5rYXRj9CAdheBamobVNubTsi9avR44");

/// Native PDA seed prefix for `SubscriptionAuthority`: `[seed, user, token_mint]`.
pub const SEED_NATIVE_SUBSCRIPTION_AUTHORITY: &[u8] = b"SubscriptionAuthority";
/// Native PDA seed prefix for `FixedDelegation`:
/// `[seed, subscription_authority, delegator, delegatee, nonce_le]`.
pub const SEED_NATIVE_DELEGATION: &[u8] = b"delegation";
/// Native PDA seed for the program's self-CPI event authority (no variable seeds).
pub const SEED_NATIVE_EVENT_AUTHORITY: &[u8] = b"event_authority";

/// Agent Rails only ever maintains one active `FixedDelegation` per (treasury, mint).
/// The native program's `nonce` seed exists to let one (authority, delegator, delegatee)
/// tuple hold several concurrent delegations; Agent Rails doesn't need that — rotating a
/// native allowance means revoke-then-recreate, the same "new PDA, never a mutation"
/// pattern `AgentSession` already uses for session rotation. Fixing this at 0 means no
/// extra state to store, and `MintConfig` does not have to grow to hold it.
pub const NATIVE_ALLOWANCE_NONCE: u64 = 0;

/// Native instruction discriminators (offset 0 of instruction data; verified against the
/// published Codama IDL, `idl/subscriptions.json`).
pub const NATIVE_IX_INIT_SUBSCRIPTION_AUTHORITY: u8 = 0;
pub const NATIVE_IX_CREATE_FIXED_DELEGATION: u8 = 1;
pub const NATIVE_IX_TRANSFER_FIXED: u8 = 4;

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
