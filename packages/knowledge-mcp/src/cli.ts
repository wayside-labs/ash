#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createKnowledgeServer, loadKnowledgeConfig } from "./server.js";

async function main() {
  const config = loadKnowledgeConfig();
  await createKnowledgeServer(config).connect(new StdioServerTransport());
  console.error(
    `[agent-rails-knowledge] ${config.url}${config.agentName ? ` as ${config.agentName}` : ""}`,
  );
}

main().catch((error: unknown) => {
  console.error(
    `[agent-rails-knowledge] fatal: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exit(1);
});
