import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { type DashboardState, dashboardStateSchema } from "@/lib/schema";
import { seedState } from "./seed";

/**
 * Same home directory the CLI writes its manifests to, so `agent-rails init`
 * and the dashboard describe one deployment instead of two.
 */
export function storePath(): string {
  const home = process.env.AGENT_RAILS_HOME ?? join(homedir(), ".agent-rails");
  return join(home, "dashboard.json");
}

/**
 * Next dev-mode recompiles a route module per request, so a module-level lock
 * only serialises writes within one module instance. The temp-file + rename
 * below is what actually keeps a half-written document off disk.
 */
let writeChain: Promise<unknown> = Promise.resolve();

async function readRaw(): Promise<DashboardState> {
  const path = storePath();
  try {
    const parsed = dashboardStateSchema.safeParse(JSON.parse(await readFile(path, "utf8")));
    if (parsed.success) return parsed.data;
    await rename(path, `${path}.corrupt-${Date.now()}`).catch(() => {});
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "ENOENT") throw error;
  }
  const seeded = seedState();
  await persist(seeded);
  return seeded;
}

async function persist(state: DashboardState): Promise<void> {
  const path = storePath();
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.${randomUUID()}.tmp`;
  await writeFile(tmp, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
  await rename(tmp, path);
}

export async function readState(): Promise<DashboardState> {
  return readRaw();
}

export async function mutateState<T>(
  fn: (state: DashboardState) => T | Promise<T>,
): Promise<{ state: DashboardState; result: T }> {
  const run = async () => {
    const state = await readRaw();
    const result = await fn(state);
    await persist(state);
    return { state, result };
  };
  const next = writeChain.then(run, run);
  writeChain = next.catch(() => {});
  return next;
}

export async function resetState(): Promise<DashboardState> {
  const fresh = seedState();
  await persist(fresh);
  return fresh;
}

export function newId(prefix: string): string {
  return `${prefix}_${randomUUID().slice(0, 8)}`;
}
