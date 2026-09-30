import type { StoredAgent, StoredMcp, StoredSkill, StoredWorkflow } from "@/lib/schema";
import { appliesToAgent } from "@/lib/scope";
import { renderSkillMarkdown, skillSlug } from "@/lib/skill-md";
import type { ZipEntry } from "@/lib/zip";

/**
 * The `mcpServers` map both `.mcp.json` and `claude_desktop_config.json` use.
 * Keeping the two file names apart buys nothing — the body is identical, so
 * one compiler serves both and the route only picks a filename.
 */
/**
 * How `services/connector-host` receives its bundle from a runner config. Inline rather than
 * a path, because a hosted dashboard and the operator's machine share no filesystem.
 */
export const CONNECTOR_BUNDLE_ENV = "CONNECTOR_BUNDLE_JSON";
/** The console script `uv tool install ./services/connector-host` puts on PATH. */
export const CONNECTOR_HOST_COMMAND = "agent-rails-connector";

export interface McpServerConfig {
  command: string;
  args: string[];
  env?: Record<string, string>;
}

export interface RunnerConfig {
  mcpServers: Record<string, McpServerConfig>;
}

export interface RunnerOptions {
  /**
   * The dashboard's ingest API and the workflow's token. Denials, review requests and budget
   * requests travel this way, and the dashboard fans them out to the notification channels
   * — which replaced the single alert webhook the MCP used to post to directly.
   */
  ingest?: { url: string; token: string };
  /** Per-agent exports: the knowledge MCP searches within this agent's document scope. */
  agentName?: string;
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

/** The knowledge MCP (`packages/knowledge-mcp`) also talks to this dashboard with the token. */
const KNOWLEDGE_MCP_LAUNCH =
  /agent-rails-knowledge-mcp|@agent-rails\/knowledge-mcp|packages[\\/]knowledge-mcp[\\/]/;

export function isKnowledgeMcp(mcp: Pick<StoredMcp, "command" | "args">): boolean {
  return [mcp.command, ...mcp.args].some((part) => KNOWLEDGE_MCP_LAUNCH.test(part));
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

function compileMcpServers(mcps: StoredMcp[], options?: RunnerOptions): CompiledRunnerConfig {
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

    // Only our two servers talk to the dashboard; no third-party MCP ever sees the token.
    if (options?.ingest && (isAgentRailsMcp(mcp) || isKnowledgeMcp(mcp))) {
      env.AGENT_RAILS_INGEST_URL = options.ingest.url;
      env.AGENT_RAILS_INGEST_TOKEN = options.ingest.token;
    }
    if (options?.agentName && isKnowledgeMcp(mcp)) env.AGENT_RAILS_AGENT_NAME = options.agentName;
    if (mcp.connector) {
      // The host reads only the names its bundle declares, and the bundle schema refuses
      // these prefixes; dropping them here keeps a hand-edited row from shipping them at all.
      for (const key of Object.keys(env)) {
        if (/^(AGENT_RAILS_|SOLANA_|CONNECTOR_)/.test(key)) delete env[key];
      }
      env[CONNECTOR_BUNDLE_ENV] = JSON.stringify(mcp.connector);
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
  options?: RunnerOptions,
): CompiledRunnerConfig {
  const inScope = mcps.filter((mcp) => appliesToAgent(mcp, agent, workflow));
  return compileMcpServers(inScope, { ...options, agentName: agent.name });
}

/**
 * Compiles shared MCPs for a workflow (global + workflow scope). Agent-scoped
 * servers are omitted — export per agent for role-specific MCP sets.
 */
export function compileRunnerConfig(
  workflow: StoredWorkflow,
  mcps: StoredMcp[],
  options?: RunnerOptions,
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

export function runnerBundleFilename(workflowName: string, agentName?: string): string {
  return runnerConfigFilename(workflowName, agentName).replace(/\.mcp\.json$/, ".agent.zip");
}

/**
 * Skills that travel with a runner: enabled and in scope, by the same rule as MCPs — the
 * agent export gets global + its workflow + itself, the workflow export never another
 * agent's. A skill with no body has nothing to teach and is left out.
 */
export function skillsInScope(
  skills: StoredSkill[],
  workflow: StoredWorkflow,
  agent?: StoredAgent,
): StoredSkill[] {
  return skills.filter((skill) => {
    if (!skill.enabled || !skill.content.trim()) return false;
    if (agent) return appliesToAgent(skill, agent, workflow);
    if (skill.scope === "agent") return false;
    return skill.scope === "global" || skill.scopeName === workflow.name;
  });
}

/**
 * The runner bundle: `.mcp.json` plus `.claude/skills/<slug>/SKILL.md` per skill, laid out
 * so that `claude -p` run from the unzipped directory picks both up with no flags beyond
 * `--mcp-config .mcp.json`.
 */
export function compileRunnerBundle(
  config: RunnerConfig,
  skills: StoredSkill[],
): { entries: ZipEntry[]; skillCount: number } {
  const entries: ZipEntry[] = [{ path: ".mcp.json", data: `${JSON.stringify(config, null, 2)}\n` }];
  const taken: Record<string, true> = {};
  for (const skill of skills) {
    const slug = uniqueKey(skillSlug(skill.name), taken);
    taken[slug] = true;
    entries.push({
      path: `.claude/skills/${slug}/SKILL.md`,
      data: renderSkillMarkdown({ ...skill, name: slug }),
    });
  }
  entries.push({
    path: "README.txt",
    data:
      "Agent Rails runner bundle.\n\n" +
      "  unzip <this file> -d agent && cd agent\n" +
      '  claude -p "<task>" --mcp-config .mcp.json --strict-mcp-config --setting-sources project\n\n' +
      ".mcp.json holds whole environment values (RPC URLs, key paths): keep this file private.\n",
  });
  return { entries, skillCount: skills.length };
}
