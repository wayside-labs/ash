export { agentRails, type AgentRailsPlugin, type AgentRailsPluginConfig, type AgentRailsSigner } from "./plugin.js";
export { AgentRailsError, isAgentRailsError, type AgentRailsErrorOptions } from "./errors.js";
export { buildPaymentIntent, createIntentId, type PaymentIntent, type PaymentIntentInput } from "./payment-intent.js";
export {
  findAllowlistPda,
  findEntryPda,
  findPolicyPda,
  findReceiptPda,
  findSessionPda,
  findSolVaultPda,
  findTreasuryPda,
} from "./pdas.js";
export { preflightPayment, type PreflightInput } from "./preflight.js";
export { runPolicyHooks, type PolicyHook, type PolicyHooks } from "./policy-hooks.js";

// Re-export the generated client for convenience.
export * from "@agent-rails/client";
