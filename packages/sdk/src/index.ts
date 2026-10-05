// Re-export the generated client for convenience.
export * from "@ash/client";
export {
  type PostAlertWebhookResult,
  postAgentEvent,
  postAlertWebhook,
} from "./alert-webhook.js";
export {
  AUDIT_PREIMAGE_LEN,
  type AuditChainVerification,
  type AuditLink,
  auditHeadToHex,
  auditPreimage,
  DOMAIN_AUDIT,
  GENESIS_PREIMAGE_LEN,
  genesisAuditHead,
  genesisPreimage,
  loadReceipts,
  nextAuditHead,
  type ReceiptRecord,
  verifyAuditChain,
} from "./audit.js";
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
  ashErrorFromCode,
  customCodeFromTransactionError,
  reasonCodeFromProgramError,
  stringifyRpcError,
  toAshError,
} from "./error-mapping.js";
export {
  AshError,
  type AshErrorOptions,
  isAshError,
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
  findPolicyPda,
  findReceiptPda,
  findSessionPda,
  findSolVaultPda,
  findTreasuryPda,
  TOKEN_PROGRAM_ADDRESS,
} from "./pdas.js";
export {
  type AshPlugin,
  type AshPluginConfig,
  type AshSigner,
  ash,
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
  type AshSecurityConfig,
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
