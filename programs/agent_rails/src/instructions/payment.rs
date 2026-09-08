//! The check sequence shared by `execute_payment` and `execute_payment_sol` (spec §5.3).
//!
//! Both instructions differ only in their transfer leg. Everything before it — the pause
//! and session gates, intent validity, mint and policy lookup, the runtime ceiling
//! re-check, destination authorization, and limit evaluation — lives here so the two paths
//! cannot drift apart. A rule that holds for tokens but not for SOL would be a hole in the
//! guardrail, and the only way to be sure there isn't one is to have a single copy.
//!
//! [`prepare`] performs steps 1–10 and 13 and has no side effects: it borrows state
//! immutably except for allocating a spend-counter slot, and returns the counter the
//! payment *would* produce. The caller runs its transfer, then calls [`commit`], which is
//! the only function that advances the session. Nothing is written before the transfer
//! CPI has returned `Ok`.

use anchor_lang::prelude::*;

use agent_rails_policy::{audit_preimage, evaluate, limit_leq_ceiling, DestinationMode};

use crate::args::PaymentIntent;
use crate::constants::{AuthMode, MAX_INTENT_TTL_SECONDS, MAX_MEMO_LEN, MIN_INTENT_TTL_SECONDS};
use crate::error::{AgentRailsError, IntoAnchorResult};
use crate::state::{
    AgentSession, AllowlistEntry, IntentReceipt, IntentReceiptInit, Policy, SpendCounter, Treasury,
};

/// Everything [`prepare`] reads, gathered by the caller so this module never touches an
/// `Accounts` struct and stays testable in isolation.
pub struct PaymentInputs<'a> {
    pub treasury: &'a Treasury,
    pub treasury_key: Pubkey,
    /// The treasury's native SOL vault. Only used to reject it as a destination; the SPL
    /// path derives it rather than carrying the account.
    pub sol_vault: Pubkey,
    pub policy: &'a Policy,
    pub policy_key: Pubkey,
    /// `(entry address, entry)`. Required in `DestinationMode::Allowlist`, ignored in `Any`.
    pub allowlist_entry: Option<(Pubkey, &'a AllowlistEntry)>,
    pub intent: &'a PaymentIntent,
    pub now: i64,
    /// `true` for `execute_payment_sol`. Cross-checked against `MintConfig` flags so
    /// neither path can be used for the other's mint.
    pub native: bool,
}

/// The decisions [`prepare`] reached, consumed by the transfer leg and then by [`commit`].
pub struct PaymentPlan {
    /// From `MintConfig`, cached at `add_mint` time. `transfer_checked` asserts it against
    /// the mint account, which is what makes the cache safe to trust here.
    pub decimals: u8,
    /// From `MintConfig`. The System program on the native path.
    pub token_program: Pubkey,
    /// Slot in `AgentSession.spend` that [`commit`] overwrites.
    counter_index: usize,
    /// The counter after rollover and after applying `intent.amount`.
    counter: agent_rails_policy::SpendCounter,
    /// `sha256(memo)`, or zeros for an empty memo.
    memo_hash: [u8; 32],
}

