import { homedir, platform } from "node:os";
import { join } from "node:path";

/**
 * The `mcpServers` block for Claude Desktop, Cursor, and anything else speaking stdio MCP.
 *
 * Every key here is one the MCP server actually reads in `packages/mcp/src/config.ts`, and
 * the shape matches the one documented in that package's README. That is the point of
 * generating it rather than printing a template: the server binds to exactly one session at
 * startup and refuses to take one as a tool argument, so the session PDA and the signer
 * path have to agree with what was just created on-chain, and a hand-copied config is where
 * that agreement breaks.
 */
export type McpConfigInput = {
  /** Absolute path to the built MCP server entry point. */
  serverEntry: string;
  rpcUrl: string;
  session: string;
  signerKeypairPath: string;
  feePayerKeypairPath: string;
  /** JSONL audit sink. Written next to the keys so the operator's record survives a restart. */
  sinkPath: string;
  serverName?: string;
  /**
   * `SYMBOL:address` pairs the agent may name a mint by.
   *
   * Without this the agent can only reference a mint by its base58 address, and under a
   * policy in allowlist mode a raw address is exactly what the destination resolver
   * refuses. SOL and WSOL are built into the server; anything else has to be declared here
   * or it is unaddressable.
   */
  mintAliases?: Record<string, string>;
};

export type McpServerEntry = {
  command: string;
  args: string[];
  env: Record<string, string>;
};

export function buildMcpConfig(input: McpConfigInput): {
  mcpServers: Record<string, McpServerEntry>;
} {
  const name = input.serverName ?? "agent-rails";
  const aliases = Object.entries(input.mintAliases ?? {})
    .map(([symbol, mint]) => `${symbol}:${mint}`)
    .join(",");
  return {
    mcpServers: {
      [name]: {
        command: "node",
        args: [input.serverEntry],
        env: {
          AGENT_RAILS_RPC: input.rpcUrl,
          AGENT_RAILS_SESSION: input.session,
          AGENT_RAILS_SIGNER: input.signerKeypairPath,
          AGENT_RAILS_FEE_PAYER: input.feePayerKeypairPath,
          AGENT_RAILS_SINK: input.sinkPath,
          ...(aliases ? { AGENT_RAILS_MINT_ALIASES: aliases } : {}),
        },
      },
    },
  };
}

export function renderMcpConfig(input: McpConfigInput): string {
  return `${JSON.stringify(buildMcpConfig(input), null, 2)}\n`;
}

/**
 * Where Claude Desktop keeps `claude_desktop_config.json` on this machine.
 *
 * Printing the real path beats telling a developer to "find your config": on Linux there is
 * no official desktop build at all, which is worth saying rather than inventing a path.
 */
export function claudeDesktopConfigPath(): string {
  switch (platform()) {
    case "darwin":
      return join(
        homedir(),
        "Library",
        "Application Support",
        "Claude",
        "claude_desktop_config.json",
      );
    case "win32":
      return join(
        process.env.APPDATA ?? join(homedir(), "AppData", "Roaming"),
        "Claude",
        "claude_desktop_config.json",
      );
    default:
      return join(homedir(), ".config", "Claude", "claude_desktop_config.json");
  }
}

export function claudeDesktopSupported(): boolean {
  return platform() === "darwin" || platform() === "win32";
}
