import {
  getBase64EncodedWireTransaction,
  isSolanaError,
  partiallySignTransactionMessageWithSigners,
  SOLANA_ERROR__JSON_RPC__SERVER_ERROR_SEND_TRANSACTION_PREFLIGHT_FAILURE,
  type Commitment,
  type Rpc,
  type SimulateTransactionApi,
  type SolanaRpcApi,
  type TransactionMessage,
} from "@solana/kit";
import { agentRailsErrorFromCode, toAgentRailsError } from "./error-mapping.js";
import { AgentRailsError } from "./errors.js";

export type SimulatePaymentInput = {
  rpc: Rpc<SolanaRpcApi & SimulateTransactionApi>;
  transactionMessage: TransactionMessage;
  commitment?: Commitment;
};

export type SimulatePaymentResult = {
  err: null;
  logs: readonly string[];
  unitsConsumed: bigint;
};

function extractCustomCodeFromSimulationValue(
  value: Readonly<{ err?: unknown }>,
): number | undefined {
  const err = value.err;
  if (!err || typeof err !== "object") {
    return undefined;
  }

  if ("InstructionError" in err) {
    const instructionError = (err as { InstructionError: [number, unknown] }).InstructionError;
    const [, detail] = instructionError;
    if (
      detail &&
      typeof detail === "object" &&
      "Custom" in detail &&
      typeof (detail as { Custom: number }).Custom === "number"
    ) {
      return (detail as { Custom: number }).Custom;
    }
  }

  return undefined;
}

/**
 * Dry-run a payment transaction against an RPC node and map program failures to
 * `AgentRailsError` with stable `reason_code` strings for MCP surfaces.
 */
export async function simulatePayment(
  input: SimulatePaymentInput,
): Promise<SimulatePaymentResult> {
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
      const customCode = extractCustomCodeFromSimulationValue(simulation);
      if (customCode !== undefined) {
        throw agentRailsErrorFromCode(customCode, simulation.err);
      }
      throw new AgentRailsError({
        reasonCode: "UNAUTHORIZED",
        message: `Simulation failed: ${JSON.stringify(simulation.err)}`,
      });
    }

    return {
      err: null,
      logs: simulation.logs ?? [],
      unitsConsumed: simulation.unitsConsumed ?? 0n,
    };
  } catch (error) {
    if (isSolanaError(error, SOLANA_ERROR__JSON_RPC__SERVER_ERROR_SEND_TRANSACTION_PREFLIGHT_FAILURE)) {
      throw toAgentRailsError(error);
    }
    throw toAgentRailsError(error);
  }
}
