import { SOLANA_DAPPS } from "@agent-rails/contract";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { JupiterClient } from "./jupiter-client.js";

const mintSchema = z.string().min(32).max(44);

function textResult(payload: unknown, isError = false) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
    structuredContent: payload as Record<string, unknown>,
    ...(isError ? { isError: true } : {}),
  };
}

const DESK_HINT =
  "Agent Rails execute_payment moves funds to an allowlisted desk wallet. Sign swapTransaction " +
  "with the desk key (or a mandate PDA in a future release). Never pay a pool vault token account.";

export async function startJupiterMcp(env: NodeJS.ProcessEnv = process.env) {
  const client = new JupiterClient(env.JUPITER_API_BASE ? { baseUrl: env.JUPITER_API_BASE } : {});
  const server = new McpServer(
    { name: "agent-rails-integrations-jupiter", version: "0.1.0" },
    {
      instructions:
        "Solana swap quotes and unsigned transactions via Jupiter. This server cannot move funds. " +
        "Pair with agent-rails-mcp: treasury pays the desk, then sign and send the swap from the desk. " +
        "For anything that leaves Solana (other networks, bridging, lending, yield vaults) use the SODAX connector.",
    },
  );

  server.registerTool(
    "solana_ecosystem_catalog",
    {
      description:
        "Free. Curated Solana dApps (Jupiter, Raydium, Orca, Kamino, Drift) and how they compose with Agent Rails.",
      inputSchema: z.strictObject({}),
    },
    async () =>
      textResult({
        dapps: SOLANA_DAPPS,
        payment_pattern: DESK_HINT,
      }),
  );

  server.registerTool(
    "jupiter_quote",
    {
      description:
        "Free. Best-route quote from Jupiter v6. Amount is in base units of inputMint (lamports for SOL).",
      inputSchema: z.strictObject({
        input_mint: mintSchema.describe("SPL mint address of token to sell"),
        output_mint: mintSchema.describe("SPL mint address of token to buy"),
        amount: z.string().regex(/^\d+$/).describe("Input amount in base units"),
        slippage_bps: z.number().int().min(1).max(5000).optional().describe("Default 50"),
      }),
    },
    async ({ input_mint, output_mint, amount, slippage_bps }) => {
      try {
        const quote = await client.quote({
          inputMint: input_mint,
          outputMint: output_mint,
          amount,
          ...(slippage_bps !== undefined ? { slippageBps: slippage_bps } : {}),
        });
        return textResult({ quote, next_step: DESK_HINT });
      } catch (error) {
        return textResult({ error: error instanceof Error ? error.message : String(error) }, true);
      }
    },
  );

  server.registerTool(
    "jupiter_swap_transaction",
    {
      description:
        "Free. Build an unsigned versioned transaction for a prior jupiter_quote. user_public_key must sign (typically your swap desk wallet).",
      inputSchema: z.strictObject({
        quote: z.record(z.string(), z.unknown()).describe("Full quote object from jupiter_quote"),
        user_public_key: z.string().min(32).max(44),
        wrap_and_unwrap_sol: z.boolean().optional(),
      }),
    },
    async ({ quote, user_public_key, wrap_and_unwrap_sol }) => {
      try {
        const swap = await client.swapTransaction({
          quote: quote as Parameters<JupiterClient["swapTransaction"]>[0]["quote"],
          userPublicKey: user_public_key,
          ...(wrap_and_unwrap_sol !== undefined ? { wrapAndUnwrapSol: wrap_and_unwrap_sol } : {}),
        });
        return textResult({
          ...swap,
          encoding: "base64",
          next_step:
            "Deserialize, sign with user_public_key, send via your RPC. Fund the desk via agent_rails_execute_payment first if needed.",
        });
      } catch (error) {
        return textResult({ error: error instanceof Error ? error.message : String(error) }, true);
      }
    },
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
}
