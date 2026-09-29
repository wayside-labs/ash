import {
  AGENT_TOOL_NAMES,
  type AgentToolName,
  mcpCheckPaymentSchema,
  mcpExecutePaymentSchema,
  mcpGetPaymentStatusSchema,
  mcpGetPolicySchema,
  mcpGetSessionSchema,
  mcpListDestinationsSchema,
  mcpRequestLimitIncreaseSchema,
} from "@agent-rails/contract";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { McpServerConfig } from "../config.js";
import type { ServerContext } from "../context.js";
import { handleCheckPayment } from "../handlers/check-payment.js";
import { handleExecutePayment } from "../handlers/execute-payment.js";
import { handleGetPaymentStatus } from "../handlers/get-payment-status.js";
import { handleGetPolicy } from "../handlers/get-policy.js";
import { handleGetSession } from "../handlers/get-session.js";
import { handleListDestinations } from "../handlers/list-destinations.js";
import { handleRequestLimitIncrease } from "../handlers/request-limit-increase.js";
import { toolJsonResult } from "./response.js";

/**
 * The whole agent-facing surface, in one place so it can be asserted against
 * `AGENT_TOOL_NAMES` in CI (ADR-007).
 *
 * Nothing here loosens a constraint. Reads report state, `check_payment` proposes,
 * `execute_payment` pays within a policy it cannot alter, and `get_payment_status` resolves
 * an outcome. Adding a tool that configures anything is the one change this file exists to
 * make hard to do by accident.
 */

type ToolDefinition = {
  name: AgentToolName;
  description: string;
  // biome-ignore lint/suspicious/noExplicitAny: heterogeneous zod schemas per tool
  inputSchema: any;
  handler: (context: ServerContext, input: unknown) => unknown;
};

export const TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: "agent_rails_get_session",
    description:
      "Report this agent's session: expiry, revocation status, sequence number, and " +
      "per-mint spend counters including lifetime spend.",
    inputSchema: mcpGetSessionSchema,
    handler: (context) => handleGetSession(context),
  },
  {
    name: "agent_rails_get_policy",
    description:
      "Report the spending policy in force: per-transaction, window and lifetime limits, " +
      "destination mode, and whether a memo is required.",
    inputSchema: mcpGetPolicySchema,
    handler: (context) => handleGetPolicy(context),
  },
  {
    name: "agent_rails_list_destinations",
    description:
      "List the destinations this session may pay, by label. Use a label from this list as " +
      "destination_ref; raw addresses are refused under an allowlist policy.",
    inputSchema: mcpListDestinationsSchema,
    handler: (context) => handleListDestinations(context),
  },
  {
    name: "agent_rails_get_payment_status",
    description:
      "Look up whether a payment settled, by intent_id. This is the authoritative answer " +
      "and the only correct response to an indeterminate outcome.",
    inputSchema: mcpGetPaymentStatusSchema,
    handler: (context, input) => handleGetPaymentStatus(context, input),
  },
  {
    name: "agent_rails_check_payment",
    description:
      "Dry-run a payment: resolve the destination and amount, simulate it against the " +
      "policy, and report whether it would be accepted. Sends nothing and costs nothing.",
    inputSchema: mcpCheckPaymentSchema,
    handler: (context, input) => handleCheckPayment(context, input),
  },
  {
    name: "agent_rails_execute_payment",
    description:
      'Pay a registered destination. Amounts are in human units (e.g. "12.50"); the ' +
      "destination is a label; reference identifies what is being settled and makes the " +
      "payment idempotent, so retrying the same reference cannot pay twice. Returns an " +
      "outcome of settled, denied, or indeterminate.",
    inputSchema: mcpExecutePaymentSchema,
    handler: (context, input) => handleExecutePayment(context, input),
  },
  {
    name: "agent_rails_request_limit_increase",
    description:
      "Ask the operator for more budget when the current limits block a legitimate task. " +
      "This only sends a message; it changes no limit, and you must keep working within the " +
      "current policy or stop.",
    inputSchema: mcpRequestLimitIncreaseSchema,
    handler: (context, input) => handleRequestLimitIncrease(context, input),
  },
];

/** Names actually registered, for the CI assertion against the committed contract. */
export const REGISTERED_TOOL_NAMES: readonly string[] = TOOL_DEFINITIONS.map((tool) => tool.name);

/**
 * What `AGENT_RAILS_TOOLS=readonly` registers. An allowlist rather than "everything but
 * execute": a write tool added later stays out of readonly mode until someone puts it here.
 */
export const READONLY_TOOL_NAMES: ReadonlySet<AgentToolName> = new Set<AgentToolName>([
  "agent_rails_get_session",
  "agent_rails_get_policy",
  "agent_rails_list_destinations",
  "agent_rails_get_payment_status",
  "agent_rails_check_payment",
  // Grants nothing: a planner that cannot pay may still say it needs budget.
  "agent_rails_request_limit_increase",
]);

export function toolsForMode(mode: McpServerConfig["toolsMode"]): ToolDefinition[] {
  return mode === "readonly"
    ? TOOL_DEFINITIONS.filter((tool) => READONLY_TOOL_NAMES.has(tool.name))
    : TOOL_DEFINITIONS;
}

export function registerTools(server: McpServer, context: ServerContext): void {
  const tools = toolsForMode(context.runtime.config.toolsMode);

  for (const tool of tools) {
    server.registerTool(
      tool.name,
      { description: tool.description, inputSchema: tool.inputSchema },
      async (input: unknown) => toolJsonResult(await tool.handler(context, input)),
    );
  }
}

export { AGENT_TOOL_NAMES };
