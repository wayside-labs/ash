/**
 * MCP config the operator pastes into Claude Desktop or Cursor after creating a
 * session. Mirrors `packages/cli/src/mcp-config.ts` without Node path helpers.
 */
export type McpSnippetInput = {
  rpcUrl: string;
  session: string;
  /** Where the operator saved the downloaded session keypair. */
  signerKeypairPath: string;
  sinkPath?: string;
  alertWebhookUrl?: string;
  serverEntry?: string;
  serverName?: string;
  mintAliases?: Record<string, string>;
};

export function buildMcpSnippet(input: McpSnippetInput): string {
  const name = input.serverName ?? "ash";
  const aliases = Object.entries(input.mintAliases ?? {})
    .map(([symbol, mint]) => `${symbol}:${mint}`)
    .join(",");
  const serverEntry = input.serverEntry ?? "packages/mcp/dist/cli.js";
  const payload = {
    mcpServers: {
      [name]: {
        command: "node",
        args: [serverEntry],
        env: {
          ASH_RPC: input.rpcUrl,
          ASH_SESSION: input.session,
          ASH_SIGNER: input.signerKeypairPath,
          ...(input.sinkPath ? { ASH_SINK: input.sinkPath } : {}),
          ...(input.alertWebhookUrl ? { ASH_ALERT_WEBHOOK_URL: input.alertWebhookUrl } : {}),
          ...(aliases ? { ASH_MINT_ALIASES: aliases } : {}),
        },
      },
    },
  };
  return `${JSON.stringify(payload, null, 2)}\n`;
}