/// Steps 1–10 and 13 of spec §5.3. No external effects and no state written.
///
/// The `session` borrow is mutable only because a mint added to the policy after the
/// session was created needs a counter slot allocated on first use. If any later step
/// fails, the transaction reverts and the allocation goes with it.
pub fn prepare(inputs: PaymentInputs, session: &mut AgentSession) -> Result<PaymentPlan> {
    let PaymentInputs {
        treasury,
        treasury_key,
        sol_vault,
        policy,
        policy_key,
        allowlist_entry,
        intent,
        now,
        native,
    } = inputs;

    // 1. Pause is the agent kill switch. Owner withdrawal deliberately still works.
    require!(!treasury.paused, AgentRailsError::Paused);

    // 2. session.treasury / session.policy / session.session_key are `has_one` constraints
    //    on the Accounts struct, so they have already been checked by the time we run.

    // 3. `session_key.is_signer` is likewise a constraint. v1 has no other auth mode, and
    //    a session written by a future version must not be spendable by this one.
    require!(
        session.auth_mode == AuthMode::DIRECT_SIGNER,
        AgentRailsError::InvalidAuthMode
    );

    // 4. Two independent stops: the operator revokes, or the clock runs out.
    require!(!session.revoked, AgentRailsError::SessionRevoked);
    require!(now < session.expires_at, AgentRailsError::SessionExpired);

    // 5. A mandatory, short TTL is what bounds the replay window to something a receipt can
    //    outlive; see `IntentReceipt::is_closable`.
    let ttl = intent
        .expires_at
        .checked_sub(now)
        .ok_or(AgentRailsError::IntentExpired)?;
    require!(
        ttl >= MIN_INTENT_TTL_SECONDS,
        AgentRailsError::IntentExpired
    );
    require!(
        ttl <= MAX_INTENT_TTL_SECONDS,
        AgentRailsError::IntentTtlTooLong
    );

    // 6. A zero-amount payment would still burn an intent_id and a receipt's rent.
    require!(intent.amount > 0, AgentRailsError::AmountZero);
    require!(
        intent.memo.len() <= MAX_MEMO_LEN,
        AgentRailsError::MemoTooLong
    );
    require!(
        !policy.require_memo || !intent.memo.is_empty(),
        AgentRailsError::MemoRequired
    );

    // 7. The mint must be one the *owner* configured, not merely one the operator wrote
    //    into a policy, and it must match the instruction it arrived on.
    let mint_config = treasury
        .find_mint(&intent.mint)
        .ok_or(AgentRailsError::MintNotConfigured)?;
    require!(
        mint_config.is_native() == native,
        AgentRailsError::WrongPaymentPath
    );

    // 8. And the operator must have given this session's policy a limit for it.
    let limit = policy
        .find_limit(&intent.mint)
        .ok_or(AgentRailsError::MintNotInPolicy)?;

    // 9. Runtime ceiling re-check. `set_ceiling` deliberately does not rewrite live
    //    policies, so a lowered ceiling has to bite here or it would not bite at all until
    //    the operator next touched the policy.
    require!(
        limit_leq_ceiling(&limit.to_policy(), &mint_config.ceiling.to_policy()),
        AgentRailsError::PolicyExceedsCeiling
    );

    // 10. Destination. The treasury paying itself is never a real payment, and in the SOL
    //     path it would let an agent shuffle the vault balance to defeat the rent floor.
    require_keys_neq!(
        intent.destination_owner,
        treasury_key,
        AgentRailsError::SelfPaymentForbidden
    );
    require_keys_neq!(
        intent.destination_owner,
        sol_vault,
        AgentRailsError::SelfPaymentForbidden
    );

    let effective_per_tx = match DestinationMode::from_u8(policy.destination_mode) {
        Some(DestinationMode::Allowlist) => {
            let (entry_key, entry) =
                allowlist_entry.ok_or(AgentRailsError::DestinationNotAllowed)?;
            // The seeds are the authorization: an entry only exists at this address if the
            // operator created it for exactly this policy and this destination owner.
            let expected = Pubkey::create_program_address(
                &[
                    crate::constants::SEED_ALLOWLIST,
                    policy_key.as_ref(),
                    intent.destination_owner.as_ref(),
                    &[entry.bump],
                ],
                &crate::ID,
            )
            .map_err(|_| error!(AgentRailsError::DestinationNotAllowed))?;
            require_keys_eq!(entry_key, expected, AgentRailsError::DestinationNotAllowed);
            require_keys_eq!(
                entry.policy,
                policy_key,
                AgentRailsError::DestinationNotAllowed
            );
            entry.effective_per_tx(limit.per_tx_max)
        }
        Some(DestinationMode::Any) => {
            // `Any` is a ceiling flag, so revoking it stops open-destination policies
            // immediately rather than at the operator's convenience.
            require!(
                treasury.allow_any_destination,
                AgentRailsError::PolicyExceedsCeiling
            );
            limit.per_tx_max
        }
        // Only reachable from a corrupted account; fail closed.
        None => return err!(AgentRailsError::DestinationNotAllowed),
    };

    // 13. All arithmetic lives in the policy crate, which is property-tested and
    //     model-checked on its own and uses `checked_*` throughout.
    let counter_index = session
        .find_or_insert_counter(&intent.mint)
        .ok_or(AgentRailsError::MintNotInSession)?;
    let counter = evaluate(
        &limit.to_policy(),
        &session.spend[counter_index].to_policy(),
        intent.amount,
        effective_per_tx,
        now,
    )
    .or_anchor_err()?;

    Ok(PaymentPlan {
        decimals: mint_config.decimals,
        token_program: mint_config.token_program,
        counter_index,
        counter,
        memo_hash: memo_hash(&intent.memo),
    })
}

