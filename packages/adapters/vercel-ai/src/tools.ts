import type { AgentToolName } from "@ash/contract";
import { type ToolSet, tool } from "ai";
import type { AshToolsBackend } from "./handlers.js";
import { ASH_TOOL_METADATA } from "./metadata.js";

const BACKEND_BY_TOOL: Record<
  AgentToolName,
  (backend: AshToolsBackend) => (input: unknown) => Promise<unknown>
> = {
  ash_get_session: (backend) => async () => backend.getSession(),
  ash_get_policy: (backend) => async () => backend.getPolicy(),
  ash_list_destinations: (backend) => async () => backend.listDestinations(),
  ash_get_payment_status: (backend) => async (input) =>
    backend.getPaymentStatus(input as Parameters<AshToolsBackend["getPaymentStatus"]>[0]),
  ash_check_payment: (backend) => async (input) =>
    backend.checkPayment(input as Parameters<AshToolsBackend["checkPayment"]>[0]),
  ash_execute_payment: (backend) => async (input) =>
    backend.executePayment(input as Parameters<AshToolsBackend["executePayment"]>[0]),
  ash_request_limit_increase: (backend) => async (input) =>
    backend.requestLimitIncrease(input as Parameters<AshToolsBackend["requestLimitIncrease"]>[0]),
};

/**
 * Build a Vercel AI SDK `ToolSet` for every name in `AGENT_TOOL_NAMES`.
 * Schemas come from `@ash/contract`; handlers are injected.
 */
export function createAshTools(backend: AshToolsBackend): ToolSet {
  const tools: ToolSet = {};

  for (const meta of ASH_TOOL_METADATA) {
    const run = BACKEND_BY_TOOL[meta.name](backend);
    tools[meta.name] = tool({
      description: meta.description,
      inputSchema: meta.inputSchema,
      execute: async (input) => run(input),
    });
  }

  return tools;
}
