import { generateKeyPairSigner, type KeyPairSigner } from "@solana/kit";

/** Fresh session signing key — extractable so the operator can download it once. */
export async function generateSessionKeyPair(): Promise<KeyPairSigner> {
  return generateKeyPairSigner(true);
}

/**
 * The 64-byte JSON array every Solana tool expects: 32-byte seed plus 32-byte
 * public key, matching `solana-keygen` and the CLI's `*-session-keypair.json`.
 */
export async function exportKeypairBytes(signer: KeyPairSigner): Promise<number[]> {
  const pkcs8 = new Uint8Array(await crypto.subtle.exportKey("pkcs8", signer.keyPair.privateKey));
  const publicKey = new Uint8Array(await crypto.subtle.exportKey("raw", signer.keyPair.publicKey));
  const bytes = new Uint8Array(64);
  bytes.set(pkcs8.slice(pkcs8.length - 32), 0);
  bytes.set(publicKey, 32);
  return [...bytes];
}

export function downloadKeypairFile(filename: string, bytes: number[]): void {
  const blob = new Blob([JSON.stringify(bytes)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function suggestedKeypairFilename(label: string): string {
  const safe = label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return `${safe || "agent"}-session-keypair.json`;
}
