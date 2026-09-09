import { z } from "zod";
import { paymentIntentSchema } from "./events.js";

const addressSchema = z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);

/** On-chain payment context required to assemble an execute_* instruction. */
export const paymentContextSchema = z.object({
  treasury: addressSchema,
  policy: addressSchema,
  session: addressSchema,
  allowlistEntry: addressSchema.optional(),
  tokenProgram: addressSchema.optional(),
});

export type PaymentContext = z.infer<typeof paymentContextSchema>;

/** Full SDK payment build payload: validated intent + treasury context. */
export const paymentBuildSchema = paymentIntentSchema.merge(paymentContextSchema);

export type PaymentBuildInput = z.infer<typeof paymentBuildSchema>;
