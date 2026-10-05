import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * The project was renamed from Agent Rails to ASH. Env files, MCP configs and shell scripts
 * written before the rename still say AGENT_RAILS_*, so ASH_* is preferred and the old name is
 * the fallback. Drop the fallback once no config in the field uses AGENT_RAILS_*.
 */
const LEGACY_PREFIX = "AGENT_RAILS_";
const PREFIX = "ASH_";

/** Copies each AGENT_RAILS_* value to its ASH_* name unless the ASH_* name is already set. */
export function applyLegacyEnv(env: Record<string, string | undefined> = process.env): void {
  for (const key of Object.keys(env)) {
    if (!key.startsWith(LEGACY_PREFIX)) continue;
    const next = PREFIX + key.slice(LEGACY_PREFIX.length);
    if (env[next] === undefined) env[next] = env[key];
  }
}

/**
 * The operator's home directory (keys, dashboard state, agent runs). Prefers ~/.ash, but keeps
 * using ~/.agent-rails when only that exists, so an existing install is not stranded.
 */
export function ashHome(env: Record<string, string | undefined> = process.env): string {
  if (env.ASH_HOME) return env.ASH_HOME;
  if (env.AGENT_RAILS_HOME) return env.AGENT_RAILS_HOME;
  const current = join(homedir(), ".ash");
  const legacy = join(homedir(), ".agent-rails");
  return !existsSync(current) && existsSync(legacy) ? legacy : current;
}
