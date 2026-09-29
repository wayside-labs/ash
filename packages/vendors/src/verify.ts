import { AGENT_RAILS_PROGRAM_ADDRESS, fetchMaybeIntentReceipt } from "@agent-rails/client";
import { deriveIntentId, intentIdToHex } from "@agent-rails/contract";
import { RECEIPT_STATUS_EXECUTED } from "@agent-rails/contract/constants";
import { findReceiptPda } from "@agent-rails/sdk";
import { type Address, address, createSolanaRpc } from "@solana/kit";

export type PaymentClaim = {
  session: string;
  payTo: Address;
  mint: Address;
  amount: bigint;
  reference: string;
};

export type VerifiedPayment = {
  ok: true;
  receipt: Address;
  intentId: string;
  seq: string;
  slot: string;
  paidAmount: string;
};

export type PaymentRejection = {
  ok: false;
  code:
    | "INVALID_SESSION"
    | "INTENT_MISMATCH"
    | "RECEIPT_NOT_FOUND"
    | "RECEIPT_FOREIGN_OWNER"
    | "RECEIPT_MISMATCH";
  message: string;
  intentId?: string;
  receipt?: string;
};

export type ReceiptReader = (
  receipt: Address,
) => ReturnType<typeof fetchMaybeIntentReceipt<string>>;

export function rpcReceiptReader(rpcUrl: string): ReceiptReader {
  const rpc = createSolanaRpc(rpcUrl);
  return (receipt) => fetchMaybeIntentReceipt(rpc, receipt, { commitment: "confirmed" });
}

/**
 * Proof of payment is the `IntentReceipt` itself, not a signature the payer hands over.
 *
 * The intent id is derived from `{session, destination, mint, amount, reference}` (ADR-004),
 * and the vendor knows every one of those for its own invoice — the reference *is* the
 * invoice id. So the vendor recomputes the id, derives the receipt PDA, and reads the account
 * the program wrote only after the transfer succeeded. A receipt at that address, owned by
 * the program, naming us and at least the invoiced amount, cannot belong to any other
 * invoice and cannot exist without the money having moved.
 *
 * What the payer sends is only which session paid. A claimed `intent_id` is compared, never
 * trusted: it is there so a mismatch can be reported instead of a bare "not found".
 */
export async function verifyPayment(
  read: ReceiptReader,
  claim: PaymentClaim,
  claimedIntentId?: string,
): Promise<VerifiedPayment | PaymentRejection> {
  let session: Address;
  try {
    session = address(claim.session);
  } catch {
    return { ok: false, code: "INVALID_SESSION", message: "session is not a base58 address" };
  }

  const intentIdBytes = deriveIntentId({
    session,
    destination: claim.payTo,
    mint: claim.mint,
    amount: claim.amount,
    reference: claim.reference,
  });
  const intentId = intentIdToHex(intentIdBytes);

  if (claimedIntentId && claimedIntentId !== intentId) {
    return {
      ok: false,
      code: "INTENT_MISMATCH",
      intentId,
      message:
        `intent_id ${claimedIntentId} is not the one this invoice expects (${intentId}). ` +
        "Pay exactly the invoiced amount, in the invoiced mint, to the invoiced destination, " +
        "with the invoice id as the reference.",
    };
  }

  const [receipt] = await findReceiptPda({ session, intentId: intentIdBytes });
  const account = await read(receipt);
  if (!account.exists) {
    return {
      ok: false,
      code: "RECEIPT_NOT_FOUND",
      intentId,
      receipt,
      message:
        "No receipt for this invoice from this session yet. If the payment was just sent, " +
        "wait for confirmation and redeem again.",
    };
  }
  // fetchMaybe* decodes any account at the address; only the program can have written a
  // real one, and a PDA of this program cannot be owned by anyone else — checked anyway.
  if (account.programAddress !== AGENT_RAILS_PROGRAM_ADDRESS) {
    return {
      ok: false,
      code: "RECEIPT_FOREIGN_OWNER",
      receipt,
      message: "receipt account is not owned by the Agent Rails program",
    };
  }
  const data = account.data;
  if (
    data.status !== RECEIPT_STATUS_EXECUTED ||
    data.session !== session ||
    data.destinationOwner !== claim.payTo ||
    data.mint !== claim.mint ||
    data.amount < claim.amount
  ) {
    return {
      ok: false,
      code: "RECEIPT_MISMATCH",
      intentId,
      receipt,
      message: "receipt exists but does not settle this invoice",
    };
  }

  return {
    ok: true,
    receipt,
    intentId,
    seq: data.seq.toString(),
    slot: data.slot.toString(),
    paidAmount: data.amount.toString(),
  };
}
