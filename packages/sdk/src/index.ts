export { agentRails, type AgentRailsPlugin, type AgentRailsPluginConfig, type AgentRailsSigner } from "./plugin.js";
export { AgentRailsError, isAgentRailsError, type AgentRailsErrorOptions } from "./errors.js";
export {
  buildPaymentIntent,
  createIntentId,
  type BlockhashLifetime,
  type BuildPaymentIntentParams,
  type PaymentIntent,
  type PaymentIntentBuildResult,
  type PaymentIntentInput,
  type PaymentPath,
  type PaymentPdas,
} from "./payment-intent.js";
export {
  agentRailsErrorFromCode,
  reasonCodeFromProgramError,
  toAgentRailsError,
} from "./error-mapping.js";
export { simulatePayment, type SimulatePaymentInput, type SimulatePaymentResult } from "./simulate.js";
export { sendPayment, type SendPaymentInput, type SendPaymentResult } from "./send-payment.js";
export {
  executePayment,
  type ExecutePaymentInput,
  type ExecutePaymentResult,
  type ExecutePaymentRpc,
} from "./execute-payment.js";
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
export {
  findAssociatedTokenAddress,
  findEventAuthorityPda,
  ASSOCIATED_TOKEN_PROGRAM_ADDRESS,
  TOKEN_PROGRAM_ADDRESS,
} from "./pdas.js";
export { runPolicyHooks, type PolicyHook, type PolicyHooks } from "./policy-hooks.js";

// Re-export the generated client for convenience.
export * from "@agent-rails/client";
