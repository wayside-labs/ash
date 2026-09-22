import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { GlobalCliOptions } from "../cli-options.js";
import { loadContext } from "../context.js";
import { renderMcpConfig } from "../mcp-config.js";
import { resolveMcpEntry } from "../mcp-entry.js";
import type { Ui } from "../ui.js";

export async function runMcpEmit(options: GlobalCliOptions, ui: Ui): Promise<number> {
  const ctx = await loadContext(options);
  const manifest = ctx.manifest;
  if (!manifest) {
    throw new Error("Manifest required for mcp emit");
  }

  const serverEntry = resolveMcpEntry(options.mcpEntry, ui);
  const sinkPath = join(ctx.outDir, "payments.jsonl");
  const configJson = renderMcpConfig({
    serverEntry,
    rpcUrl: ctx.rpcUrl,
    session: manifest.session,
    signerKeypairPath: manifest.sessionKeypairPath,
    feePayerKeypairPath: manifest.feePayerKeypairPath,
    sinkPath,
    ...(manifest.tokenMint && manifest.tokenSymbol
      ? { mintAliases: { [manifest.tokenSymbol]: manifest.tokenMint } }
      : {}),
  });

  const snippetPath = join(ctx.outDir, "claude_desktop_config.snippet.json");
  await writeFile(snippetPath, configJson, "utf8");

  if (options.json) {
    process.stdout.write(
      `${JSON.stringify({ mcpConfigPath: snippetPath, mcpConfig: JSON.parse(configJson) }, null, 2)}\n`,
    );
    return 0;
  }

  ui.heading("MCP config");
  ui.code(configJson.trimEnd());
  ui.field("Saved to", snippetPath);
  return 0;
}
