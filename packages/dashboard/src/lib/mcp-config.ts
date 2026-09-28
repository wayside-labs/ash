import type { StoredAgent, StoredMcp, StoredWorkflow } from "@/lib/schema";
import { appliesToAgent } from "@/lib/scope";

/**
 * The `mcpServers` map both `.mcp.json` and `claude_desktop_config.json` use.
 * Keeping the two file names apart buys nothing — the body is identical, so
 * one compiler serves both and the route only picks a filename.
 */
export interface McpServerConfig {
  command: string;
  args: string[];
  env?: Record<string, string>;
}

export interface RunnerConfig {
  mcpServers: Record<string, McpServerConfig>;
}

export interface CompiledRunnerConfig {
  config: RunnerConfig;
  /** In scope and enabled, but with no `command` — there is nothing to spawn. */
  skipped: string[];
}

/**
 * MCP server keys address a server in the config file, so they have to be
 * stable and shell-safe even when the display name is "Jupiter Swap ✨".
 */
export function mcpServerKey(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "mcp";
}

/**
 * The rails server is launched several ways: the `agent-rails-mcp` bin, `npx @agent-rails/mcp`,
 * or `node` pointed at a checkout's `packages/mcp` build (what `mcp-snippet.ts` writes).
 * Matching on `command` alone missed the last two, and their denials never reached the webhook.
 */
const AGENT_RAILS_MCP_LAUNCH = /agent-rails-mcp|@agent-rails\/mcp|packages[\\/]mcp[\\/]/;

export function isAgentRailsMcp(mcp: Pick<StoredMcp, "command" | "args">): boolean {
  return [mcp.command, ...mcp.args].some((part) => AGENT_RAILS_MCP_LAUNCH.test(part));
}

/** Workflow-level export: global + workflow-scoped MCPs only (never another agent's MCP). */
export function appliesToWorkflowExport(mcp: StoredMcp, workflow: StoredWorkflow): boolean {
  switch (mcp.scope) {
    case "global":
      return true;
    case "workflow":
      return mcp.scopeName === workflow.name;
    case "agent":
      return false;
  }
}

function compileMcpServers(
  mcps: StoredMcp[],
  options?: { alertWebhookUrl?: string },
): CompiledRunnerConfig {
  const mcpServers: Record<string, McpServerConfig> = {};
  const skipped: string[] = [];

  for (const mcp of mcps) {
    if (!mcp.enabled) continue;
    if (!mcp.command.trim()) {
      skipped.push(mcp.name);
      continue;
    }

    const env = Object.fromEntries(
      Object.entries(mcp.env).filter(([, value]) => value !== ""),
    ) as Record<string, string>;

    const alertUrl = options?.alertWebhookUrl?.trim();
    if (alertUrl && isAgentRailsMcp(mcp)) {
      env.AGENT_RAILS_ALERT_WEBHOOK_URL = alertUrl;
    }

    mcpServers[uniqueKey(mcpServerKey(mcp.name), mcpServers)] = {
      command: mcp.command.trim(),
      args: mcp.args.filter((arg) => arg !== ""),
      ...(Object.keys(env).length > 0 ? { env } : {}),
    };
  }

  return { config: { mcpServers }, skipped };
}

/**
 * Compiles MCPs for a single agent (global + workflow + that agent's scope).
 * Use this for runner downloads so a scout never inherits the builder's payment MCP.
 */
export function compileRunnerConfigForAgent(
  agent: StoredAgent,
  workflow: StoredWorkflow,
  mcps: StoredMcp[],
  options?: { alertWebhookUrl?: string },
): CompiledRunnerConfig {
  const inScope = mcps.filter((mcp) => appliesToAgent(mcp, agent, workflow));
  return compileMcpServers(inScope, options);
}

/**
 * Compiles shared MCPs for a workflow (global + workflow scope). Agent-scoped
 * servers are omitted — export per agent for role-specific MCP sets.
 */
export function compileRunnerConfig(
  workflow: StoredWorkflow,
  mcps: StoredMcp[],
  options?: { alertWebhookUrl?: string },
): CompiledRunnerConfig {
  const inScope = mcps.filter((mcp) => appliesToWorkflowExport(mcp, workflow));
  return compileMcpServers(inScope, options);
}

/** Two MCPs may share a display name; the config map cannot share a key. */
function uniqueKey(base: string, taken: Record<string, unknown>): string {
  if (!Object.hasOwn(taken, base)) return base;
  let n = 2;
  while (Object.hasOwn(taken, `${base}-${n}`)) n += 1;
  return `${base}-${n}`;
}

export function runnerConfigFilename(workflowName: string, agentName?: string): string {
  const slug = mcpServerKey(workflowName);
  if (!agentName?.trim()) return `${slug}.mcp.json`;
  return `${slug}-${mcpServerKey(agentName)}.mcp.json`;
}
