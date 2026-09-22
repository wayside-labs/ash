import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Ui } from "./ui.js";
import { expandPath } from "./wallet.js";

/**
 * Locate the built MCP server entry point.
 *
 * Checked in order: explicit flag, next to this CLI inside the workspace, then relative to
 * the working directory for someone running from the repository root.
 */
export function resolveMcpEntry(explicit: string | undefined, ui: Ui): string {
  if (explicit) return expandPath(explicit);

  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    resolve(here, "../../mcp/dist/cli.js"),
    resolve(here, "../mcp/dist/cli.js"),
    resolve(process.cwd(), "packages/mcp/dist/cli.js"),
  ];

  const found = candidates.find((candidate) => existsSync(candidate));
  if (found) return found;

  ui.warn("The MCP server is not built - the config below points at a file that does not exist");
  ui.info(
    ui.dim("  Build it with `pnpm --filter @agent-rails/mcp build`, or pass --mcp-entry <path>."),
  );
  return candidates[candidates.length - 1] as string;
}

export function mcpEntryExists(explicit: string | undefined): boolean {
  const path = explicit ? expandPath(explicit) : resolveMcpEntryPath();
  return existsSync(path);
}

function resolveMcpEntryPath(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    resolve(here, "../../mcp/dist/cli.js"),
    resolve(here, "../mcp/dist/cli.js"),
    resolve(process.cwd(), "packages/mcp/dist/cli.js"),
  ];
  const fallback = candidates[candidates.length - 1] as string;
  return candidates.find((candidate) => existsSync(candidate)) ?? fallback;
}
