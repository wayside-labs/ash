import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, resolve } from "node:path";
import {
  createKeyPairSignerFromBytes,
  generateKeyPairSigner,
  type KeyPairSigner,
  writeKeyPairSigner,
} from "@solana/kit";
import { CliError } from "./errors.js";

/** The path `solana config` uses by default, which is where a developer's key already is. */
export const DEFAULT_WALLET_PATH = "~/.config/solana/id.json";

export function expandPath(value: string): string {
  if (value === "~") return homedir();
  if (value.startsWith("~/")) return resolve(homedir(), value.slice(2));
  return isAbsolute(value) ? value : resolve(process.cwd(), value);
}

/**
 * Load the developer's existing keypair, in the 64-byte JSON array `solana-keygen` writes.
 *
 * Reusing the wallet the developer already funded is most of the time saved: it is the
 * owner, the operator, and the source of the vault deposit, so a working `solana` install
 * means `init` needs no key management from the user at all.
 */
export async function loadWallet(path: string): Promise<KeyPairSigner> {
  const expanded = expandPath(path);
  let raw: string;
  try {
    raw = await readFile(expanded, "utf8");
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      throw new CliError(`No keypair at ${expanded}`, {
        hint:
          "Create one with `solana-keygen new`, or point at an existing key with " +
          "--wallet <path>.",
      });
    }
    throw new CliError(`Could not read the keypair at ${expanded}`, { cause: error });
  }

  let bytes: Uint8Array;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) throw new Error("not a JSON array");
    bytes = Uint8Array.from(parsed as number[]);
  } catch (error) {
    throw new CliError(`${expanded} is not a solana-keygen keypair file`, {
      hint: "Expected a JSON array of 64 bytes, as written by `solana-keygen new -o <path>`.",
      cause: error,
    });
  }

  if (bytes.length !== 64) {
    throw new CliError(`${expanded} holds ${bytes.length} bytes, expected 64`, {
      hint: "A 32-byte file is a seed, not a keypair. Re-export it with `solana-keygen`.",
    });
  }

  try {
    return await createKeyPairSignerFromBytes(bytes);
  } catch (error) {
    throw new CliError(`${expanded} is not a valid Ed25519 keypair`, { cause: error });
  }
}

/**
 * Generate a keypair and persist it where the MCP server will read it.
 *
 * `extractable: true` is required for the key to be writable at all, and `writeKeyPairSigner`
 * is what makes this safe to hand a developer: it creates parent directories, writes mode
 * 0600, and refuses to clobber an existing file unless explicitly told to. That last part is
 * the important one — silently overwriting a session key would strand whatever it holds.
 */
export async function createAndSaveKeypair(path: string): Promise<KeyPairSigner> {
  const signer = await generateKeyPairSigner(true);
  try {
    await writeKeyPairSigner(signer, path);
  } catch (error) {
    throw new CliError(`Could not write a keypair to ${path}`, {
      hint: "Delete the existing file if you intend to replace it, or pass a different --out.",
      cause: error,
    });
  }
  return signer;
}

/** Load a keypair the CLI previously generated, so a re-run reuses it instead of rotating. */
export async function loadIfPresent(path: string): Promise<KeyPairSigner | undefined> {
  try {
    const raw = await readFile(path, "utf8");
    const bytes = Uint8Array.from(JSON.parse(raw) as number[]);
    return await createKeyPairSignerFromBytes(bytes);
  } catch {
    return undefined;
  }
}
