import { describe, expect, it } from "vitest";
import { buildMcpConfig, renderMcpConfig } from "./mcp-config.js";

const input = {
  serverEntry: "/repo/packages/mcp/dist/cli.js",
  rpcUrl: "https://api.devnet.solana.com",
  session: "4jy89aF85rtFKBE8QqJvxwKzrLHhFMNs3xyDgc28KNfF",
  signerKeypairPath: "/keys/session-keypair.json",
  feePayerKeypairPath: "/keys/fee-payer-keypair.json",
  sinkPath: "/keys/payments.jsonl",
};

describe("buildMcpConfig", () => {
  /**
   * These five keys are the server's actual contract (`packages/mcp/src/config.ts`). The
   * test exists so that renaming one there fails here rather than in a developer's Claude
   * Desktop, where the symptom is a server that exits at startup with no visible log.
   */
  it("emits exactly the environment variables the MCP server reads", () => {
    const config = buildMcpConfig(input);
    expect(Object.keys(config.mcpServers["ash"]?.env ?? {}).sort()).toEqual([
      "ASH_FEE_PAYER",
      "ASH_RPC",
      "ASH_SESSION",
      "ASH_SIGNER",
      "ASH_SINK",
    ]);
  });

  it("binds the server to the session PDA, never to the session key", () => {
    const env = buildMcpConfig(input).mcpServers["ash"]?.env;
    expect(env?.ASH_SESSION).toBe(input.session);
    expect(env?.ASH_SIGNER).toBe(input.signerKeypairPath);
  });

  it("keeps the fee payer separate from the session key", () => {
    const env = buildMcpConfig(input).mcpServers["ash"]?.env;
    expect(env?.ASH_FEE_PAYER).not.toBe(env?.ASH_SIGNER);
  });

  it("names the server entry as an argument to node, not as the command", () => {
    const entry = buildMcpConfig(input).mcpServers["ash"];
    expect(entry?.command).toBe("node");
    expect(entry?.args).toEqual([input.serverEntry]);
  });

  it("allows a custom server name for a second treasury", () => {
    const config = buildMcpConfig({ ...input, serverName: "ash-ops" });
    expect(Object.keys(config.mcpServers)).toEqual(["ash-ops"]);
  });

  it("renders valid, pasteable JSON", () => {
    const rendered = renderMcpConfig(input);
    expect(() => JSON.parse(rendered)).not.toThrow();
    expect(rendered.endsWith("\n")).toBe(true);
  });
});

describe("buildMcpConfig with an SPL mint", () => {
  const withToken = {
    ...input,
    mintAliases: { USDC: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU" },
  };

  /**
   * Without the alias the agent can only name the mint by its base58 address, and under a
   * policy in allowlist mode that is exactly the form the resolver refuses. Emitting it is
   * what makes `mint_ref: "USDC"` a usable tool argument.
   */
  it("declares the mint alias in the SYMBOL:address form the server parses", () => {
    const env = buildMcpConfig(withToken).mcpServers["ash"]?.env;
    expect(env?.ASH_MINT_ALIASES).toBe("USDC:4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU");
  });

  it("omits the variable entirely for a SOL-only treasury", () => {
    const env = buildMcpConfig(input).mcpServers["ash"]?.env;
    expect(env).not.toHaveProperty("ASH_MINT_ALIASES");
  });

  it("joins several aliases with commas", () => {
    const env = buildMcpConfig({
      ...input,
      mintAliases: { USDC: "mintA", MOCK: "mintB" },
    }).mcpServers["ash"]?.env;
    expect(env?.ASH_MINT_ALIASES).toBe("USDC:mintA,MOCK:mintB");
  });
});
