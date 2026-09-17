import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * What a previous `init` left behind, so a re-run resumes instead of starting over.
 *
 * This file holds addresses and paths only — never key material. The keys live in their own
 * 0600 files that `.gitignore` already excludes by the `**\/*keypair*.json` pattern, and
 * keeping them separate is what lets this manifest be safely committed or pasted into an
 * issue.
 */
export type Manifest = {
  version: 1;
  rpcUrl: string;
  programId: string;
  treasury: string;
  solVault: string;
  policy: string;
  policyName: string;
  session: string;
  sessionKey: string;
  sessionKeypairPath: string;
  sessionExpiresAt: string;
  feePayer: string;
  feePayerKeypairPath: string;
  destination: string;
  destinationLabel: string;
  /** Present only when the treasury was bootstrapped with an SPL mint alongside SOL. */
  tokenMint?: string;
  tokenSymbol?: string;
  tokenDecimals?: number;
  tokenVaultAta?: string;
  owner: string;
  createdAt: string;
};

/**
 * A filename per cluster.
 *
 * Bootstrapping against a local surfnet must not overwrite the record of a devnet treasury:
 * they are different chains, the PDAs on one mean nothing on the other, and a single
 * manifest would make `init --rpc localhost` silently destroy the thing the developer spent
 * a rate-limited faucet on.
 */
export function clusterSlug(rpcUrl: string): string {
  let host: string;
  try {
    host = new URL(rpcUrl).hostname;
  } catch {
    return "custom";
  }
  if (host === "127.0.0.1" || host === "localhost" || host === "0.0.0.0") return "localnet";
  if (host.includes("devnet")) return "devnet";
  if (host.includes("testnet")) return "testnet";
  if (host.includes("mainnet")) return "mainnet";
  return "custom";
}

export function manifestPath(outDir: string, rpcUrl: string): string {
  return join(outDir, `${clusterSlug(rpcUrl)}.json`);
}

export async function readManifest(path: string): Promise<Manifest | undefined> {
  try {
    const parsed = JSON.parse(await readFile(path, "utf8")) as Manifest;
    return parsed.version === 1 ? parsed : undefined;
  } catch {
    return undefined;
  }
}

export async function writeManifest(path: string, manifest: Manifest): Promise<void> {
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}
