/**
 * Key generation for an account that signed in with Google and owns no wallet
 * yet (ADR-018).
 *
 * Everything here runs in the browser and nothing is persisted. The caller
 * shows the phrase once and drops it: the dashboard never becomes the custody
 * surface, which is the line ADR-017 draws and this module stays behind.
 */
import { generateMnemonic, mnemonicToSeedSync, validateMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";
import {
  type Address,
  createKeyPairFromPrivateKeyBytes,
  getAddressFromPublicKey,
} from "@solana/kit";
import { HDKey } from "micro-key-producer/slip10.js";

/**
 * The path every Solana wallet treats as account 0. Phantom, Solflare, Backpack
 * and `solana-keygen` all land on the same address here, and that is the whole
 * point of this module: a phrase that imports into a wallet the user already
 * trusts, rather than one that only works in our UI.
 */
export const SOLANA_ACCOUNT_0_PATH = "m/44'/501'/0'/0'";

/** Collapses the whitespace a paste carries, without touching the words. */
function normalize(phrase: string): string {
  return phrase.trim().replace(/\s+/g, " ").toLowerCase();
}

/**
 * Twelve words. 128 bits is what every wallet's import screen defaults to, and
 * a 24-word phrase the user cannot paste back anywhere is worse than a shorter
 * one they can.
 */
export function createMnemonic(): string {
  return generateMnemonic(wordlist, 128);
}

export function isValidMnemonic(phrase: string): boolean {
  return validateMnemonic(normalize(phrase), wordlist);
}

/**
 * The address a wallet will show after importing this phrase. Derived rather
 * than stored, so the UI can display it beside the words without ever holding
 * the key material anywhere else.
 */
export async function addressFromMnemonic(
  phrase: string,
  path: string = SOLANA_ACCOUNT_0_PATH,
): Promise<Address> {
  const seed = mnemonicToSeedSync(normalize(phrase), "");
  const node = HDKey.fromMasterSeed(seed).derive(path);
  if (!node.privateKey) throw new Error("derivation produced no private key");
  // Left non-extractable: nothing downstream needs the bytes back, and the
  // phrase in the user's hands is the only copy that is supposed to exist.
  const keyPair = await createKeyPairFromPrivateKeyBytes(node.privateKey);
  return getAddressFromPublicKey(keyPair.publicKey);
}
