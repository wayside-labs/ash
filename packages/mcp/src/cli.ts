#!/usr/bin/env node
import { applyLegacyEnv } from "@ash/contract/legacy-env";
import { startStdioServer } from "./server.js";

applyLegacyEnv();
startStdioServer().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[ash-mcp] fatal: ${message}`);
  process.exit(1);
});
