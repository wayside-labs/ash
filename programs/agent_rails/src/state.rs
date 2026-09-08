//! Account layouts (spec §3).
//!
//! This module is the byte-level contract between the program, the Codama-generated
//! clients, the indexer, and the test suite. Field order and type are load-bearing: Borsh
//! writes fields back-to-back with no alignment padding, so the absolute offsets in the
//! doc comments below are exactly what an off-chain decoder sees.
//!
//! Every layout is pinned twice. `const _: () = assert!(...)` fails the build if a field is
//! added, removed, or retyped, and `tests/layout.rs` re-checks the same numbers against a
//! real Borsh round-trip. Growing an account is a breaking change unless the bytes come out
//! of its `reserved` block.

use anchor_lang::prelude::*;

use crate::constants::{MintFlags, MAX_GUARDIANS, MAX_MINTS, MAX_NAME_LEN, PROGRAM_VERSION};

/// Length of the Anchor account discriminator that prefixes every account below.
pub const DISCRIMINATOR_LEN: usize = 8;

// ---------------------------------------------------------------------------------------
// Treasury (spec §3.1)
// ---------------------------------------------------------------------------------------

/// The owner's ceiling for one mint: the loosest limits any policy on this treasury may
/// set, and the shortest windows it may use (spec §3.1.1). 40 bytes.
///
/// | Offset | Size | Field |
/// |---|---|---|
/// | 0 | 8 | `max_per_tx` |
/// | 8 | 8 | `max_short_window` |
/// | 16 | 8 | `max_long_window` |
/// | 24 | 8 | `max_lifetime` |
/// | 32 | 4 | `min_short_window_seconds` |
/// | 36 | 4 | `min_long_window_seconds` |
#[derive(
    AnchorSerialize, AnchorDeserialize, InitSpace, Clone, Copy, Debug, Default, PartialEq, Eq,
)]
pub struct MintCeiling {
    pub max_per_tx: u64,
    pub max_short_window: u64,
    pub max_long_window: u64,
    pub max_lifetime: u64,
    pub min_short_window_seconds: u32,
    pub min_long_window_seconds: u32,
}

const _: () = assert!(MintCeiling::INIT_SPACE == 40);

impl MintCeiling {
    pub const LEN: usize = 40;

    /// Solana-free view for the policy crate.
    pub fn to_policy(self) -> agent_rails_policy::MintCeiling {
        agent_rails_policy::MintCeiling {
            max_per_tx: self.max_per_tx,
            max_short_window: self.max_short_window,
            max_long_window: self.max_long_window,
            max_lifetime: self.max_lifetime,
            min_short_window_seconds: self.min_short_window_seconds,
            min_long_window_seconds: self.min_long_window_seconds,
        }
    }
}

/// One configured mint slot on a `Treasury` (spec §3.1.1). 112 bytes.
///
/// | Offset | Size | Field |
/// |---|---|---|
/// | 0 | 32 | `mint` — `NATIVE_MINT` for SOL, `Pubkey::default()` if the slot is unused |
/// | 32 | 32 | `token_program` — SPL Token, Token-2022, or System program for native |
/// | 64 | 1 | `decimals` |
/// | 65 | 1 | `flags` — `MintFlags` bitfield |
/// | 66 | 6 | `_pad` |
/// | 72 | 40 | `ceiling` |
#[derive(
    AnchorSerialize, AnchorDeserialize, InitSpace, Clone, Copy, Debug, Default, PartialEq, Eq,
)]
pub struct MintConfig {
    pub mint: Pubkey,
    pub token_program: Pubkey,
    pub decimals: u8,
    pub flags: u8,
    /// Named `_pad` in the spec; must stay zeroed.
    pub _pad: [u8; 6],
    pub ceiling: MintCeiling,
}

const _: () = assert!(MintConfig::INIT_SPACE == 112);

impl MintConfig {
    pub const LEN: usize = 112;

    /// An unused slot. `Pubkey::default()` is the sentinel, which is why a mint of all
    /// zeros can never be configured.
    pub const EMPTY: Self = Self {
        mint: Pubkey::new_from_array([0u8; 32]),
        token_program: Pubkey::new_from_array([0u8; 32]),
        decimals: 0,
        flags: 0,
        _pad: [0u8; 6],
        ceiling: MintCeiling {
            max_per_tx: 0,
            max_short_window: 0,
            max_long_window: 0,
            max_lifetime: 0,
            min_short_window_seconds: 0,
            min_long_window_seconds: 0,
        },
    };

