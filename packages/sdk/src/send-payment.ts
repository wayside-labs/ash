import {
  getSignatureFromTransaction,
  isSolanaError,
  signTransactionMessageWithSigners,
  SOLANA_ERROR__BLOCK_HEIGHT_EXCEEDED,
  SOLANA_ERROR__JSON_RPC__SERVER_ERROR_SEND_TRANSACTION_PREFLIGHT_FAILURE,
  sendTransactionWithoutConfirmingFactory,
  type Commitment,
  type GetBlockHeightApi,
  type GetSignatureStatusesApi,
  type Rpc,
  type SendTransactionApi,
  type Signature,
  type SolanaRpcApi,
  type TransactionMessage,
} from "@solana/kit";
import { AgentRailsError } from "./errors.js";
import { toAgentRailsError } from "./error-mapping.js";

const DEFAULT_CONFIRM_TIMEOUT_MS = 60_000;
const CONFIRM_POLL_INTERVAL_MS = 500;

export type SendPaymentInput = {
  rpc: Rpc<SolanaRpcApi & SendTransactionApi & GetSignatureStatusesApi & GetBlockHeightApi>;
  transactionMessage: TransactionMessage;
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
    return confirmationStatus === "processed" || confirmationStatus === "confirmed" || confirmationStatus === "finalized";
  }
  if (commitment === "confirmed") {
    return confirmationStatus === "confirmed" || confirmationStatus === "finalized";
  }
  return confirmationStatus === "finalized";
}

function sendErrorFromUnknown(error: unknown): AgentRailsError {
  if (isSolanaError(error, SOLANA_ERROR__BLOCK_HEIGHT_EXCEEDED)) {
    return new AgentRailsError({
      reasonCode: "UNAUTHORIZED",
      message: "Transaction blockhash expired before it could be confirmed. Retry the payment.",
      cause: error,
    });
  }
  if (isSolanaError(error, SOLANA_ERROR__JSON_RPC__SERVER_ERROR_SEND_TRANSACTION_PREFLIGHT_FAILURE)) {
    return toAgentRailsError(error);
  }
  return toAgentRailsError(error);
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
      throw new AgentRailsError({
        reasonCode: "UNAUTHORIZED",
        message: "Transaction blockhash expired before confirmation completed.",
      });
    }

    const response = await rpc
      .getSignatureStatuses([signature], { searchTransactionHistory: false })
      .send();
    const status = response.value[0];

    if (status) {
      if (status.err) {
        throw new AgentRailsError({
          reasonCode: "UNAUTHORIZED",
          message: `Transaction failed on-chain: ${JSON.stringify(status.err)}`,
        });
      }
      if (isCommitmentReached(status.confirmationStatus ?? null, options.commitment)) {
        return;
      }
    }

    await sleep(CONFIRM_POLL_INTERVAL_MS);
  }

  throw new AgentRailsError({
    reasonCode: "UNAUTHORIZED",
    message: `Transaction confirmation timed out after ${options.confirmTimeoutMs}ms. Signature: ${signature}`,
  });
}

/**
 * Sign a payment transaction with embedded signers, broadcast it, and poll until
 * the configured commitment is reached.
 */
export async function sendPayment(input: SendPaymentInput): Promise<SendPaymentResult> {
  const commitment = input.commitment ?? "confirmed";
  const confirmTimeoutMs = input.confirmTimeoutMs ?? DEFAULT_CONFIRM_TIMEOUT_MS;

  try {
    const signedTransaction = await signTransactionMessageWithSigners(input.transactionMessage);
    const signature = getSignatureFromTransaction(signedTransaction);
    const sendTransaction = sendTransactionWithoutConfirmingFactory({ rpc: input.rpc });

    await sendTransaction(signedTransaction, {
      commitment,
      skipPreflight: input.skipPreflight ?? true,
    });

    await waitForSignatureConfirmation(input.rpc, signature, {
      commitment,
      confirmTimeoutMs,
      lastValidBlockHeight: input.lastValidBlockHeight,
    });

    return { signature };
  } catch (error) {
    if (error instanceof AgentRailsError) {
      throw error;
    }
    throw sendErrorFromUnknown(error);
  }
}
