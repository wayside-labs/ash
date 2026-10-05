import type {
  McpCheckPaymentInput,
  McpExecutePaymentInput,
  McpGetPaymentStatusInput,
  McpRequestLimitIncreaseInput,
} from "@ash/contract";

/**
 * In-process backend for ASH tools. Wire these to `@ash/mcp` handlers,
 * a test double, or your own RPC orchestration — the adapter only maps to Vercel AI SDK.
 */
export type AshToolsBackend = {
  getSession: () => Promise<unknown>;
  getPolicy: () => Promise<unknown>;
  listDestinations: () => Promise<unknown>;
  getPaymentStatus: (input: McpGetPaymentStatusInput) => Promise<unknown>;
  checkPayment: (input: McpCheckPaymentInput) => Promise<unknown>;
  executePayment: (input: McpExecutePaymentInput) => Promise<unknown>;
  /** Forwards a budget request to the operator; must not change any limit. */
  requestLimitIncrease: (input: McpRequestLimitIncreaseInput) => Promise<unknown>;
};
