import {
  mcpCheckPaymentSchema,
  parseIntentIdHex,
  type McpCheckPaymentInput,
} from "@agent-rails/contract";
import { fetchMaybeIntentReceipt } from "@agent-rails/client";
import { findReceiptPda } from "@agent-rails/sdk";
import type { McpRuntime } from "../config.js";
import { serializeIntentReceipt } from "./serialize.js";

export type CheckPaymentResponse = {
  exists: boolean;
  receipt_pda: string;
  intent_id: string;
  session: string;
  receipt?: ReturnType<typeof serializeIntentReceipt>;
};

export async function handleCheckPayment(
  runtime: McpRuntime,
  rawInput: McpCheckPaymentInput,
): Promise<CheckPaymentResponse> {
  const input = mcpCheckPaymentSchema.parse(rawInput);
  const intentId = parseIntentIdHex(input.intent_id);
  const [receiptPda] = await findReceiptPda({
    session: input.session,
    intentId,
  });

  const account = await fetchMaybeIntentReceipt(runtime.rpc, receiptPda);

  if (!account.exists) {
    return {
      exists: false,
      receipt_pda: receiptPda,
      intent_id: input.intent_id,
      session: input.session,
    };
  }

  return {
    exists: true,
    receipt_pda: receiptPda,
    intent_id: input.intent_id,
    session: input.session,
    receipt: serializeIntentReceipt(account.data),
  };
}
