//! Policy argument handling shared by `create_policy` and `update_policy` (spec §5.2).
//!
//! The two instructions must agree exactly on what a legal policy is. If they could drift,
//! an operator could route around the ceiling by creating a tight policy and then widening
//! it — so validation lives here once, and both call it. Same reasoning as `payment.rs`:
//! a rule that holds on one path and not the other is a hole, and the only way to be sure
//! there isn't one is to have a single copy.

use anchor_lang::prelude::*;

use agent_rails_policy::{PolicyArgsView, TreasuryView};

use crate::args::{MintLimitArgs, PolicyArgs};
use crate::constants::MAX_MINTS;
use crate::error::{AgentRailsError, IntoAnchorResult};
use crate::state::{MintLimit, Policy, Treasury};

/// Validates `args` against the treasury's ceilings and returns the slots to write.
///
/// One call to `policy_leq_ceiling` covers duplicate mints, per-limit validity, "this mint
/// is configured on the treasury", the ceiling partial order, and both destination flags
/// (spec §7.2). That function is the same one `execute_payment` re-runs per payment, which
/// is what keeps configuration-time and runtime agreeing.
pub fn validated_limits(
    args: &PolicyArgs,
    treasury: &Treasury,
) -> Result<([MintLimit; MAX_MINTS], u8)> {
    // Bounds first: `to_policy_limits` truncates at `MAX_MINTS`, so an oversized `Vec` has
    // to be rejected here rather than silently losing its tail.
    require!(!args.mint_limits.is_empty(), AgentRailsError::InvalidLimit);
    require!(
        args.mint_limits.len() <= MAX_MINTS,
        AgentRailsError::MintSlotsFull
    );

    let (limits, used) = args.to_policy_limits();
    let (entries, configured) = treasury.ceiling_entries();
    agent_rails_policy::policy_leq_ceiling(
        &PolicyArgsView {
            mint_limits: &limits[..used],
            destination_mode: args.destination_mode,
            require_memo: args.require_memo,
            create_destination_ata: args.create_destination_ata,
        },
        &TreasuryView {
            mints: &entries[..configured],
            allow_any_destination: treasury.allow_any_destination,
            allow_create_destination_ata: treasury.allow_create_destination_ata,
        },
    )
    .or_anchor_err()?;

    let mut mint_limits = [MintLimit::EMPTY; MAX_MINTS];
    for (slot, arg) in mint_limits.iter_mut().zip(args.mint_limits.iter()) {
        *slot = arg.to_state();
    }
    Ok((mint_limits, used as u8))
}

/// `sha256(borsh(PolicyArgs))` (spec §8).
///
/// Hashed from the *arguments* rather than the stored account so the digest covers exactly
/// what the operator signed for, with no reserved bytes or defaults folded in.
pub fn limits_hash(args: &PolicyArgs) -> [u8; 32] {
    let mut bytes = Vec::with_capacity(256);
    args.serialize(&mut bytes)
        .expect("PolicyArgs serialization cannot fail into a Vec");
    solana_sha256_hasher::hash(&bytes).to_bytes()
}

/// Reconstructs the `PolicyArgs` a live policy corresponds to.
///
/// `update_policy` needs this to emit the *previous* limits digest alongside the new one
/// (spec §5.2), so an auditor can chain policy revisions the same way payments chain. The
/// round-trip is exact because [`MintLimitArgs::to_state`] only ever adds the reserved and
/// v1.1 fields, which are zero by construction and are not part of the digest.
pub fn args_from_policy(policy: &Policy) -> PolicyArgs {
    PolicyArgs {
        mint_limits: policy
            .mint_limits
            .iter()
            .filter(|limit| limit.is_used())
            .map(|limit| MintLimitArgs {
                mint: limit.mint,
                per_tx_max: limit.per_tx_max,
                short_window_max: limit.short_window_max,
                short_window_seconds: limit.short_window_seconds,
                long_window_max: limit.long_window_max,
                long_window_seconds: limit.long_window_seconds,
                lifetime_max: limit.lifetime_max,
            })
            .collect(),
        destination_mode: policy.destination_mode,
        require_memo: policy.require_memo,
        create_destination_ata: policy.create_destination_ata,
    }
}
