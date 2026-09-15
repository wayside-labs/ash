//! Anchor error codes (spec §9).
//!
//! The order of these variants is part of the on-chain contract: Anchor assigns codes
//! sequentially from 6000, and the SDK, MCP tools, and adapters key their `reason_code`
//! strings off the number. Never reorder or remove a variant; append only.

use agent_rails_policy::PolicyError;
use anchor_lang::prelude::*;

#[error_code]
pub enum AgentRailsError {
    #[msg("Treasury is paused")]
    Paused, // 6000
    #[msg("Signer is not authorized for this action")]
    Unauthorized, // 6001
    #[msg("Session has been revoked")]
    SessionRevoked, // 6002
    #[msg("Session has expired")]
    SessionExpired, // 6003
    #[msg("Auth mode is not supported in this program version")]
    InvalidAuthMode, // 6004
    #[msg("Intent has expired")]
    IntentExpired, // 6005
    #[msg("Intent TTL exceeds the maximum")]
    IntentTtlTooLong, // 6006
    #[msg("Amount must be greater than zero")]
    AmountZero, // 6007
    #[msg("Memo exceeds the maximum length")]
    MemoTooLong, // 6008
    #[msg("Policy requires a non-empty memo")]
    MemoRequired, // 6009
    #[msg("Mint is not configured on the treasury")]
    MintNotConfigured, // 6010
    #[msg("Mint is not present in the policy")]
    MintNotInPolicy, // 6011
    #[msg("Session has no spend counter slot for this mint")]
    MintNotInSession, // 6012
    #[msg("Token program does not match the mint")]
    TokenProgramMismatch, // 6013
    #[msg("Native mint must use the SOL payment path, and vice versa")]
    WrongPaymentPath, // 6014
    #[msg("Destination is not on the policy allowlist")]
    DestinationNotAllowed, // 6015
    #[msg("Destination token account is missing and policy forbids creating it")]
    DestinationAtaCreationDisabled, // 6016
    #[msg("Treasury cannot pay itself")]
    SelfPaymentForbidden, // 6017
    #[msg("Amount exceeds the per-transaction maximum")]
    ExceedsPerTxMax, // 6018
    #[msg("Amount exceeds the short window maximum")]
    ExceedsShortWindow, // 6019
    #[msg("Amount exceeds the long window maximum")]
    ExceedsLongWindow, // 6020
    #[msg("Amount exceeds the session lifetime maximum")]
    ExceedsLifetime, // 6021
    #[msg("Vault balance is insufficient")]
    InsufficientVaultBalance, // 6022
    #[msg("Policy exceeds the treasury ceiling")]
    PolicyExceedsCeiling, // 6023
    #[msg("Window duration is invalid")]
    InvalidWindow, // 6024
    #[msg("Limit is invalid")]
    InvalidLimit, // 6025
    #[msg("Name or label is invalid")]
    InvalidName, // 6026
    #[msg("No free mint slot")]
    MintSlotsFull, // 6027
    #[msg("Mint is already configured")]
    DuplicateMint, // 6028
    #[msg("Mint uses an unsupported Token-2022 extension")]
    UnsupportedMintExtension, // 6029
    #[msg("No free guardian slot")]
    GuardiansFull, // 6030
    #[msg("Guardian not found")]
    GuardianNotFound, // 6031
    #[msg("Guardian is already registered")]
    DuplicateGuardian, // 6032
    #[msg("Session key must not be a privileged key")]
    PrivilegedKeyAsSession, // 6033
    #[msg("Session expiry is out of range")]
    InvalidExpiry, // 6034
    #[msg("Policy still has active sessions")]
    PolicyInUse, // 6035
    #[msg("Session is neither revoked nor expired")]
    SessionStillActive, // 6036
    #[msg("Treasury still holds funds, policies, or sessions")]
    TreasuryNotEmpty, // 6037
    #[msg("Receipt is not yet eligible for closing")]
    ReceiptNotExpired, // 6038
    #[msg("Session is already revoked")]
    AlreadyRevoked, // 6039
    #[msg("Arithmetic overflow")]
    MathOverflow, // 6040
    #[msg("A reserved field was non-zero")]
    ReservedFieldNonZero, // 6041
    #[msg("Mint uses NativeAllowance funding mode but the native allowance accounts were not provided")]
    NativeAllowanceAccountsMissing, // 6042
    #[msg("Mint is not configured for NativeAllowance funding mode")]
    NotNativeAllowanceMode, // 6043
    #[msg("Account address does not match the expected native program PDA derivation")]
    InvalidNativeAllowancePda, // 6044
    #[msg("Native SubscriptionAuthority account data could not be parsed")]
    InvalidNativeAllowanceAccountData, // 6045
}

impl From<PolicyError> for AgentRailsError {
    fn from(e: PolicyError) -> Self {
        match e {
            PolicyError::MintNotConfigured => Self::MintNotConfigured,
            PolicyError::MintNotInPolicy => Self::MintNotInPolicy,
            PolicyError::MintNotInSession => Self::MintNotInSession,
            PolicyError::ExceedsPerTxMax => Self::ExceedsPerTxMax,
            PolicyError::ExceedsShortWindow => Self::ExceedsShortWindow,
            PolicyError::ExceedsLongWindow => Self::ExceedsLongWindow,
            PolicyError::ExceedsLifetime => Self::ExceedsLifetime,
            PolicyError::PolicyExceedsCeiling => Self::PolicyExceedsCeiling,
            PolicyError::InvalidWindow => Self::InvalidWindow,
            PolicyError::InvalidLimit => Self::InvalidLimit,
            PolicyError::MintSlotsFull => Self::MintSlotsFull,
            PolicyError::DuplicateMint => Self::DuplicateMint,
            PolicyError::MathOverflow => Self::MathOverflow,
        }
    }
}

/// Lifts a policy-crate result into an Anchor result, preserving the spec §9 code.
pub trait IntoAnchorResult<T> {
    fn or_anchor_err(self) -> Result<T>;
}

impl<T> IntoAnchorResult<T> for core::result::Result<T, PolicyError> {
    fn or_anchor_err(self) -> Result<T> {
        self.map_err(|e| error!(AgentRailsError::from(e)))
    }
}
