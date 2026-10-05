/**
 * Browser-safe entry: planning, policy, the runner and the ports. It imports neither the Cloak SDK
 * nor a Node built-in — `./adapter` loads the SDK when a run starts, `./node` is for scripts.
 */
export {
  COMMITMENT_MEMO,
  COMMITMENT_MEMO_PREFIX,
  commitmentMemo,
  MEMO_PROGRAM_ADDRESS,
  PRIVACY_TEXT_SHA256,
  parseCommitmentMemo,
} from "./commitment.js";
export * from "./constants.js";
export { classifyError, describeForConsole, RUN_ERROR_MESSAGES, RunError } from "./errors.js";
export { exitFeeLamports, formatZec, netAfterExitFee, zecMinOutput } from "./fees.js";
export {
  deriveMasterSeed,
  KEY_DERIVATION_DOMAIN,
  keyDerivationMessage,
  obtainMasterSeed,
} from "./keys.js";
export {
  buildRunPlan,
  newRunId,
  type PlanInput,
  type PlanPayout,
  payoutDigest,
  type RunPlan,
} from "./plan.js";
export {
  checkRunPolicy,
  type PolicyResult,
  parseAllowedWallets,
  parseContacts,
  type RunPolicyContext,
} from "./policy.js";
export type {
  ChainHealth,
  PayoutSession,
  RecoverScope,
  SdkPort,
  StageListener,
  TxReceipt,
  WalletPort,
} from "./ports.js";
export { quoteDrifted, quoteZecOut, quoteZecPayouts } from "./quotes.js";
export {
  buildProofPack,
  emptyRunLog,
  PROOF_NOTES,
  type ProofInput,
  type RunLog,
  reduceRunLog,
} from "./report.js";
export {
  type RecoverDeps,
  type RunnerDeps,
  type RunOutcome,
  recoverFunds,
  runPrivatePayout,
} from "./runner.js";
