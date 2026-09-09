import { z } from "zod";
import { ALL_REASON_CODES } from "./reason-codes.js";

const addressSchema = z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
const intentIdSchema = z.string().length(32).regex(/^[0-9a-f]+$/);

export const paymentDeniedSchema = z.object({
  session: addressSchema,
  intent: intentIdSchema,
  reason_code: z.enum(ALL_REASON_CODES),
  source: z.enum(["hook", "simulation"]),
});

export type PaymentDenied = z.infer<typeof paymentDeniedSchema>;

export const paymentIntentSchema = z.object({
  intent_id: intentIdSchema,
  mint: addressSchema,
  destination: addressSchema,
  amount: z.bigint().positive(),
  expires_at: z.number().int().positive(),
  memo: z.string().max(64).optional(),
});

export type PaymentIntentInput = z.infer<typeof paymentIntentSchema>;
