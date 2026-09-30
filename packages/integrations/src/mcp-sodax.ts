import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ChainKeys, Sodax, type SodaxLogger, type SodaxOptions } from "@sodax/sdk";
import { readSodaxConfig, type SodaxConnectorConfig } from "./sodax/config.js";
import { createSodaxTools, toolErrorPayload, toToolPayload } from "./sodax/tools.js";

// stdout is the MCP stdio channel; any SDK diagnostic written there corrupts the stream.
const stderrLogger: SodaxLogger = {
  debug: () => {},
  info: () => {},
  warn: (message, data) => console.error(`[sodax] ${message}`, data ?? ""),
  error: (message, error, data) => console.error(`[sodax] ${message}`, error ?? "", data ?? ""),
};

export function createSodax(config: SodaxConnectorConfig): Sodax {
  // @sodax/sdk 2.1.0 has no top-level `apiKey` option (the docs describe a later release); an
  // explicit x-api-key header on the backend API config is the path it honours.
  const options = {
    logger: stderrLogger,
    ...(config.apiKey ? { api: { headers: { "x-api-key": config.apiKey } } } : {}),
    ...(config.partnerFee ? { fee: config.partnerFee } : {}),
    ...(config.hubRpcUrl ? { hub: { rpcUrl: config.hubRpcUrl } } : {}),
    ...(config.solanaRpcUrl
      ? { chains: { [ChainKeys.SOLANA_MAINNET]: { rpcUrl: config.solanaRpcUrl } } }
      : {}),
  } as SodaxOptions;
  return new Sodax(options);
}

export async function startSodaxMcp(env: NodeJS.ProcessEnv = process.env) {
  const config = readSodaxConfig(env);
  const sodax = createSodax(config);
  const server = new McpServer(
    { name: "agent-rails-integrations-sodax", version: "0.1.0" },
    {
      instructions:
        "SODAX cross-network execution (mainnet only): swaps across 22 networks, bridging, the SODAX money market and " +
        "leverage-yield vaults. This server cannot move funds or sign: it quotes, builds UNSIGNED transactions for a " +
        "desk wallet, and relays or tracks transactions the desk already broadcast. Pair with agent-rails-mcp — the " +
        "treasury pays the desk through execute_payment, the desk signs. Solana-only swaps: prefer the Jupiter connector. " +
        `Recipients are limited to the operator's allowlist (${config.allowlist.length} entr${config.allowlist.length === 1 ? "y" : "ies"} configured).`,
    },
  );

  for (const tool of createSodaxTools(sodax, config)) {
    server.registerTool(
      tool.name,
      { description: tool.description, inputSchema: tool.inputSchema },
      async (input: Record<string, unknown>) => {
        try {
          const payload = toToolPayload(await tool.handler(input));
          return {
            content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
            structuredContent: payload,
          };
        } catch (error) {
          const payload = toolErrorPayload(error);
          return {
            content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
            structuredContent: payload,
            isError: true,
          };
        }
      },
    );
  }

  await server.connect(new StdioServerTransport());
}
