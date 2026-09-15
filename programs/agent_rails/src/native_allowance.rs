//! Raw CPI into the native Solana Subscriptions & Allowances program (ADR-014).
//!
//! That program (`NATIVE_SUBSCRIPTIONS_PROGRAM`) is Pinocchio-based, not Anchor: every
//! instruction is a single leading discriminator byte followed by a fixed, C-packed,
//! little-endian payload — no 8-byte Anchor discriminator, no Borsh vec-length prefix.
//! Building instructions by hand here keeps the byte layout auditable against the
//! published Codama IDL (`idl/subscriptions.json` in `github.com/solana-foundation/subscriptions`,
//! v0.5.0) rather than trusting an unaudited-by-us client crate's builder surface.
//!
//! Three entry points, matching the three native instructions this program calls:
//! - [`init_subscription_authority`] and [`create_fixed_delegation`] — owner-signed,
//!   one-time setup, called only from `enable_native_allowance`.
//! - [`transfer_fixed`] — the payment-time pull, called only from `execute_payment`'s
//!   `FundingMode::NativeAllowance` branch, signed by the Treasury PDA and never by the
//!   agent's session key (see the module doc on `execute_payment` for why that split is
//!   the load-bearing security property of this whole feature).

use anchor_lang::prelude::*;
use anchor_lang::solana_program::instruction::{AccountMeta, Instruction};
use anchor_lang::solana_program::program::{invoke, invoke_signed};

use crate::constants::{
    NATIVE_IX_CREATE_FIXED_DELEGATION, NATIVE_IX_INIT_SUBSCRIPTION_AUTHORITY,
    NATIVE_IX_TRANSFER_FIXED, NATIVE_SUBSCRIPTIONS_PROGRAM, SEED_NATIVE_DELEGATION,
    SEED_NATIVE_EVENT_AUTHORITY, SEED_NATIVE_SUBSCRIPTION_AUTHORITY,
};
use crate::error::AgentRailsError;

// ---------------------------------------------------------------------------------------
// PDA derivation
// ---------------------------------------------------------------------------------------

pub fn find_subscription_authority(owner: &Pubkey, mint: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[
            SEED_NATIVE_SUBSCRIPTION_AUTHORITY,
            owner.as_ref(),
            mint.as_ref(),
        ],
        &NATIVE_SUBSCRIPTIONS_PROGRAM,
    )
}

/// `delegatee` must be the Treasury PDA — never a session key. See the module doc.
pub fn find_fixed_delegation(
    subscription_authority: &Pubkey,
    delegator: &Pubkey,
    delegatee: &Pubkey,
) -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[
            SEED_NATIVE_DELEGATION,
            subscription_authority.as_ref(),
            delegator.as_ref(),
            delegatee.as_ref(),
            &crate::constants::NATIVE_ALLOWANCE_NONCE.to_le_bytes(),
        ],
        &NATIVE_SUBSCRIPTIONS_PROGRAM,
    )
}

pub fn find_event_authority() -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[SEED_NATIVE_EVENT_AUTHORITY],
        &NATIVE_SUBSCRIPTIONS_PROGRAM,
    )
}

// ---------------------------------------------------------------------------------------
// SubscriptionAuthority account parsing
// ---------------------------------------------------------------------------------------

/// Byte offset of `SubscriptionAuthority.init_id` (verified against the Codama IDL's
/// `subscriptionAuthority` account: `discriminator:u8, user:Pubkey, token_mint:Pubkey,
/// payer:Pubkey, bump:u8, init_id:i64`, fields laid out back to back with no padding).
const SUBSCRIPTION_AUTHORITY_INIT_ID_OFFSET: usize = 1 + 32 + 32 + 32 + 1;
const SUBSCRIPTION_AUTHORITY_MIN_LEN: usize = SUBSCRIPTION_AUTHORITY_INIT_ID_OFFSET + 8;

