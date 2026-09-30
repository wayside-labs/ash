#!/usr/bin/env node

const USAGE = `agent-rails-integrations — Solana dApp MCP connectors

  mcp jupiter
      stdio MCP: ecosystem catalog, jupiter_quote, jupiter_swap_transaction.
      Optional: JUPITER_API_BASE (default https://quote-api.jup.ag).

  mcp sodax
      stdio MCP: SODAX cross-network swaps, bridge, money market, leverage-yield vaults.
      Builds unsigned transactions for a desk wallet; never signs. Mainnet only.
      SODAX_ALLOWED_DESTINATIONS  <chainKey>:<address>, comma-separated. Recipients other
                                  than the signing desk on its own chain must be listed.
      Optional: SODAX_API_KEY, SODAX_PARTNER_FEE_ADDRESS + SODAX_PARTNER_FEE_BPS,
                SODAX_SOLANA_RPC_URL, SODAX_HUB_RPC_URL.
`;

function fail(message: string): never {
  console.error(`agent-rails-integrations: ${message}\n\n${USAGE}`);
  process.exit(2);
}

async function main(): Promise<void> {
  const [cmd, connector, ...rest] = process.argv.slice(2);
  if (rest.length > 0) fail("unexpected arguments");
  if (cmd !== "mcp") fail("expected: mcp <connector>");

  // Loaded on demand: the SODAX SDK pulls every chain's client library, which Jupiter never needs.
  if (connector === "jupiter") {
    const { startJupiterMcp } = await import("./mcp-jupiter.js");
    await startJupiterMcp();
    return;
  }
  if (connector === "sodax") {
    const { startSodaxMcp } = await import("./mcp-sodax.js");
    await startSodaxMcp();
    return;
  }
  fail(`unknown connector '${connector ?? ""}' (available: jupiter, sodax)`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