    pub fn is_used(&self) -> bool {
        self.mint != Pubkey::default()
    }

    pub fn is_native(&self) -> bool {
        self.flags & MintFlags::IS_NATIVE != 0
    }
}

/// Cold-storage root of one treasury (spec §3.1). 944 bytes.
///
/// | Offset | Size | Field |
/// |---|---|---|
/// | 0 | 8 | discriminator |
/// | 8 | 1 | `version` |
/// | 9 | 1 | `bump` |
/// | 10 | 1 | `sol_vault_bump` |
/// | 11 | 32 | `create_key` |
/// | 43 | 32 | `owner` |
/// | 75 | 32 | `operator` |
/// | 107 | 160 | `guardians` |
/// | 267 | 1 | `guardian_count` |
/// | 268 | 1 | `paused` |
/// | 269 | 8 | `paused_at` |
/// | 277 | 32 | `paused_by` |
/// | 309 | 1 | `allow_any_destination` |
/// | 310 | 1 | `allow_create_destination_ata` |
/// | 311 | 8 | `timelock_seconds` (reserved v1.1) |
/// | 319 | 32 | `recovery_destination` (reserved v1.1) |
/// | 351 | 448 | `mints` |
/// | 799 | 1 | `mint_count` |
/// | 800 | 4 | `active_sessions` |
/// | 804 | 4 | `policy_count` |
/// | 808 | 8 | `created_at` |
/// | 816 | 128 | `reserved` |
///
/// PDA: `["treasury", create_key]`.
#[account]
#[derive(InitSpace, Debug)]
pub struct Treasury {
    pub version: u8,
    pub bump: u8,
    pub sol_vault_bump: u8,
    /// Ephemeral keypair that signed `create_treasury` once, then is never used again.
    /// This is what allows unlimited treasuries per owner with no index bookkeeping.
    pub create_key: Pubkey,
    pub owner: Pubkey,
    pub operator: Pubkey,
    /// Unused slots are `Pubkey::default()`.
    pub guardians: [Pubkey; MAX_GUARDIANS],
    pub guardian_count: u8,
    pub paused: bool,
    /// Unix seconds; 0 if never paused.
    pub paused_at: i64,
    pub paused_by: Pubkey,
    /// Ceiling flag for `DestinationMode::Any`.
    pub allow_any_destination: bool,
    /// Ceiling flag for creating destination ATAs from the vault.
    pub allow_create_destination_ata: bool,
    /// Reserved for v1.1. Must be 0 in v1.
    pub timelock_seconds: u64,
    /// Reserved for v1.1. Timelock-exempt withdraw target, fixed at creation.
    pub recovery_destination: Pubkey,
    pub mints: [MintConfig; MAX_MINTS],
    pub mint_count: u8,
    /// Non-revoked, non-closed sessions. Gates `close_treasury`.
    pub active_sessions: u32,
    /// Open policies. Gates `close_treasury`.
    pub policy_count: u32,
    pub created_at: i64,
    pub reserved: [u8; 128],
}

impl Treasury {
    pub const LEN: usize = DISCRIMINATOR_LEN + Self::INIT_SPACE;

    /// Returns the configured slot for `mint`, or `None`.
    pub fn find_mint(&self, mint: &Pubkey) -> Option<&MintConfig> {
        self.mints
            .iter()
            .find(|config| config.is_used() && config.mint == *mint)
    }

    /// Index of the first unused mint slot.
    pub fn free_mint_slot(&self) -> Option<usize> {
        self.mints.iter().position(|config| !config.is_used())
    }

    /// `owner` or `operator`, the "warm or cold" role check used by operator instructions.
    pub fn is_owner_or_operator(&self, key: &Pubkey) -> bool {
        *key == self.owner || *key == self.operator
    }

    pub fn is_guardian(&self, key: &Pubkey) -> bool {
        *key != Pubkey::default() && self.guardians[..self.guardian_count as usize].contains(key)
    }

