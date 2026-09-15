import { z } from "zod";
import { paymentOutcomeSchema } from "./outcome.js";
import { ALL_REASON_CODES } from "./reason-codes.js";

const addressSchema = z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
const intentIdSchema = z
  .string()
  .length(32)
  .regex(/^[0-9a-f]+$/);

/**
 * Where a decision was made.
 *
 * Denials caught before the chain never appear in an on-chain event, so the operator's sink
 * is the only place the two kinds of outcome meet. Recording which layer refused is what
 * makes "the agent tried something odd 40 times" visible rather than merely absent.
 */
export const decisionSourceSchema = z.enum([
  /** Tool schema, including unknown keys. */
  "schema",
  /** Label, mint or amount resolution (blueprint L2). */
  "resolver",
  /** Rate limit, concurrency cap, quiesce (blueprint L5). */
  "governor",
  /** Soft policy hook (ADR-005 section 6). */
  "hook",
  /** On-chain simulation (blueprint L7). */
  "simulation",
  /** The program itself, at send time. */
  "program",
]);

export type DecisionSource = z.infer<typeof decisionSourceSchema>;

export const paymentDeniedSchema = z.object({
  session: addressSchema,
  intent: intentIdSchema,
  reason_code: z.enum(ALL_REASON_CODES),
  source: decisionSourceSchema,
});

export type PaymentDenied = z.infer<typeof paymentDeniedSchema>;

/**
 * The structured record written for every payment attempt, settled or not.
 *
 * Same shape for both outcomes so one downstream pipeline sees the whole picture, which is
 * what ARCHITECTURE section 8 asks for. This is the operator's channel: it holds what the
 * agent-facing response deliberately does not (simulation logs, raw errors), because those
 * are an injection carrier on the way back into a model context (blueprint I-5).
 */
export const paymentRecordSchema = z.object({
  ts: z.string(),
  treasury: addressSchema,
  session: addressSchema,
  policy: addressSchema,
  intent: intentIdSchema,
  outcome: paymentOutcomeSchema,
  reason_code: z.enum(ALL_REASON_CODES).optional(),
  source: decisionSourceSchema.optional(),
  destination: addressSchema.optional(),
  destination_label: z.string().optional(),
  mint: addressSchema.optional(),
  amount: z.string().optional(),
  reference: z.string().optional(),
  signature: z.string().optional(),
  receipt: addressSchema.optional(),
  logs: z.array(z.string()).optional(),
  units_consumed: z.string().optional(),
  detail: z.string().optional(),
});

export type PaymentRecord = z.infer<typeof paymentRecordSchema>;

export const paymentIntentSchema = z.object({
  intent_id: intentIdSchema,
  mint: addressSchema,
  destination: addressSchema,
  amount: z.bigint().positive(),
  expires_at: z.number().int().positive(),
  memo: z.string().max(64).optional(),
});

export type PaymentIntentInput = z.infer<typeof paymentIntentSchema>;