/// Everything [`commit`] writes, gathered the same way as [`PaymentInputs`].
pub struct CommitInputs<'a> {
    /// The `AgentSession` PDA address, recorded in the receipt so an indexer can join the
    /// two without re-deriving seeds.
    pub session_address: Pubkey,
    pub receipt_bump: u8,
    pub plan: &'a PaymentPlan,
    pub intent: &'a PaymentIntent,
    /// Rent refund target for `close_receipt`, which is not necessarily whoever closes it.
    pub fee_payer: Pubkey,
    pub clock: &'a Clock,
}

/// Step 15 of spec §5.3: the only place session state advances.
///
/// Called after the transfer CPI has succeeded, so a session's counters and audit chain can
/// never record a payment that did not move funds. Returns the new `(seq, audit_head)` for
/// the caller's event.
pub fn commit(
    session: &mut AgentSession,
    receipt: &mut IntentReceipt,
    inputs: CommitInputs,
) -> Result<(u64, [u8; 32])> {
    let CommitInputs {
        session_address,
        receipt_bump,
        plan,
        intent,
        fee_payer,
        clock,
    } = inputs;

    session.spend[plan.counter_index] = SpendCounter::from_policy(&plan.counter);
    session.seq = session
        .seq
        .checked_add(1)
        .ok_or(AgentRailsError::MathOverflow)?;
    session.audit_head = sha256(&audit_preimage(
        &session.audit_head,
        session.seq,
        &intent.intent_id,
        &intent.mint.to_bytes(),
        &intent.destination_owner.to_bytes(),
        intent.amount,
        clock.slot,
    ));

    receipt.initialize(IntentReceiptInit {
        bump: receipt_bump,
        session: session_address,
        intent_id: intent.intent_id,
        mint: intent.mint,
        destination_owner: intent.destination_owner,
        amount: intent.amount,
        seq: session.seq,
        slot: clock.slot,
        timestamp: clock.unix_timestamp,
        expires_at: intent.expires_at,
        fee_payer,
        memo_hash: plan.memo_hash,
    });

    Ok((session.seq, session.audit_head))
}

/// `sha256(memo)`, or all zeros for an empty memo.
///
/// Zero is not a reachable hash of any real memo, so an indexer can distinguish "no memo"
/// from "some memo" without storing the memo itself.
fn memo_hash(memo: &[u8]) -> [u8; 32] {
    if memo.is_empty() {
        [0u8; 32]
    } else {
        sha256(memo)
    }
}

/// The `sol_sha256` syscall. The policy crate builds the preimage bytes; hashing them here
/// rather than there keeps its software SHA-256 out of the SBF binary entirely.
fn sha256(bytes: &[u8]) -> [u8; 32] {
    solana_sha256_hasher::hash(bytes).to_bytes()
}
