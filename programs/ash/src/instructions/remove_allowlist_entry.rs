//! `remove_allowlist_entry` (spec §5.2).
//!
//! The one instruction that has to work on a *dead* policy. `close_policy` cannot sweep
//! allowlist entries — the program cannot enumerate PDAs — so entries can outlive the
//! policy they belong to, and their rent has to be reclaimable afterwards. That is why
//! `policy` here is an unchecked account: the caller may be passing the address of an
//! account that no longer exists.
//!
//! Authorization does not weaken as a result. The entry's own `policy` field pins which
//! address is acceptable, and the operator is checked against the *treasury*, which is
//! always live. If the policy is still open, its `treasury` is checked too.

use anchor_lang::prelude::*;

use crate::constants::{SEED_ALLOWLIST, SEED_TREASURY};
use crate::error::AshError;
use crate::events::{AllowlistEntryRemoved, EVENT_SCHEMA_VERSION};
use crate::state::{AllowlistEntry, Policy, Treasury};

#[event_cpi]
#[derive(Accounts)]
pub struct RemoveAllowlistEntry<'info> {
    pub operator: Signer<'info>,

    #[account(
        seeds = [SEED_TREASURY, treasury.create_key.as_ref()],
        bump = treasury.bump,
    )]
    pub treasury: Box<Account<'info, Treasury>>,

    /// CHECK: may already be closed, so it is not deserialized as `Account<Policy>`. Its
    /// address is pinned by `entry.policy`, and the handler checks `policy.treasury` when
    /// the account is still live.
    pub policy: UncheckedAccount<'info>,

    #[account(
        mut,
        close = rent_destination,
        seeds = [SEED_ALLOWLIST, policy.key().as_ref(), entry.destination_owner.as_ref()],
        bump = entry.bump,
        constraint = entry.policy == policy.key() @ AshError::Unauthorized,
    )]
    pub entry: Box<Account<'info, AllowlistEntry>>,

    /// CHECK: rent recipient chosen by the operator, who is already authorized to close
    /// this account.
    #[account(mut)]
    pub rent_destination: UncheckedAccount<'info>,
}

pub fn remove_allowlist_entry_handler(ctx: Context<RemoveAllowlistEntry>) -> Result<()> {
    require!(
        ctx.accounts
            .treasury
            .is_owner_or_operator(&ctx.accounts.operator.key()),
        AshError::Unauthorized
    );

    // A live policy must belong to this treasury. A closed one cannot be checked and does
    // not need to be: the entry is bound to the policy address by its seeds, and that
    // address can never be revived as a policy of a different treasury, because
    // `["policy", treasury, name]` commits the treasury into the address itself.
    if let Some(policy) = live_policy(&ctx.accounts.policy)? {
        require_keys_eq!(
            policy.treasury,
            ctx.accounts.treasury.key(),
            AshError::Unauthorized
        );
    }

    emit_cpi!(AllowlistEntryRemoved {
        treasury: ctx.accounts.treasury.key(),
        schema_version: EVENT_SCHEMA_VERSION,
        policy: ctx.accounts.policy.key(),
        destination_owner: ctx.accounts.entry.destination_owner,
        label: ctx.accounts.entry.label,
        per_tx_max_override: ctx.accounts.entry.per_tx_max_override,
    });

    Ok(())
}

/// Deserializes `policy` if it is still an open `Policy` owned by this program.
///
/// Returns `Ok(None)` for a closed account — zero-length data, or reassigned to the System
/// program — and an error only when the account exists, belongs to this program, and still
/// fails to decode, which would mean the caller passed some other account of ours.
fn live_policy(account: &UncheckedAccount) -> Result<Option<Policy>> {
    if account.owner != &crate::ID || account.data_is_empty() {
        return Ok(None);
    }
    let data = account.try_borrow_data()?;
    let policy =
        Policy::try_deserialize(&mut &data[..]).map_err(|_| error!(AshError::Unauthorized))?;
    Ok(Some(policy))
}
