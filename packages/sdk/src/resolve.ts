import { fetchMaybeIntentReceipt, type IntentReceipt } from "@agent-rails/client";
import { intentIdToHex } from "@agent-rails/contract";
import type { Address, GetSignatureStatusesApi, Rpc, Signature, SolanaRpcApi } from "@solana/kit";
import {
  agentRailsErrorFromCode,
  customCodeFromTransactionError,
  stringifyRpcError,
} from "./error-mapping.js";
import { findReceiptPda } from "./pdas.js";

export type ResolveRpc = Rpc<SolanaRpcApi & GetSignatureStatusesApi>;

export type ResolvePaymentInput = {
  rpc: ResolveRpc;
  session: Address;
  intentId: Uint8Array;
  /** Present when a transaction was broadcast; lets the status lookup corroborate. */
  signature?: Signature | string;
  /** Total attempts before giving up and reporting the outcome as still unknown. */
  attempts?: number;
  intervalMs?: number;
};

export type PaymentResolution =
  | {
      outcome: "settled";
      receipt: Address;
      intentId: string;
      signature?: string;
      receiptData: IntentReceipt;
    }
  | { outcome: "denied"; receipt: Address; intentId: string; signature?: string; detail: string }
  | { outcome: "indeterminate"; receipt: Address; intentId: string; signature?: string };

/**
 * The program’s own words when it decided, the raw payload when something else failed.
 *
 * Both halves matter: a caller reading "the per-transaction limit was exceeded" can act on
 * it, and a caller reading a serialised `InsufficientFundsForRent` at least has something
 * to search for. Plain `JSON.stringify` gives neither, because every one of these payloads
 * contains bigints and throws.
 */
function describeTransactionError(err: unknown): string {
  const code = customCodeFromTransactionError(err);
  return code === undefined ? stringifyRpcError(err) : agentRailsErrorFromCode(code, err).message;
}

const DEFAULT_ATTEMPTS = 8;
const DEFAULT_INTERVAL_MS = 750;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Answer "did this payment land?" from chain state rather than from inference.
 *
 * The receipt PDA is the authority: the program creates it in the same transaction as the
 * transfer and only after the transfer CPI returned, so its presence is proof the money
 * moved and its absence — for a signature the cluster has definitively failed or never
 * seen — is proof it did not.
 *
 * The signature status is corroboration, queried with `searchTransactionHistory: true`.
 * The send path deliberately polls with `false` because it is asking "has it confirmed
 * yet?" about a transaction seconds old; resolution is asking "did this ever happen?" and
 * must look past the node's recent-status cache, which is exactly where a transaction that
 * landed while the client timed out will have fallen.
 */
export async function resolvePaymentOutcome(
  input: ResolvePaymentInput,
): Promise<PaymentResolution> {
  const [receipt] = await findReceiptPda({
    session: input.session,
    intentId: input.intentId,
  });
  const intentId = intentIdToHex(input.intentId);
  const signature = input.signature ? String(input.signature) : undefined;
  const attempts = input.attempts ?? DEFAULT_ATTEMPTS;
  const intervalMs = input.intervalMs ?? DEFAULT_INTERVAL_MS;

  const base = { receipt, intentId, ...(signature ? { signature } : {}) };

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const account = await fetchMaybeIntentReceipt(input.rpc, receipt);
    if (account.exists) {
      return { outcome: "settled", ...base, receiptData: account.data };
    }

    if (signature) {
      const statuses = await input.rpc
        .getSignatureStatuses([signature as Signature], { searchTransactionHistory: true })
        .send();
      const status = statuses.value[0];
      if (status?.err) {
        // The cluster has the transaction and it reverted. No receipt was ever created, so
        // this intent is free to be retried under the same id.
        return {
          outcome: "denied",
          ...base,
          detail: `Transaction failed on-chain: ${describeTransactionError(status.err)}`,
        };
      }
    }

    if (attempt < attempts - 1) {
      await sleep(intervalMs);
    }
  }

  // Neither a receipt nor a definitive failure. The caller must not pay again.
  return { outcome: "indeterminate", ...base };
}

export type ReceiptPrecheck =
  | { settled: true; receipt: Address; intentId: string; receiptData: IntentReceipt }
  | { settled: false; receipt: Address; intentId: string };

/**
 * Look for an existing receipt before building anything.
 *
 * Cheaper and clearer than letting the program refuse the duplicate: a caller retrying a
 * settled payment gets the original receipt back instead of a failed transaction and a
 * spent fee. It does not replace the on-chain check — that one is the guarantee — it just
 * stops most retries before they cost anything.
 */
export async function precheckReceipt(input: {
  rpc: ResolveRpc;
  session: Address;
  intentId: Uint8Array;
}): Promise<ReceiptPrecheck> {
  const [receipt] = await findReceiptPda({
    session: input.session,
    intentId: input.intentId,
  });
  const intentId = intentIdToHex(input.intentId);
  const account = await fetchMaybeIntentReceipt(input.rpc, receipt);

  if (account.exists) {
    return { settled: true, receipt, intentId, receiptData: account.data };
  }
  return { settled: false, receipt, intentId };
}
