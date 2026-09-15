import { z } from "zod";

/**
 * How a payment attempt ended (ADR-004; blueprint III-B).
 *
 * The distinction that matters is `denied` vs `indeterminate`. A denial is a decision: the
 * payment did not happen and will not happen for these parameters, so a caller may safely
 * change something and try again. An indeterminate result is the absence of a decision —
 * the transaction was broadcast and nobody knows whether it landed. Reporting the second as
 * the first is what turns a slow RPC node into a double payment, because "denied" reads as
 * an invitation to retry.
 */
export const PAYMENT_OUTCOMES = [
  /** The transfer is on-chain, either from this attempt or an earlier one. */
  "settled",
  /** A rule refused it. Nothing moved. Terminal for these exact parameters. */
  "denied",
  /** Broadcast, unconfirmed. The only permitted next step is resolving it by receipt. */
  "indeterminate",
  /** Held for a human. Terminal for the agent: retrying cannot change the answer. */
  "review_required",
] as const;

export type PaymentOutcome = (typeof PAYMENT_OUTCOMES)[number];

export const paymentOutcomeSchema = z.enum(PAYMENT_OUTCOMES);

/**
 * Whether an agent may issue another `execute_payment` after seeing this outcome.
 *
 * `settled` and `review_required` are terminal because the answer will not change.
 * `indeterminate` is *not* retryable and that is the whole point: the caller must resolve
 * the receipt first. Only `denied` permits a new attempt, and only with different inputs.
 */
export function isRetryable(outcome: PaymentOutcome): boolean {
  return outcome === "denied";
}

/** Outcomes that must never be followed by another payment attempt for the same intent. */
export function isTerminal(outcome: PaymentOutcome): boolean {
  return outcome === "settled" || outcome === "review_required";
}