    /// Writes every field of a freshly created treasury.
    ///
    /// Anchor has already zeroed the account, so most of this is redundant — deliberately
    /// so. Spelling out all 21 fields means adding one to the struct without initializing
    /// it here is a compile error rather than an accidental zero.
    pub fn initialize(&mut self, init: TreasuryInit) {
        let TreasuryInit {
            bump,
            sol_vault_bump,
            create_key,
            owner,
            operator,
            recovery_destination,
            allow_any_destination,
            allow_create_destination_ata,
            created_at,
        } = init;

        *self = Self {
            version: PROGRAM_VERSION,
            bump,
            sol_vault_bump,
            create_key,
            owner,
            operator,
            guardians: [Pubkey::default(); MAX_GUARDIANS],
            guardian_count: 0,
            paused: false,
            paused_at: 0,
            paused_by: Pubkey::default(),
            allow_any_destination,
            allow_create_destination_ata,
            timelock_seconds: 0,
            recovery_destination,
            mints: [MintConfig::EMPTY; MAX_MINTS],
            mint_count: 0,
            active_sessions: 0,
            policy_count: 0,
            created_at,
            reserved: [0u8; 128],
        };
    }
}

/// Arguments to [`Treasury::initialize`], grouped so the call site names each value.
pub struct TreasuryInit {
    pub bump: u8,
    pub sol_vault_bump: u8,
    pub create_key: Pubkey,
    pub owner: Pubkey,
    pub operator: Pubkey,
    pub recovery_destination: Pubkey,
    pub allow_any_destination: bool,
    pub allow_create_destination_ata: bool,
    pub created_at: i64,
}

const _: () = assert!(Treasury::LEN == 944);

// ---------------------------------------------------------------------------------------
// Policy (spec §3.2)
// ---------------------------------------------------------------------------------------

/// Per-mint spending limits an operator sets on a policy (spec §3.2.1). 96 bytes.
///
/// | Offset | Size | Field |
/// |---|---|---|
/// | 0 | 32 | `mint` |
/// | 32 | 8 | `per_tx_max` |
/// | 40 | 8 | `short_window_max` |
/// | 48 | 4 | `short_window_seconds` |
/// | 52 | 8 | `long_window_max` |
/// | 60 | 4 | `long_window_seconds` |
/// | 64 | 8 | `lifetime_max` |
/// | 72 | 8 | `approval_threshold` (reserved v1.1) |
/// | 80 | 4 | `cooldown_seconds` (reserved v1.1) |
/// | 84 | 12 | `reserved` |
#[derive(
    AnchorSerialize, AnchorDeserialize, InitSpace, Clone, Copy, Debug, Default, PartialEq, Eq,
)]
pub struct MintLimit {
    pub mint: Pubkey,
    pub per_tx_max: u64,
    pub short_window_max: u64,
    pub short_window_seconds: u32,
    pub long_window_max: u64,
    pub long_window_seconds: u32,
    /// Per session. `u64::MAX` means unlimited, and still has to fit under the ceiling.
    pub lifetime_max: u64,
    /// Reserved for v1.1. Must be 0 in v1.
    pub approval_threshold: u64,
    /// Reserved for v1.1. Must be 0 in v1.
    pub cooldown_seconds: u32,
    pub reserved: [u8; 12],
}

const _: () = assert!(MintLimit::INIT_SPACE == 96);

impl MintLimit {
    pub const LEN: usize = 96;

    pub const EMPTY: Self = Self {
        mint: Pubkey::new_from_array([0u8; 32]),
        per_tx_max: 0,
        short_window_max: 0,
        short_window_seconds: 0,
        long_window_max: 0,
        long_window_seconds: 0,
        lifetime_max: 0,
        approval_threshold: 0,
        cooldown_seconds: 0,
        reserved: [0u8; 12],
    };

    pub fn is_used(&self) -> bool {
        self.mint != Pubkey::default()
    }

    /// Solana-free view for the policy crate. The v1.1 fields are intentionally dropped:
    /// they are validated as zero at the Anchor layer and have no policy semantics in v1.
    pub fn to_policy(&self) -> agent_rails_policy::MintLimit {
        agent_rails_policy::MintLimit {
            mint: self.mint.to_bytes(),
            per_tx_max: self.per_tx_max,
            short_window_max: self.short_window_max,
            short_window_seconds: self.short_window_seconds,
            long_window_max: self.long_window_max,
            long_window_seconds: self.long_window_seconds,
            lifetime_max: self.lifetime_max,
        }
    }
}