/// Reads `init_id` from an already-initialized `SubscriptionAuthority` account. Required
/// by `create_fixed_delegation`'s `expected_subscription_authority_init_id` argument,
/// which the native program checks so a delegation cannot silently attach to a *different*
/// incarnation of the authority than the one the caller just observed (e.g. after a
/// close-and-recreate).
pub fn read_subscription_authority_init_id(account: &AccountInfo) -> Result<i64> {
    let data = account
        .try_borrow_data()
        .map_err(|_| error!(AgentRailsError::InvalidNativeAllowanceAccountData))?;
    require!(
        data.len() >= SUBSCRIPTION_AUTHORITY_MIN_LEN,
        AgentRailsError::InvalidNativeAllowanceAccountData
    );
    let bytes: [u8; 8] = data
        [SUBSCRIPTION_AUTHORITY_INIT_ID_OFFSET..SUBSCRIPTION_AUTHORITY_INIT_ID_OFFSET + 8]
        .try_into()
        .map_err(|_| error!(AgentRailsError::InvalidNativeAllowanceAccountData))?;
    Ok(i64::from_le_bytes(bytes))
}

// ---------------------------------------------------------------------------------------
// init_subscription_authority (discriminator 0) — owner-signed, idempotent setup
// ---------------------------------------------------------------------------------------

pub struct InitSubscriptionAuthorityAccounts<'info> {
    pub owner: AccountInfo<'info>,
    pub subscription_authority: AccountInfo<'info>,
    pub token_mint: AccountInfo<'info>,
    pub user_ata: AccountInfo<'info>,
    pub system_program: AccountInfo<'info>,
    pub token_program: AccountInfo<'info>,
}

/// CPIs `initSubscriptionAuthority`. `payer` is omitted (native-side optional, defaults
/// to `owner`) — Agent Rails never sponsors this rent; the owner who opts into
/// `NativeAllowance` pays for their own delegation setup, the same way they already pay
/// for their own vault ATA rent in `add_mint`.
pub fn init_subscription_authority<'info>(
    accounts: InitSubscriptionAuthorityAccounts<'info>,
) -> Result<()> {
    let ix = Instruction {
        program_id: NATIVE_SUBSCRIPTIONS_PROGRAM,
        accounts: vec![
            AccountMeta::new(*accounts.owner.key, true),
            AccountMeta::new(*accounts.subscription_authority.key, false),
            AccountMeta::new_readonly(*accounts.token_mint.key, false),
            AccountMeta::new(*accounts.user_ata.key, false),
            AccountMeta::new_readonly(*accounts.system_program.key, false),
            AccountMeta::new_readonly(*accounts.token_program.key, false),
        ],
        data: vec![NATIVE_IX_INIT_SUBSCRIPTION_AUTHORITY],
    };

    invoke(
        &ix,
        &[
            accounts.owner,
            accounts.subscription_authority,
            accounts.token_mint,
            accounts.user_ata,
            accounts.system_program,
            accounts.token_program,
        ],
    )
    .map_err(Into::into)
}

// ---------------------------------------------------------------------------------------
// create_fixed_delegation (discriminator 1) — owner-signed, one-time per mint
// ---------------------------------------------------------------------------------------

pub struct CreateFixedDelegationAccounts<'info> {
    pub owner: AccountInfo<'info>,
    pub subscription_authority: AccountInfo<'info>,
    pub native_delegation: AccountInfo<'info>,
    /// The Treasury PDA. Not a signer for this instruction — the native program only
    /// requires `delegatee` to sign at `transfer_fixed` time, not at creation.
    pub delegatee: AccountInfo<'info>,
    pub system_program: AccountInfo<'info>,
}

