import {
  type Commitment,
  getBase64EncodedWireTransaction,
  isSolanaError,
  partiallySignTransactionMessageWithSigners,
  type Rpc,
  type SimulateTransactionApi,
  SOLANA_ERROR__JSON_RPC__SERVER_ERROR_SEND_TRANSACTION_PREFLIGHT_FAILURE,
  type SolanaRpcApi,
} from "@solana/kit";
import {
  ashErrorFromCode,
  customCodeFromTransactionError,
  stringifyRpcError,
  toAshError,
} from "./error-mapping.js";
import { AshError } from "./errors.js";
import type { PaymentTransactionMessage } from "./payment-intent.js";

export type SimulatePaymentInput = {
  rpc: Rpc<SolanaRpcApi & SimulateTransactionApi>;
  transactionMessage: PaymentTransactionMessage;
  commitment?: Commitment;
};

export type SimulatePaymentResult = {
  err: null;
  logs: readonly string[];
  unitsConsumed: bigint;
};

/**
 * Dry-run a payment transaction against an RPC node and map program failures to
 * `AshError` with stable `reason_code` strings for MCP surfaces.
 */
export async function simulatePayment(input: SimulatePaymentInput): Promise<SimulatePaymentResult> {
  try {
    const signedTransaction = await partiallySignTransactionMessageWithSigners(
      input.transactionMessage,
    );
    const wireTransaction = getBase64EncodedWireTransaction(signedTransaction);

    const response = await input.rpc
      .simulateTransaction(wireTransaction, {
        encoding: "base64",
        sigVerify: false,
        commitment: input.commitment ?? "processed",
      })
      .send();

    const simulation = response.value;
    if (simulation.err) {
      const customCode = customCodeFromTransactionError(simulation.err);
      if (customCode !== undefined) {
        throw ashErrorFromCode(customCode, simulation.err);
      }
      throw new AshError({
        reasonCode: "UNKNOWN_PROGRAM_ERROR",
        message: `Simulation failed: ${stringifyRpcError(simulation.err)}`,
        outcome: "denied",
        source: "simulation",
      });
    }

    return {
      err: null,
      logs: simulation.logs ?? [],
      unitsConsumed: simulation.unitsConsumed ?? 0n,
    };
  } catch (error) {
    if (
      isSolanaError(error, SOLANA_ERROR__JSON_RPC__SERVER_ERROR_SEND_TRANSACTION_PREFLIGHT_FAILURE)
    ) {
      throw toAshError(error);
    }
    throw toAshError(error);
  }
}
