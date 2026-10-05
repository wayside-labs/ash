#!/usr/bin/env node
import { applyLegacyEnv } from "@ash/contract/legacy-env";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createKnowledgeServer, loadKnowledgeConfig } from "./server.js";

async function main() {
  applyLegacyEnv();
  const config = loadKnowledgeConfig();
  await createKnowledgeServer(config).connect(new StdioServerTransport());
  console.error(
    `[ash-knowledge] ${config.url}${config.agentName ? ` as ${config.agentName}` : ""}`,
  );
}

main().catch((error: unknown) => {
  console.error(`[ash-knowledge] fatal: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
