import type { AgentToolName } from "@agent-rails/contract";
import { type ToolSet, tool } from "ai";
import type { AgentRailsToolsBackend } from "./handlers.js";
import { AGENT_RAILS_TOOL_METADATA } from "./metadata.js";

const BACKEND_BY_TOOL: Record<
  AgentToolName,
  (backend: AgentRailsToolsBackend) => (input: unknown) => Promise<unknown>
> = {
  agent_rails_get_session: (backend) => async () => backend.getSession(),
  agent_rails_get_policy: (backend) => async () => backend.getPolicy(),
  agent_rails_list_destinations: (backend) => async () => backend.listDestinations(),
  agent_rails_get_payment_status: (backend) => async (input) =>
    backend.getPaymentStatus(input as Parameters<AgentRailsToolsBackend["getPaymentStatus"]>[0]),
  agent_rails_check_payment: (backend) => async (input) =>
    backend.checkPayment(input as Parameters<AgentRailsToolsBackend["checkPayment"]>[0]),
  agent_rails_execute_payment: (backend) => async (input) =>
    backend.executePayment(input as Parameters<AgentRailsToolsBackend["executePayment"]>[0]),
};

/**
 * Build a Vercel AI SDK `ToolSet` for every name in `AGENT_TOOL_NAMES`.
 * Schemas come from `@agent-rails/contract`; handlers are injected.
 */
export function createAgentRailsTools(backend: AgentRailsToolsBackend): ToolSet {
  const tools: ToolSet = {};

  for (const meta of AGENT_RAILS_TOOL_METADATA) {
    const run = BACKEND_BY_TOOL[meta.name](backend);
    tools[meta.name] = tool({
      description: meta.description,
      inputSchema: meta.inputSchema,
      execute: async (input) => run(input),
    });
  }

  return tools;
}