/// A named, operator-owned spending policy under one treasury (spec §3.2). 546 bytes.
///
/// | Offset | Size | Field |
/// |---|---|---|
/// | 0 | 8 | discriminator |
/// | 8 | 1 | `version` |
/// | 9 | 1 | `bump` |
/// | 10 | 32 | `treasury` |
/// | 42 | 32 | `name` |
/// | 74 | 384 | `mint_limits` |
/// | 458 | 1 | `mint_count` |
/// | 459 | 1 | `destination_mode` |
/// | 460 | 1 | `require_memo` |
/// | 461 | 1 | `create_destination_ata` |
/// | 462 | 4 | `active_sessions` |
/// | 466 | 8 | `created_at` |
/// | 474 | 8 | `updated_at` |
/// | 482 | 64 | `reserved` |
///
/// PDA: `["policy", treasury, name]`.
#[account]
#[derive(InitSpace, Debug)]
pub struct Policy {
    pub version: u8,
    pub bump: u8,
    pub treasury: Pubkey,
    /// 32-byte zero-padded UTF-8; also a seed component.
    pub name: [u8; MAX_NAME_LEN],
    pub mint_limits: [MintLimit; MAX_MINTS],
    pub mint_count: u8,
    /// `DestinationMode`.
    pub destination_mode: u8,
    pub require_memo: bool,
    /// Requires the matching treasury ceiling flag.
    pub create_destination_ata: bool,
    /// Gates `close_policy`.
    pub active_sessions: u32,
    pub created_at: i64,
    pub updated_at: i64,
    pub reserved: [u8; 64],
}

impl Policy {
    pub const LEN: usize = DISCRIMINATOR_LEN + Self::INIT_SPACE;

    pub fn find_limit(&self, mint: &Pubkey) -> Option<&MintLimit> {
        self.mint_limits
            .iter()
            .find(|limit| limit.is_used() && limit.mint == *mint)
    }
}

const _: () = assert!(Policy::LEN == 546);

// ---------------------------------------------------------------------------------------
// AgentSession (spec §3.3)
// ---------------------------------------------------------------------------------------

/// Rolling spend state for one mint inside one session (spec §3.3.1). 80 bytes.
///
/// | Offset | Size | Field |
/// |---|---|---|
/// | 0 | 32 | `mint` |
/// | 32 | 8 | `short_window_start` |
/// | 40 | 8 | `short_spent` |
/// | 48 | 8 | `long_window_start` |
/// | 56 | 8 | `long_spent` |
/// | 64 | 8 | `lifetime_spent` |
/// | 72 | 8 | `last_payment_at` |
///
/// Counters are looked up by `mint`, never by index, so reordering a policy's slots cannot
/// misattribute spend.
#[derive(
    AnchorSerialize, AnchorDeserialize, InitSpace, Clone, Copy, Debug, Default, PartialEq, Eq,
)]
pub struct SpendCounter {
    pub mint: Pubkey,
    pub short_window_start: i64,
    pub short_spent: u64,
    pub long_window_start: i64,
    pub long_spent: u64,
    pub lifetime_spent: u64,
    pub last_payment_at: i64,
}

const _: () = assert!(SpendCounter::INIT_SPACE == 80);

impl SpendCounter {
    pub const LEN: usize = 80;

    pub const EMPTY: Self = Self {
        mint: Pubkey::new_from_array([0u8; 32]),
        short_window_start: 0,
        short_spent: 0,
        long_window_start: 0,
        long_spent: 0,
        lifetime_spent: 0,
        last_payment_at: 0,
    };

    pub fn is_used(&self) -> bool {
        self.mint != Pubkey::default()
    }

    pub fn to_policy(&self) -> agent_rails_policy::SpendCounter {
        agent_rails_policy::SpendCounter {
            mint: self.mint.to_bytes(),
            short_window_start: self.short_window_start,
            short_spent: self.short_spent,
            long_window_start: self.long_window_start,
            long_spent: self.long_spent,
            lifetime_spent: self.lifetime_spent,
            last_payment_at: self.last_payment_at,
        }
    }

    pub fn from_policy(counter: &agent_rails_policy::SpendCounter) -> Self {
        Self {
            mint: Pubkey::new_from_array(counter.mint),
            short_window_start: counter.short_window_start,
            short_spent: counter.short_spent,
            long_window_start: counter.long_window_start,
            long_spent: counter.long_spent,
            lifetime_spent: counter.lifetime_spent,
            last_payment_at: counter.last_payment_at,
        }
    }
}

