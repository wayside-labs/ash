import { intentIdFromHex, mcpGetPaymentStatusSchema } from "@agent-rails/contract";
import { resolvePaymentOutcome } from "@agent-rails/sdk";
import type { ServerContext } from "../context.js";
import { serializeIntentReceipt } from "./serialize.js";

/**
 * The authoritative answer to "did it land?" (ADR-004).
 *
 * The receipt PDA exists only if the program created it, and the program creates it in the
 * same transaction as the transfer and only after the transfer CPI returned. So its presence
 * is proof the money moved, which makes this the one tool a caller may use after an
 * indeterminate outcome — and resolving one is also what lifts the session's quiesce.
 *
 * The session is the bound one. A caller cannot name another, because a read tool that
 * accepts arbitrary addresses is a scanner.
 */
export type PaymentStatusResponse = {
  settled: boolean;
  intent_id: string;
  receipt_pda: string;
  session: string;
  message: string;
  receipt?: ReturnType<typeof serializeIntentReceipt>;
  session_resumed?: boolean;
};

export async function handleGetPaymentStatus(
  context: ServerContext,
  rawInput: unknown,
): Promise<PaymentStatusResponse> {
  const input = mcpGetPaymentStatusSchema.parse(rawInput);
  const intentId = intentIdFromHex(input.intent_id);

  const resolution = await resolvePaymentOutcome({
    rpc: context.runtime.rpc,
    session: context.bound.session,
    intentId,
    attempts: 1,
  });

  if (resolution.outcome === "settled") {
    const resumed = context.governor.clearQuiesce(input.intent_id);
    return {
      settled: true,
      intent_id: input.intent_id,
      receipt_pda: resolution.receipt,
      session: context.bound.session,
      message: `Payment settled at sequence ${resolution.receiptData.seq}.`,
      receipt: serializeIntentReceipt(resolution.receiptData),
      ...(resumed ? { session_resumed: true } : {}),
    };
  }

  // No receipt. That is not the same as "it did not happen" — a receipt is closeable after
  // its grace period, and a transaction can still be in flight — so the message says what
  // is known rather than inviting a retry.
  return {
    settled: false,
    intent_id: input.intent_id,
    receipt_pda: resolution.receipt,
    session: context.bound.session,
    message:
      "No receipt exists for this intent. If a payment was just attempted it may still be " +
      "in flight; check again before assuming it did not happen.",
  };
}
