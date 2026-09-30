#!/usr/bin/env node
import { startJupiterMcp } from "./mcp-jupiter.js";

const USAGE = `agent-rails-integrations — Solana dApp MCP connectors

  mcp jupiter
      stdio MCP: ecosystem catalog, jupiter_quote, jupiter_swap_transaction.
      Optional: JUPITER_API_BASE (default https://quote-api.jup.ag).
`;

function fail(message: string): never {
  console.error(`agent-rails-integrations: ${message}\n\n${USAGE}`);
  process.exit(2);
}

async function main(): Promise<void> {
  const [cmd, connector, ...rest] = process.argv.slice(2);
  if (rest.length > 0) fail("unexpected arguments");
  if (cmd !== "mcp") fail("expected: mcp <connector>");
  if (connector !== "jupiter") fail("only connector 'jupiter' is available in v0.1");

  await startJupiterMcp();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
