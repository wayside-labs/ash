import type {
  Address,
  Commitment,
  GetBlockHeightApi,
  GetSignatureStatusesApi,
  Rpc,
  SendTransactionApi,
  SolanaRpcApi,
} from "@solana/kit";
import { AshError, isAshError } from "./errors.js";
import type { PaymentTransactionMessage } from "./payment-intent.js";
import { findReceiptPda } from "./pdas.js";
import { resolvePaymentOutcome } from "./resolve.js";
import { type SendPaymentResult, sendPayment } from "./send-payment.js";
import { type SimulatePaymentResult, simulatePayment } from "./simulate.js";

export type ExecutePaymentRpc = Rpc<
  SolanaRpcApi & SendTransactionApi & GetSignatureStatusesApi & GetBlockHeightApi
>;

export type ExecutePaymentInput = {
  rpc: ExecutePaymentRpc;
  transactionMessage: PaymentTransactionMessage;
  lastValidBlockHeight: bigint;
  /** Needed to derive the receipt PDA when an outcome has to be resolved. */
  session: Address;
  intentId: Uint8Array;
  commitment?: Commitment;
  confirmTimeoutMs?: number;
  /** Attempts for the post-send resolution poll. Zero disables it. */
  resolveAttempts?: number;
  resolveIntervalMs?: number;
};

export type ExecutePaymentResult = SendPaymentResult & {
  simulation: SimulatePaymentResult;
  /** "settled" here always; anything else is thrown, carrying its own outcome. */
  outcome: "settled";
  receipt: Address;
};

/**
 * Simulate, send, confirm, and — if confirmation does not settle the question — resolve.
 *
 * The resolution step is what keeps an unlucky RPC call from becoming a second payment.
 * When the send path reports an indeterminate outcome the transfer may already exist, so
 * this checks the receipt PDA before handing anything back; if the receipt is there the
 * payment is reported as settled, and if it is genuinely absent the error propagates still
 * marked indeterminate so the caller stops rather than retries.
 */
export async function executePayment(input: ExecutePaymentInput): Promise<ExecutePaymentResult> {
  const simulation = await simulatePayment({
    rpc: input.rpc,
    transactionMessage: input.transactionMessage,
    ...(input.commitment !== undefined ? { commitment: input.commitment } : {}),
  });

  try {
    const sendResult = await sendPayment({
      rpc: input.rpc,
      transactionMessage: input.transactionMessage,
      lastValidBlockHeight: input.lastValidBlockHeight,
      ...(input.commitment !== undefined ? { commitment: input.commitment } : {}),
      ...(input.confirmTimeoutMs !== undefined ? { confirmTimeoutMs: input.confirmTimeoutMs } : {}),
      skipPreflight: true,
    });

    const [receipt] = await findReceiptPda({
      session: input.session,
      intentId: input.intentId,
    });

    return { ...sendResult, simulation, outcome: "settled", receipt };
  } catch (error) {
    if (!isAshError(error) || error.outcome !== "indeterminate") {
      throw error;
    }

    const resolution = await resolvePaymentOutcome({
      rpc: input.rpc,
      session: input.session,
      intentId: input.intentId,
      ...(error.signature ? { signature: error.signature } : {}),
      ...(input.resolveAttempts !== undefined ? { attempts: input.resolveAttempts } : {}),
      ...(input.resolveIntervalMs !== undefined ? { intervalMs: input.resolveIntervalMs } : {}),
    });

    if (resolution.outcome === "settled") {
      return {
        signature: (resolution.signature ?? error.signature) as SendPaymentResult["signature"],
        simulation,
        outcome: "settled",
        receipt: resolution.receipt,
      };
    }

    if (resolution.outcome === "denied") {
      throw new AshError({
        reasonCode: "UNKNOWN_PROGRAM_ERROR",
        message: resolution.detail,
        outcome: "denied",
        source: "program",
        intentId: resolution.intentId,
        receipt: resolution.receipt,
        ...(resolution.signature ? { signature: resolution.signature } : {}),
        cause: error,
      });
    }

    throw error.withContext({
      intentId: resolution.intentId,
      receipt: resolution.receipt,
    });
  }
}
