import { randomBytes } from "node:crypto";
import { z } from "zod";
import type { PaymentBuildInput } from "./payment-build.js";
import { paymentBuildSchema, paymentContextSchema } from "./payment-build.js";
import { paymentIntentSchema } from "./events.js";

const addressSchema = z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
const intentIdSchema = z.string().length(32).regex(/^[0-9a-f]+$/);

/**
 * MCP tool input for `agent_rails_execute_payment`.
 * JSON-safe variant of `paymentBuildSchema` (amount as base-unit string).
 */
export const mcpExecutePaymentSchema = paymentContextSchema.merge(
  paymentIntentSchema
    .omit({ amount: true, intent_id: true })
    .extend({
      intent_id: intentIdSchema.optional(),
      amount: z
        .string()
        .regex(/^\d+$/)
        .describe("Payment amount in base units (lamports or token smallest unit)"),
    }),
);

export type McpExecutePaymentInput = z.infer<typeof mcpExecutePaymentSchema>;

function createIntentIdHex(): string {
  return Array.from(randomBytes(16), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Lift MCP JSON args into the SDK `paymentBuildSchema` shape. */
export function toPaymentBuildInput(input: McpExecutePaymentInput): PaymentBuildInput {
  return paymentBuildSchema.parse({
    ...input,
    intent_id: input.intent_id ?? createIntentIdHex(),
    amount: BigInt(input.amount),
  });
}
