import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ChainKeys, Sodax, type SodaxLogger, type SodaxOptions } from "@sodax/sdk";
import { readSodaxConfig, type SodaxConnectorConfig } from "./sodax/config.js";
import { type LiveTokenOverrides, liveTokenOverrides } from "./sodax/live-tokens.js";
import { createSodaxTools, toolErrorPayload, toToolPayload } from "./sodax/tools.js";

// stdout is the MCP stdio channel; any SDK diagnostic written there corrupts the stream.
const stderrLogger: SodaxLogger = {
  debug: () => {},
  info: () => {},
  warn: (message, data) => console.error(`[sodax] ${message}`, data ?? ""),
  error: (message, error, data) => console.error(`[sodax] ${message}`, error ?? "", data ?? ""),
};

// 2.1.0 still defaults to the legacy xcall relay host; the docs name this one as mainnet.
const RELAYER_API_ENDPOINT = "https://api.sodax.com/v1/relay";

export function createSodax(config: SodaxConnectorConfig, live?: LiveTokenOverrides): Sodax {
  const chains: Record<string, Record<string, unknown>> = { ...(live?.chains ?? {}) };
  if (config.solanaRpcUrl) {
    const solana = ChainKeys.SOLANA_MAINNET;
    chains[solana] = { ...chains[solana], rpcUrl: config.solanaRpcUrl };
  }
  // @sodax/sdk 2.1.0 has no top-level `apiKey` option (the docs describe a later release); an
  // explicit x-api-key header on the backend API config is the path it honours.
  const options = {
    logger: stderrLogger,
    relay: { relayerApiEndpoint: RELAYER_API_ENDPOINT },
    ...(config.apiKey ? { api: { headers: { "x-api-key": config.apiKey } } } : {}),
    ...(config.partnerFee ? { fee: config.partnerFee } : {}),
    ...(config.hubRpcUrl ? { hub: { rpcUrl: config.hubRpcUrl } } : {}),
    ...(Object.keys(chains).length > 0 ? { chains } : {}),
    ...(live ? { swaps: { supportedTokens: live.swapTokens } } : {}),
  } as SodaxOptions;
  return new Sodax(options);
}

/** Builds the SDK over the live token list, falling back to the packaged snapshot if it is down. */
export async function createLiveSodax(config: SodaxConnectorConfig): Promise<Sodax> {
  const packaged = createSodax(config);
  const tokens = await packaged.api.swaps.getTokens();
  if (!tokens.ok) {
    console.error("[sodax] live token list unavailable; using the SDK's packaged snapshot");
    return packaged;
  }
  const live = liveTokenOverrides(
    packaged.instanceConfig.chains as unknown as Parameters<typeof liveTokenOverrides>[0],
    tokens.value as unknown as Parameters<typeof liveTokenOverrides>[1],
  );
  return createSodax(config, live);
}

export async function startSodaxMcp(env: NodeJS.ProcessEnv = process.env) {
  const config = readSodaxConfig(env);
  const sodax = await createLiveSodax(config);
  const server = new McpServer(
    { name: "ash-integrations-sodax", version: "0.1.0" },
    {
      instructions:
        "SODAX cross-network execution (mainnet only): swaps across 22 networks, bridging, the SODAX money market and " +
        "leverage-yield vaults. This server cannot move funds or sign: it quotes, builds UNSIGNED transactions for a " +
        "desk wallet, and relays or tracks transactions the desk already broadcast. Pair with ash-mcp — the " +
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
