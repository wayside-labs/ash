import { describeSecurity } from "@agent-rails/contract";
import {
  type AgentRailsSecurityConfig,
  resolveSecurity,
  securityCoherenceWarnings,
} from "@agent-rails/sdk";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { type BoundContext, bindSession } from "./bound-context.js";
import { createRuntime, loadConfigFromEnv, type McpRuntime } from "./config.js";
import type { ServerContext } from "./context.js";
import { createDryRunLedger } from "./dry-runs.js";
import { PaymentGovernor } from "./governor.js";
import { loadSessionSigners, type SessionSigners } from "./session.js";
import { createPaymentSink } from "./sink.js";
import { registerTools } from "./tools/index.js";

export const MCP_SERVER_NAME = "agent-rails";
export const MCP_SERVER_VERSION = "0.0.0";

export type CreateMcpServerOptions = {
  runtime: McpRuntime;
  signers: SessionSigners;
  bound: BoundContext;
  /**
   * Guard-rail posture. Hooks can only arrive this way; presets and the simpler dials can
   * also come from the environment.
   */
  security?: AgentRailsSecurityConfig;
};

/**
 * Instructions the model sees when the server connects.
 *
 * Worth being exact here. The two behaviours that matter are using labels rather than
 * addresses, and never retrying an indeterminate payment — the second because a retry there
 * is the one mistake that spends money twice, and the guidance is the cheapest place to say
 * so even though the governor enforces it anyway.
 */
const INSTRUCTIONS = [
  "Agent Rails pays from a treasury you do not control, under a policy you cannot change.",
  "",
  "Destinations are labels, not addresses: call agent_rails_list_destinations and pass a",
  'label as destination_ref. Amounts are human units, e.g. "12.50". Every payment needs a',
  "reference naming what it settles (an invoice number, a task id); the same reference",
  "always means the same payment, so a retry cannot pay twice.",
  "",
  "Use agent_rails_check_payment first: it resolves and simulates the payment without",
  "sending anything.",
  "",
  "Every result carries an outcome. settled means the money moved. denied means it did not,",
  "and the reason_code says why. indeterminate means nobody knows yet: call",
  "agent_rails_get_payment_status with the intent_id. Never re-issue a payment after an",
  "indeterminate result.",
].join("\n");

export function createMcpServer(options: CreateMcpServerOptions): McpServer {
  const server = new McpServer(
    { name: MCP_SERVER_NAME, version: MCP_SERVER_VERSION },
    { instructions: INSTRUCTIONS },
  );

  const security = resolveSecurity({
    preset: options.security?.preset ?? options.runtime.config.securityPreset,
    posture: { ...options.runtime.config.securityOverrides, ...options.security?.posture },
    ...(options.security?.hooks ? { hooks: options.security.hooks } : {}),
  });

  const context: ServerContext = {
    runtime: options.runtime,
    signers: options.signers,
    bound: options.bound,
    security,
    governor: new PaymentGovernor({
      maxPaymentsPerMinute: security.posture.velocity.maxPaymentsPerMinute,
      maxConcurrent: security.posture.velocity.maxConcurrent,
    }),
    sink: createPaymentSink(options.runtime.config.sinkPath),
    dryRuns: createDryRunLedger(),
  };

  registerTools(server, context);
  return server;
}

/**
 * Start up, or refuse to.
 *
 * Binding happens before the transport is connected, so a server that cannot establish
 * which session it serves, whether its signer matches, or which destinations exist never
 * reaches a state where it can be asked to pay someone.
 */
export async function startStdioServer(
  env: NodeJS.ProcessEnv = process.env,
  security?: AgentRailsSecurityConfig,
): Promise<void> {
  const config = loadConfigFromEnv(env);
  const runtime = createRuntime(config);
  const signers = await loadSessionSigners(runtime);
  const bound = await bindSession(runtime, signers);

  const server = createMcpServer({ runtime, signers, bound, ...(security ? { security } : {}) });

  // stdio is the transport, so the posture goes to stderr: a developer should be able to
  // see what their server will refuse without sending it a payment.
  const resolved = resolveSecurity({
    preset: security?.preset ?? config.securityPreset,
    posture: { ...config.securityOverrides, ...security?.posture },
    ...(security?.hooks ? { hooks: security.hooks } : {}),
  });
  console.error(`[agent-rails-mcp] security preset: ${resolved.preset}`);
  for (const line of describeSecurity(resolved.posture)) {
    console.error(`[agent-rails-mcp]   ${line}`);
  }
  for (const warning of securityCoherenceWarnings(resolved, {
    destinationMode: bound.destinationMode,
    requireMemo: bound.requireMemo,
    allowAnyDestination: bound.destinationMode === 0,
    registeredDestinations: bound.destinations.entries.length,
  })) {
    console.error(`[agent-rails-mcp] warning: ${warning}`);
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);
}
