import type { StoredAgent, StoredMcp, StoredWorkflow } from "@/lib/schema";

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
 * Global MCPs reach every workflow. Scoped ones match by the free-text
 * `scopeName` the scope pages write: a workflow name, or the name of an agent
 * that belongs to this workflow.
 */
export function appliesToWorkflow(
  mcp: StoredMcp,
  workflow: StoredWorkflow,
  agents: StoredAgent[],
): boolean {
  switch (mcp.scope) {
    case "global":
      return true;
    case "workflow":
      return mcp.scopeName === workflow.name;
    case "agent":
      return agents.some((agent) => agent.name === mcp.scopeName);
  }
}

/**
 * Compiles the MCPs a workflow's agents run with into a runner config. Only
 * `enabled` rows are considered — the toggle on /mcps is the switch that
 * decides what ends up in the agent's environment.
 */
export function compileRunnerConfig(
  workflow: StoredWorkflow,
  agents: StoredAgent[],
  mcps: StoredMcp[],
): CompiledRunnerConfig {
  const workflowAgents = agents.filter((agent) => agent.workflowId === workflow.id);
  const mcpServers: Record<string, McpServerConfig> = {};
  const skipped: string[] = [];

  for (const mcp of mcps) {
    if (!mcp.enabled) continue;
    if (!appliesToWorkflow(mcp, workflow, workflowAgents)) continue;
    if (!mcp.command.trim()) {
      skipped.push(mcp.name);
      continue;
    }

    const env = Object.fromEntries(
      Object.entries(mcp.env).filter(([, value]) => value !== ""),
    ) as Record<string, string>;

    mcpServers[uniqueKey(mcpServerKey(mcp.name), mcpServers)] = {
      command: mcp.command.trim(),
      args: mcp.args.filter((arg) => arg !== ""),
      ...(Object.keys(env).length > 0 ? { env } : {}),
    };
  }

  return { config: { mcpServers }, skipped };
}

/** Two MCPs may share a display name; the config map cannot share a key. */
function uniqueKey(base: string, taken: Record<string, unknown>): string {
  if (!Object.hasOwn(taken, base)) return base;
  let n = 2;
  while (Object.hasOwn(taken, `${base}-${n}`)) n += 1;
  return `${base}-${n}`;
}

export function runnerConfigFilename(workflowName: string): string {
  const slug = mcpServerKey(workflowName);
  return `${slug}.mcp.json`;
}
