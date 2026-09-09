import type { SimulatePaymentInput, SimulatePaymentResult } from "./simulate.js";
import { simulatePayment } from "./simulate.js";

export type PreflightInput = SimulatePaymentInput;

/** Alias for MCP servers that want simulate-before-send semantics. */
export async function preflightPayment(input: PreflightInput): Promise<SimulatePaymentResult> {
  return simulatePayment(input);
}
