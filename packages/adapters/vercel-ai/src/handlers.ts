import type {
  McpCheckPaymentInput,
  McpExecutePaymentInput,
  McpGetPaymentStatusInput,
} from "@agent-rails/contract";

/**
 * In-process backend for Agent Rails tools. Wire these to `@agent-rails/mcp` handlers,
 * a test double, or your own RPC orchestration — the adapter only maps to Vercel AI SDK.
 */
export type AgentRailsToolsBackend = {
  getSession: () => Promise<unknown>;
  getPolicy: () => Promise<unknown>;
  listDestinations: () => Promise<unknown>;
  getPaymentStatus: (input: McpGetPaymentStatusInput) => Promise<unknown>;
  checkPayment: (input: McpCheckPaymentInput) => Promise<unknown>;
  executePayment: (input: McpExecutePaymentInput) => Promise<unknown>;
};
