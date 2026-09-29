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

/**
 * A payment the mediation plane held for a person (security posture `human-review`). It was
 * not sent. The intent id is the key a later approval is bound to: the same arguments derive
 * the same id, so an approval can release exactly this payment and nothing else.
 */
export const paymentReviewRequiredSchema = z.object({
  treasury: addressSchema,
  policy: addressSchema,
  session: addressSchema,
  intent_id: z.string().regex(/^[0-9a-f]{32}$/),
  destination: addressSchema,
  destination_label: z.string().max(64).optional(),
  mint: addressSchema,
  /** Base units, as a decimal string. */
  amount: z.string().regex(/^\d+$/),
  reference: z.string().min(1).max(128),
  memo: z.string().max(64).optional(),
});

export type PaymentReviewRequired = z.infer<typeof paymentReviewRequiredSchema>;

/**
 * An agent asking for more budget (ADR-007's `request_*` pattern). Grants nothing: it is a
 * message to the operator, who decides through the CLI or the dashboard.
 */
export const limitIncreaseRequestedSchema = z.object({
  treasury: addressSchema,
  policy: addressSchema,
  session: addressSchema,
  reason: z.string().min(1).max(500),
  mint: addressSchema.optional(),
  /** Human units the agent believes it needs, as it stated them. Advisory only. */
  requested_amount: z
    .string()
    .regex(/^\d+(\.\d+)?$/)
    .optional(),
});

export type LimitIncreaseRequested = z.infer<typeof limitIncreaseRequestedSchema>;

/**
 * Everything an agent-side process reports to the operator's dashboard: the two webhook
 * alerts plus the two events that only make sense with a dashboard on the other end.
 * Webhook receivers keep seeing `AlertWebhookPayload` alone; this union is the ingest API's.
 */
export const agentEventSchema = z.discriminatedUnion("kind", [
  ...alertWebhookPayloadSchema.options,
  z.object({
    schema_version: z.literal(1),
    kind: z.literal("payment_review_required"),
    ts: z.string(),
    review: paymentReviewRequiredSchema,
  }),
  z.object({
    schema_version: z.literal(1),
    kind: z.literal("limit_increase_requested"),
    ts: z.string(),
    request: limitIncreaseRequestedSchema,
  }),
]);

export type AgentEvent = z.infer<typeof agentEventSchema>;
export type AgentEventKind = AgentEvent["kind"];

export const AGENT_EVENT_KINDS = [
  "payment_denied",
  "headroom_low",
  "payment_review_required",
  "limit_increase_requested",
] as const satisfies readonly AgentEventKind[];

/** Where an event's treasury is, whatever its kind. */
export function agentEventTreasury(event: AgentEvent): string {
  switch (event.kind) {
    case "payment_denied":
      return event.denial.treasury;
    case "headroom_low":
      return event.headroom.treasury;
    case "payment_review_required":
      return event.review.treasury;
    case "limit_increase_requested":
      return event.request.treasury;
  }
}
