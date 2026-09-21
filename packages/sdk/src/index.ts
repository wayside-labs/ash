// Re-export the generated client for convenience.
export * from "@agent-rails/client";
export {
  type DestinationEntry,
  type DestinationIndex,
  editDistance,
  loadDestinationIndex,
  nearMisses,
  normalizeLabel,
  type ResolvedDestination,
  resolveDestination,
} from "./destinations.js";
export {
  type EnableNativeAllowanceTxParams,
  type EnableNativeAllowanceTxResult,
  enableNativeAllowanceTx,
} from "./enable-native-allowance.js";
export {
  agentRailsErrorFromCode,
  customCodeFromTransactionError,
  reasonCodeFromProgramError,
  stringifyRpcError,
  toAgentRailsError,
} from "./error-mapping.js";
export {
  AgentRailsError,
  type AgentRailsErrorOptions,
  isAgentRailsError,
  isIndeterminate,
} from "./errors.js";
export {
  type ExecutePaymentInput,
  type ExecutePaymentResult,
  type ExecutePaymentRpc,
  executePayment,
} from "./execute-payment.js";
export {
  type BlockhashLifetime,
  type BuildPaymentIntentParams,
  buildPaymentIntent,
  createIntentId,
  type PaymentIntent,
  type PaymentIntentBuildResult,
  type PaymentIntentInput,
  type PaymentPath,
  type PaymentPdas,
} from "./payment-intent.js";
export {
  ASSOCIATED_TOKEN_PROGRAM_ADDRESS,
  findAllowlistPda,
  findAssociatedTokenAddress,
  findEntryPda,
  findEventAuthorityPda,
  findNativeFixedDelegationPda,
  findNativeSubscriptionAuthorityPda,
  findPolicyPda,
  findReceiptPda,
  findSessionPda,
  findSolVaultPda,
  findTreasuryPda,
  NATIVE_ALLOWANCE_NONCE,
  NATIVE_SUBSCRIPTIONS_PROGRAM_ADDRESS,
  TOKEN_PROGRAM_ADDRESS,
} from "./pdas.js";
export {
  type AgentRailsPlugin,
  type AgentRailsPluginConfig,
  type AgentRailsSigner,
  agentRails,
} from "./plugin.js";
export {
  type HookVerdict,
  type PolicyHook,
  type PolicyHookRequest,
  type PolicyHooks,
  runPolicyHooks,
} from "./policy-hooks.js";
export { type PreflightInput, preflightPayment } from "./preflight.js";
export {
  createRemoteSigner,
  type RemoteSignerConfig,
  RemoteSignerError,
} from "./remote-signer.js";
export {
  type PaymentResolution,
  precheckReceipt,
  type ReceiptPrecheck,
  type ResolvePaymentInput,
  type ResolveRpc,
  resolvePaymentOutcome,
} from "./resolve.js";
export {
  type AgentRailsSecurityConfig,
  type ChainFacts,
  type MintView,
  type ResolvedSecurity,
  requirementsFor,
  resolveSecurity,
  securityCoherenceWarnings,
} from "./security.js";
export { type SendPaymentInput, type SendPaymentResult, sendPayment } from "./send-payment.js";
export {
  type SimulatePaymentInput,
  type SimulatePaymentResult,
  simulatePayment,
} from "./simulate.js";
