//! `close_receipt` (spec §5.4).
//!
//! Permissionless reclamation of an `IntentReceipt` once it has outlived every blockhash
//! window in which the original intent could still be resubmitted. Rent returns to the
//! `fee_payer` recorded in the receipt, not to whoever happens to call this: the closer
//! is not necessarily the payer, and a receipt whose rent could be stolen would turn
//! idempotency into a bounty.
//!
//! No `treasury` or `session` account is present, deliberately. Receipts outlive the
//! session that created them (and can outlive the treasury), and this instruction has to
//! succeed in that state. The `ReceiptClosed` event therefore cannot name a treasury; see
//! the event comment.

use anchor_lang::prelude::*;

use crate::error::AshError;
use crate::events::{ReceiptClosed, EVENT_SCHEMA_VERSION};
use crate::state::IntentReceipt;

#[event_cpi]
#[derive(Accounts)]
pub struct CloseReceipt<'info> {
    pub anyone: Signer<'info>,

    #[account(
        mut,
        close = fee_payer,
    )]
    pub receipt: Account<'info, IntentReceipt>,

    /// CHECK: pinned to the payer recorded at execution. Writable because it receives the
    /// rent. The closer does not have to be this key.
    #[account(mut, address = receipt.fee_payer @ AshError::Unauthorized)]
    pub fee_payer: UncheckedAccount<'info>,
}

pub fn close_receipt_handler(ctx: Context<CloseReceipt>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    require!(
        ctx.accounts.receipt.is_closable(now),
        AshError::ReceiptNotExpired
    );

    emit_cpi!(ReceiptClosed {
        treasury: Pubkey::default(),
        schema_version: EVENT_SCHEMA_VERSION,
        session: ctx.accounts.receipt.session,
        intent_id: ctx.accounts.receipt.intent_id,
        receipt: ctx.accounts.receipt.key(),
    });

    Ok(())
}
