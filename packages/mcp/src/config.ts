import { createSolanaRpc, type Rpc, type SolanaRpcApi } from "@solana/kit";
import { readFile } from "node:fs/promises";

export type McpServerConfig = {
  rpcUrl: string;
  signerKeypairPath: string;
  feePayerKeypairPath?: string;
};

export type McpRuntime = {
  rpc: Rpc<SolanaRpcApi>;
  config: McpServerConfig;
};

export function loadConfigFromEnv(env: NodeJS.ProcessEnv = process.env): McpServerConfig {
  const rpcUrl = env.AGENT_RAILS_RPC;
  const signerKeypairPath = env.AGENT_RAILS_SIGNER ?? env.AGENT_RAILS_SESSION_SIGNER;
  const feePayerKeypairPath = env.AGENT_RAILS_FEE_PAYER;

  if (!rpcUrl) {
    throw new Error("AGENT_RAILS_RPC is required");
  }
  if (!signerKeypairPath) {
    throw new Error("AGENT_RAILS_SIGNER (session keypair path) is required");
  }

  const config: McpServerConfig = {
    rpcUrl,
    signerKeypairPath,
  };
  if (feePayerKeypairPath) {
    config.feePayerKeypairPath = feePayerKeypairPath;
  }
  return config;
}

export function createRuntime(config: McpServerConfig): McpRuntime {
  return {
    config,
    rpc: createSolanaRpc(config.rpcUrl),
  };
}

export async function readKeypairBytes(path: string): Promise<Uint8Array> {
  const raw = await readFile(path, "utf8");
  const parsed = JSON.parse(raw) as number[];
  return Uint8Array.from(parsed);
}
