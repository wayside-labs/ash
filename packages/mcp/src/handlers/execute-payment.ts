import {
  mcpExecutePaymentSchema,
  toPaymentBuildInput,
  type McpExecutePaymentInput,
} from "@agent-rails/contract";
import {
  buildPaymentIntent,
  isAgentRailsError,
  simulatePayment,
  type PaymentIntentBuildResult,
} from "@agent-rails/sdk";
import type { McpRuntime } from "../config.js";
import type { SessionSigners } from "../session.js";

export type ExecutePaymentResult = {
  allowed: true;
  path: PaymentIntentBuildResult["path"];
  intent_id: string;
  receipt: string;
  pdas: PaymentIntentBuildResult["pdas"];
  simulation: {
    err: null;
    logs: readonly string[];
    units_consumed: string;
  };
};

export type ExecutePaymentDenied = {
  allowed: false;
  reason_code: string;
  message: string;
};

export type ExecutePaymentResponse = ExecutePaymentResult | ExecutePaymentDenied;

export async function handleExecutePayment(
  runtime: McpRuntime,
  signers: SessionSigners,
  rawInput: McpExecutePaymentInput,
): Promise<ExecutePaymentResponse> {
  const input = mcpExecutePaymentSchema.parse(rawInput);
  const buildInput = toPaymentBuildInput(input);

  try {
    const { blockhash, lastValidBlockHeight } = await runtime.rpc.getLatestBlockhash().send();

    const payment = await buildPaymentIntent({
      ...buildInput,
      feePayer: signers.feePayer,
      sessionKey: signers.sessionKey,
      recentBlockhash: { blockhash, lastValidBlockHeight },
    });

    const simulation = await simulatePayment({
      rpc: runtime.rpc,
      transactionMessage: payment.transactionMessage,
    });

    return {
      allowed: true,
      path: payment.path,
      intent_id: Array.from(payment.intent.intentId, (byte) =>
        byte.toString(16).padStart(2, "0"),
      ).join(""),
      receipt: payment.pdas.receipt,
      pdas: payment.pdas,
      simulation: {
        err: null,
        logs: simulation.logs,
        units_consumed: simulation.unitsConsumed.toString(),
      },
    };
  } catch (error) {
    if (isAgentRailsError(error)) {
      return {
        allowed: false,
        reason_code: error.reasonCode,
        message: error.message,
      };
    }
    throw error;
  }
}