/// CPIs `createFixedDelegation`. `nonce` is always `NATIVE_ALLOWANCE_NONCE` (0) — see the
/// constant's doc comment for why Agent Rails never needs a second concurrent delegation
/// per (treasury, mint).
pub fn create_fixed_delegation<'info>(
    accounts: CreateFixedDelegationAccounts<'info>,
    amount_cap: u64,
    expiry_ts: i64,
    expected_subscription_authority_init_id: i64,
) -> Result<()> {
    let mut data = Vec::with_capacity(1 + 8 + 8 + 8 + 8);
    data.push(NATIVE_IX_CREATE_FIXED_DELEGATION);
    data.extend_from_slice(&crate::constants::NATIVE_ALLOWANCE_NONCE.to_le_bytes());
    data.extend_from_slice(&amount_cap.to_le_bytes());
    data.extend_from_slice(&expiry_ts.to_le_bytes());
    data.extend_from_slice(&expected_subscription_authority_init_id.to_le_bytes());

    let ix = Instruction {
        program_id: NATIVE_SUBSCRIPTIONS_PROGRAM,
        accounts: vec![
            AccountMeta::new(*accounts.owner.key, true),
            AccountMeta::new_readonly(*accounts.subscription_authority.key, false),
            AccountMeta::new(*accounts.native_delegation.key, false),
            AccountMeta::new_readonly(*accounts.delegatee.key, false),
            AccountMeta::new_readonly(*accounts.system_program.key, false),
        ],
        data,
    };

    invoke(
        &ix,
        &[
            accounts.owner,
            accounts.subscription_authority,
            accounts.native_delegation,
            accounts.delegatee,
            accounts.system_program,
        ],
    )
    .map_err(Into::into)
}

// ---------------------------------------------------------------------------------------
// transfer_fixed (discriminator 4) — Treasury-PDA-signed, on the execute_payment hot path
// ---------------------------------------------------------------------------------------

pub struct TransferFixedAccounts<'info> {
    pub native_delegation: AccountInfo<'info>,
    pub subscription_authority: AccountInfo<'info>,
    /// The owner's own ATA — the source of funds in `NativeAllowance` mode. Distinct from
    /// `vault_ata`, which is unused on this path.
    pub delegator_ata: AccountInfo<'info>,
    pub receiver_ata: AccountInfo<'info>,
    pub token_mint: AccountInfo<'info>,
    pub token_program: AccountInfo<'info>,
    /// Must be `treasury.to_account_info()`, signed via `invoke_signed` with
    /// `treasury_seeds`. Never the agent's session key — see the module doc.
    pub delegatee: AccountInfo<'info>,
    pub event_authority: AccountInfo<'info>,
    pub native_program: AccountInfo<'info>,
}

/// CPIs `transferFixed`. `amount` must be exactly `intent.amount` as already evaluated by
/// `payment::prepare` — this function performs no policy decision of its own, only
/// transport. `delegator` must be `treasury.owner`, never the Treasury PDA: the PDA is the
/// *delegatee* in this relationship, not the *delegator*.
pub fn transfer_fixed<'info>(
    accounts: TransferFixedAccounts<'info>,
    amount: u64,
    delegator: Pubkey,
    mint: Pubkey,
    treasury_signer_seeds: &[&[u8]],
) -> Result<()> {
    let mut data = Vec::with_capacity(1 + 8 + 32 + 32);
    data.push(NATIVE_IX_TRANSFER_FIXED);
    data.extend_from_slice(&amount.to_le_bytes());
    data.extend_from_slice(&delegator.to_bytes());
    data.extend_from_slice(&mint.to_bytes());

    let ix = Instruction {
        program_id: NATIVE_SUBSCRIPTIONS_PROGRAM,
        accounts: vec![
            AccountMeta::new(*accounts.native_delegation.key, false),
            AccountMeta::new_readonly(*accounts.subscription_authority.key, false),
            AccountMeta::new(*accounts.delegator_ata.key, false),
            AccountMeta::new(*accounts.receiver_ata.key, false),
            AccountMeta::new_readonly(*accounts.token_mint.key, false),
            AccountMeta::new_readonly(*accounts.token_program.key, false),
            AccountMeta::new_readonly(*accounts.delegatee.key, true), // signer, not writable
            AccountMeta::new_readonly(*accounts.event_authority.key, false),
            AccountMeta::new_readonly(*accounts.native_program.key, false),
        ],
        data,
    };

    invoke_signed(
        &ix,
        &[
            accounts.native_delegation,
            accounts.subscription_authority,
            accounts.delegator_ata,
            accounts.receiver_ata,
            accounts.token_mint,
            accounts.token_program,
            accounts.delegatee,
            accounts.event_authority,
            accounts.native_program,
        ],
        &[treasury_signer_seeds],
    )
    .map_err(Into::into)
}
