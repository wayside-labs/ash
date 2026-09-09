#!/usr/bin/env node
import { startStdioServer } from "./server.js";

startStdioServer().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[agent-rails-mcp] fatal: ${message}`);
  process.exit(1);
});
