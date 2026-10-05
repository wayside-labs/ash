import { readFileSync } from "node:fs";
import type { WalletPort } from "./ports.js";

/**
 * Node-only helpers for the smoke script. Kept out of the browser entry on purpose: this file
 * touches the filesystem and holds a secret key, which no page of the dashboard ever does.
 */

/**
 * Reads a Solana CLI keypair file (a JSON array of 64 bytes). The path is the only thing ever
 * echoed on failure; the contents never are.
 */
export function readKeypairFile(path: string): Uint8Array {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    throw new Error(`could not read a keypair file at ${path}`);
  }
  if (
    !Array.isArray(parsed) ||
    parsed.length !== 64 ||
    !parsed.every((n) => Number.isInteger(n) && n >= 0 && n <= 255)
  ) {
    throw new Error(`${path} is not a Solana CLI keypair (a JSON array of 64 bytes)`);
  }
  return Uint8Array.from(parsed as number[]);
}

/** The keypair as a wallet the runner can ask for the key-derivation signature. */
export async function createNodeWallet(
  secretKey: Uint8Array,
  loadSdk: () => Promise<typeof import("@cloak.dev/sdk")> = () => import("@cloak.dev/sdk"),
): Promise<WalletPort> {
  const sdk = await loadSdk();
  const signer = await sdk.signerFromSecretKey(secretKey);
  return {
    address: signer.address,
    signMessage: (message) => sdk.signMessageBytes(signer, message),
  };
}
