import { hkdf } from "@noble/hashes/hkdf";
import { sha256 } from "@noble/hashes/sha256";
import { RunError } from "./errors.js";
import type { WalletPort } from "./ports.js";

const encoder = new TextEncoder();

export const KEY_DERIVATION_DOMAIN = "ash/cloak-private-payout/v1";

/**
 * What the wallet is asked to sign to derive the payout keys. The text says what the signature is
 * worth because it is: whoever holds it can rebuild the notes, which is the price of keeping no
 * secret anywhere (ADR-027). The funder's address is inside it so the signature is not reusable
 * for another wallet's message.
 */
export function keyDerivationMessage(funder: string): Uint8Array {
  return encoder.encode(
    [
      "ASH x Cloak: private payout keys (v1)",
      "",
      "Signing derives the keys that control your private payout notes, here and on any device with this wallet.",
      "It does NOT authorize a transaction or move funds.",
      "Only sign this on a site you trust: anyone who gets this signature can spend those notes.",
      "",
      `Wallet: ${funder}`,
    ].join("\n"),
  );
}

/** HKDF over the wallet signature, domain-separated from every other use of that signature. */
export function deriveMasterSeed(signature: Uint8Array): Uint8Array {
  if (signature.length !== 64) {
    throw new RunError("wallet_cannot_sign_messages", "the wallet returned an unusable signature");
  }
  return hkdf(
    sha256,
    signature,
    encoder.encode(KEY_DERIVATION_DOMAIN),
    encoder.encode("master-seed"),
    32,
  );
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return diff === 0;
}

/**
 * The seed the session's keys come from. The first time on a device (`verifyDeterminism`) the
 * wallet signs twice: Ed25519 is deterministic, but a wallet that is not would derive different
 * keys next time and strand whatever was shielded under the first set. The caller zeroes the seed.
 */
export async function obtainMasterSeed(
  wallet: WalletPort,
  options: { verifyDeterminism: boolean },
): Promise<Uint8Array> {
  const message = keyDerivationMessage(wallet.address);
  const first = deriveMasterSeed(await wallet.signMessage(message));
  if (!options.verifyDeterminism) return first;
  const second = deriveMasterSeed(await wallet.signMessage(message));
  const same = sameBytes(first, second);
  second.fill(0);
  if (!same) {
    first.fill(0);
    throw new RunError("keys_not_deterministic");
  }
  return first;
}
