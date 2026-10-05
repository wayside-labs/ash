import {
  type Commitment,
  type GetBlockHeightApi,
  type GetSignatureStatusesApi,
  getSignatureFromTransaction,
  isSolanaError,
  type Rpc,
  type SendTransactionApi,
  type Signature,
  SOLANA_ERROR__BLOCK_HEIGHT_EXCEEDED,
  SOLANA_ERROR__JSON_RPC__SERVER_ERROR_SEND_TRANSACTION_PREFLIGHT_FAILURE,
  type SolanaRpcApi,
  sendTransactionWithoutConfirmingFactory,
  signTransactionMessageWithSigners,
} from "@solana/kit";
import {
  ashErrorFromCode,
  customCodeFromTransactionError,
  stringifyRpcError,
  toAshError,
} from "./error-mapping.js";
import { AshError } from "./errors.js";
import type { PaymentTransactionMessage } from "./payment-intent.js";

const DEFAULT_CONFIRM_TIMEOUT_MS = 60_000;
const CONFIRM_POLL_INTERVAL_MS = 500;

export type SendPaymentInput = {
  rpc: Rpc<SolanaRpcApi & SendTransactionApi & GetSignatureStatusesApi & GetBlockHeightApi>;
  transactionMessage: PaymentTransactionMessage;
  lastValidBlockHeight: bigint;
  commitment?: Commitment;
  confirmTimeoutMs?: number;
  skipPreflight?: boolean;
};

export type SendPaymentResult = {
  signature: Signature;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isCommitmentReached(
  confirmationStatus: string | null | undefined,
  commitment: Commitment,
): boolean {
  if (commitment === "processed") {
    return (
      confirmationStatus === "processed" ||
      confirmationStatus === "confirmed" ||
      confirmationStatus === "finalized"
    );
  }
  if (commitment === "confirmed") {
    return confirmationStatus === "confirmed" || confirmationStatus === "finalized";
  }
  return confirmationStatus === "finalized";
}

/**
 * Raised once the transaction is on the wire and the outcome is unknown.
 *
 * Every exit from this module after a successful broadcast produces one of these, because
 * none of them prove anything about whether the transfer landed: a confirmation timeout
 * means the node was slow, an expired blockhash means it probably was not included, and
 * "probably" is not a basis for paying someone a second time. The caller resolves it
 * against the `IntentReceipt`, which is the only authoritative answer.
 */
function indeterminate(message: string, signature: Signature, cause?: unknown): AshError {
  return new AshError({
    reasonCode: "UNRESOLVED_OUTCOME",
    message,
    outcome: "indeterminate",
    source: "program",
    signature,
    cause,
  });
}

async function waitForSignatureConfirmation(
  rpc: SendPaymentInput["rpc"],
  signature: Signature,
  options: {
    commitment: Commitment;
    confirmTimeoutMs: number;
    lastValidBlockHeight: bigint;
  },
): Promise<void> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < options.confirmTimeoutMs) {
    const blockHeight = await rpc.getBlockHeight().send();
    if (blockHeight > options.lastValidBlockHeight) {
      throw indeterminate(
        "Blockhash expired before the transaction was confirmed. " +
          "Resolve the intent receipt before retrying.",
        signature,
      );
    }

    const response = await rpc
      .getSignatureStatuses([signature], { searchTransactionHistory: false })
      .send();
    const status = response.value[0];

    if (status) {
      if (status.err) {
        // The transaction was included and reverted. Nothing moved, no receipt exists, and
        // the failure is a decision rather than an unknown: this one is a denial.
        // The program decided, so report *what* it decided. This used to hardcode
        // `UNKNOWN_PROGRAM_ERROR` and stringify the payload, which threw on its bigints and
        // replaced a precise denial with a serialisation complaint.
        const code = customCodeFromTransactionError(status.err);
        if (code !== undefined) {
          throw ashErrorFromCode(code, status.err).withContext({ signature });
        }
        throw new AshError({
          reasonCode: "UNKNOWN_PROGRAM_ERROR",
          message: `Transaction failed on-chain: ${stringifyRpcError(status.err)}`,
          outcome: "denied",
          source: "program",
          signature,
        });
      }
      if (isCommitmentReached(status.confirmationStatus ?? null, options.commitment)) {
        return;
      }
    }

    await sleep(CONFIRM_POLL_INTERVAL_MS);
  }

  throw indeterminate(
    `Confirmation timed out after ${options.confirmTimeoutMs}ms. ` +
      "The transaction may still land; resolve the intent receipt before retrying.",
    signature,
  );
}

/**
 * Sign, broadcast, and confirm a payment transaction.
 *
 * The classification of failures is the load-bearing part. Anything raised before the
 * broadcast means nothing was sent. Anything raised after it means the transfer may exist,
 * and the error says so rather than reporting a denial the caller would reasonably retry.
 */
export async function sendPayment(input: SendPaymentInput): Promise<SendPaymentResult> {
  const commitment = input.commitment ?? "confirmed";
  const confirmTimeoutMs = input.confirmTimeoutMs ?? DEFAULT_CONFIRM_TIMEOUT_MS;

  const signedTransaction = await signTransactionMessageWithSigners(input.transactionMessage);
  const signature = getSignatureFromTransaction(signedTransaction);
  const sendTransaction = sendTransactionWithoutConfirmingFactory({ rpc: input.rpc });

  try {
    await sendTransaction(signedTransaction, {
      commitment,
      skipPreflight: input.skipPreflight ?? true,
    });
  } catch (error) {
    // A preflight failure is the node telling us it ran the transaction and it reverted:
    // definitive, nothing broadcast, a denial. Anything else — a socket reset, a 502, a
    // timeout on the RPC call itself — may or may not have reached the cluster.
    if (
      isSolanaError(error, SOLANA_ERROR__JSON_RPC__SERVER_ERROR_SEND_TRANSACTION_PREFLIGHT_FAILURE)
    ) {
      throw toAshError(error).withContext({ signature });
    }
    throw indeterminate(
      error instanceof Error
        ? `Transaction broadcast failed and may still have reached the cluster: ${error.message}`
        : "Transaction broadcast failed and may still have reached the cluster.",
      signature,
      error,
    );
  }

  try {
    await waitForSignatureConfirmation(input.rpc, signature, {
      commitment,
      confirmTimeoutMs,
      lastValidBlockHeight: input.lastValidBlockHeight,
    });
  } catch (error) {
    if (error instanceof AshError) {
      throw error;
    }
    if (isSolanaError(error, SOLANA_ERROR__BLOCK_HEIGHT_EXCEEDED)) {
      throw indeterminate(
        "Blockhash expired before the transaction was confirmed. " +
          "Resolve the intent receipt before retrying.",
        signature,
        error,
      );
    }
    // The confirmation poll itself failed. The transaction is already out there.
    throw indeterminate(
      error instanceof Error
        ? `Could not determine the transaction outcome: ${error.message}`
        : "Could not determine the transaction outcome.",
      signature,
      error,
    );
  }

  return { signature };
}