/// A revocable, time-boxed delegation of spending authority to one agent key
/// (spec §3.3). 588 bytes.
///
/// | Offset | Size | Field |
/// |---|---|---|
/// | 0 | 8 | discriminator |
/// | 8 | 1 | `version` |
/// | 9 | 1 | `bump` |
/// | 10 | 32 | `treasury` |
/// | 42 | 32 | `policy` |
/// | 74 | 32 | `session_key` |
/// | 106 | 1 | `auth_mode` |
/// | 107 | 32 | `label` |
/// | 139 | 8 | `created_at` |
/// | 147 | 8 | `expires_at` |
/// | 155 | 1 | `revoked` |
/// | 156 | 8 | `revoked_at` |
/// | 164 | 8 | `seq` |
/// | 172 | 32 | `audit_head` |
/// | 204 | 320 | `spend` |
/// | 524 | 64 | `reserved` |
///
/// PDA: `["session", treasury, session_key]`. Rotation means a new key, never a mutation.
#[account]
#[derive(InitSpace, Debug)]
pub struct AgentSession {
    pub version: u8,
    pub bump: u8,
    pub treasury: Pubkey,
    pub policy: Pubkey,
    /// Seed component, and the signer in `AuthMode::DirectSigner`.
    pub session_key: Pubkey,
    /// `AuthMode`; must be 0 in v1.
    pub auth_mode: u8,
    /// Human label, e.g. `"billing-agent-prod"`.
    pub label: [u8; MAX_NAME_LEN],
    pub created_at: i64,
    pub expires_at: i64,
    pub revoked: bool,
    pub revoked_at: i64,
    /// Executed payments; starts at 0 and increases by exactly 1 per payment.
    pub seq: u64,
    /// Head of the audit hash chain (spec §6).
    pub audit_head: [u8; 32],
    /// Index-aligned with `Policy.mint_limits` at creation, but always looked up by mint.
    pub spend: [SpendCounter; MAX_MINTS],
    pub reserved: [u8; 64],
}

impl AgentSession {
    pub const LEN: usize = DISCRIMINATOR_LEN + Self::INIT_SPACE;

    pub fn find_counter(&self, mint: &Pubkey) -> Option<usize> {
        self.spend
            .iter()
            .position(|counter| counter.is_used() && counter.mint == *mint)
    }

    /// Index of the counter for `mint`, allocating a free slot if the mint was added to the
    /// policy after this session was created. `None` means every slot is taken by another
    /// mint, which the caller reports as `MintNotInSession`.
    pub fn find_or_insert_counter(&mut self, mint: &Pubkey) -> Option<usize> {
        if let Some(index) = self.find_counter(mint) {
            return Some(index);
        }
        let index = self.spend.iter().position(|counter| !counter.is_used())?;
        self.spend[index] = SpendCounter {
            mint: *mint,
            ..SpendCounter::EMPTY
        };
        Some(index)
    }

    pub fn is_active(&self, now: i64) -> bool {
        !self.revoked && now < self.expires_at
    }
}

const _: () = assert!(AgentSession::LEN == 588);

// ---------------------------------------------------------------------------------------
// AllowlistEntry (spec §3.4)
// ---------------------------------------------------------------------------------------

/// One approved destination for a policy (spec §3.4). 186 bytes.
///
/// | Offset | Size | Field |
/// |---|---|---|
/// | 0 | 8 | discriminator |
/// | 8 | 1 | `version` |
/// | 9 | 1 | `bump` |
/// | 10 | 32 | `policy` |
/// | 42 | 32 | `destination_owner` |
/// | 74 | 32 | `label` |
/// | 106 | 8 | `per_tx_max_override` |
/// | 114 | 8 | `added_at` |
/// | 122 | 32 | `added_by` |
/// | 154 | 32 | `reserved` |
///
/// PDA: `["allow", policy, destination_owner]`. Keyed by the wallet owner and never by a
/// token account, so one entry covers every mint.
#[account]
#[derive(InitSpace, Debug)]
pub struct AllowlistEntry {
    pub version: u8,
    pub bump: u8,
    pub policy: Pubkey,
    /// Wallet owner (system account); the ATA is derived on-chain at payment time.
    pub destination_owner: Pubkey,
    /// e.g. `"openai-billing"`.
    pub label: [u8; MAX_NAME_LEN],
    /// 0 means no override; otherwise it must be `≤` the policy's `per_tx_max`.
    pub per_tx_max_override: u64,
    pub added_at: i64,
    pub added_by: Pubkey,
    pub reserved: [u8; 32],
}

impl AllowlistEntry {
    pub const LEN: usize = DISCRIMINATOR_LEN + Self::INIT_SPACE;

    /// The per-tx cap this entry imposes on `limit`. An override can only tighten.
    pub fn effective_per_tx(&self, policy_per_tx_max: u64) -> u64 {
        if self.per_tx_max_override == 0 {
            policy_per_tx_max
        } else {
            self.per_tx_max_override.min(policy_per_tx_max)
        }
    }
}

const _: () = assert!(AllowlistEntry::LEN == 186);
