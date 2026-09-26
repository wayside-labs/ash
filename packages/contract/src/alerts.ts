import { z } from "zod";
import { type decisionSourceSchema, paymentDeniedSchema } from "./events.js";

const addressSchema = z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);

export const headroomLowAlertSchema = z.object({
  treasury: addressSchema,
  session: addressSchema,
  policy: addressSchema,
  mint: addressSchema,
  window: z.enum(["short", "long"]),
  spent: z.string(),
  limit: z.string(),
  /** Remaining headroom as basis points of the window limit (0–10000). */
  headroom_bps: z.number().int().min(0).max(10_000),
  /** Fired when headroom falls below this threshold (default 2000 = 20% left). */
  headroom_threshold_bps: z.number().int().min(0).max(10_000),
});

export type HeadroomLowAlert = z.infer<typeof headroomLowAlertSchema>;

export const paymentDeniedAlertSchema = paymentDeniedSchema.extend({
  treasury: addressSchema,
  policy: addressSchema.optional(),
});

export type PaymentDeniedAlert = z.infer<typeof paymentDeniedAlertSchema>;

export const alertWebhookPayloadSchema = z.discriminatedUnion("kind", [
  z.object({
    schema_version: z.literal(1),
    kind: z.literal("payment_denied"),
    ts: z.string(),
    denial: paymentDeniedAlertSchema,
  }),
  z.object({
    schema_version: z.literal(1),
    kind: z.literal("headroom_low"),
    ts: z.string(),
    headroom: headroomLowAlertSchema,
  }),
]);

export type AlertWebhookPayload = z.infer<typeof alertWebhookPayloadSchema>;

export type BuildPaymentDeniedAlertInput = {
  ts?: string;
  treasury: string;
  policy?: string;
  session: string;
  intent: string;
  reason_code: PaymentDeniedAlert["reason_code"];
  source: z.infer<typeof decisionSourceSchema>;
};

export function buildPaymentDeniedAlert(input: BuildPaymentDeniedAlertInput): AlertWebhookPayload {
  const denial: PaymentDeniedAlert = {
    treasury: input.treasury,
    session: input.session,
    intent: input.intent,
    reason_code: input.reason_code,
    source: input.source,
    ...(input.policy ? { policy: input.policy } : {}),
  };
  paymentDeniedAlertSchema.parse(denial);
  return {
    schema_version: 1,
    kind: "payment_denied",
    ts: input.ts ?? new Date().toISOString(),
    denial,
  };
}

export type BuildHeadroomLowAlertInput = {
  ts?: string;
  headroom: HeadroomLowAlert;
};

export function buildHeadroomLowAlert(input: BuildHeadroomLowAlertInput): AlertWebhookPayload {
  headroomLowAlertSchema.parse(input.headroom);
  return {
    schema_version: 1,
    kind: "headroom_low",
    ts: input.ts ?? new Date().toISOString(),
    headroom: input.headroom,
  };
}

/** Basis points of limit still available (0 when spent ≥ limit). */
export function headroomBps(spent: bigint, limit: bigint): number {
  if (limit <= 0n) return 10_000;
  if (spent >= limit) return 0;
  return Number(((limit - spent) * 10_000n) / limit);
}
