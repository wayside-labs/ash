import {
  AccountRole,
  address,
  appendTransactionMessageInstruction,
  compileTransaction,
  createTransactionMessage,
  getAddressEncoder,
  getBase64EncodedWireTransaction,
  getSignatureFromTransaction,
  getTransactionDecoder,
  getTransactionEncoder,
  pipe,
  type Rpc,
  type SolanaRpcApi,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
} from "@solana/kit";
import { MEMO_PROGRAM_ADDRESS } from "./commitment.js";
import { RunError } from "./errors.js";
import type { TxReceipt } from "./ports.js";

/**
 * A standalone Solana transaction whose only instruction is the SPL Memo program's, carrying a
 * text. It is how the privacy text's hash is committed on-chain (see `commitment.ts`). It stays
 * apart from every Cloak transaction on purpose: the SDK builds those itself, and the relay builds
 * the withdrawals, so a memo cannot ride in them; a transaction of our own touches no part of a
 * payout, whatever happens to it.
 *
 * The memo's signer is the fee payer, listed on the instruction as a read-only signer, which makes
 * the memo the wallet's own statement in the explorer ("signed by").
 */

/** Hands unsigned transaction bytes to whatever signs for the funder and returns them signed. */
export type SignTransactionBytes = (wire: Uint8Array) => Promise<Uint8Array>;

/** The Memo program accepts what fits a transaction; a hash line is a fifth of that. */
const MAX_MEMO_BYTES = 500;

const utf8 = (text: string): Uint8Array => new TextEncoder().encode(text);

function matchesAt(haystack: ArrayLike<number>, needle: ArrayLike<number>, at: number): boolean {
  for (let i = 0; i < needle.length; i++) {
    if (haystack[at + i] !== needle[i]) return false;
  }
  return true;
}

function contains(haystack: ArrayLike<number>, needle: ArrayLike<number>): boolean {
  for (let at = 0; at + needle.length <= haystack.length; at++) {
    if (matchesAt(haystack, needle, at)) return true;
  }
  return false;
}

export type MemoLifetime = { blockhash: string; lastValidBlockHeight: bigint };

/** The unsigned transaction bytes for a memo, ready for a wallet or a keypair to sign. */
export function buildMemoTransaction(
  memo: string,
  feePayer: string,
  lifetime: MemoLifetime,
): Uint8Array {
  const data = utf8(memo);
  if (data.length === 0 || data.length > MAX_MEMO_BYTES) {
    throw new RunError("unknown", `A memo is 1 to ${MAX_MEMO_BYTES} bytes.`);
  }
  const payer = address(feePayer);
  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayer(payer, m),
    (m) =>
      setTransactionMessageLifetimeUsingBlockhash(
        {
          blockhash: lifetime.blockhash as Parameters<
            typeof setTransactionMessageLifetimeUsingBlockhash
          >[0]["blockhash"],
          lastValidBlockHeight: lifetime.lastValidBlockHeight,
        },
        m,
      ),
    (m) =>
      appendTransactionMessageInstruction(
        {
          programAddress: address(MEMO_PROGRAM_ADDRESS),
          accounts: [{ address: payer, role: AccountRole.READONLY_SIGNER }],
          data,
        },
        m,
      ),
  );
  return new Uint8Array(getTransactionEncoder().encode(compileTransaction(message)));
}

export type SendMemoOptions = {
  rpc: Rpc<SolanaRpcApi>;
  memo: string;
  /** The wallet that pays for the transaction and signs it. */
  feePayer: string;
  sign: SignTransactionBytes;
  /** How often to ask whether it landed, and for how many tries. A test passes 0 and a few. */
  pollMs?: number;
  attempts?: number;
  sleep?: (ms: number) => Promise<void>;
};

/**
 * Builds the memo transaction, has it signed, checks that what came back still holds the memo,
 * sends it and waits until it is confirmed.
 *
 * Wallets may change what they sign (adding guard instructions is common), so the signed bytes are
 * not required to equal the unsigned ones; they are required to still carry the Memo program and
 * the exact text, because a commitment that lost its text is not worth the fee.
 */
export async function sendMemoTransaction(options: SendMemoOptions): Promise<TxReceipt> {
  const { rpc, memo, feePayer } = options;
  const { value: lifetime } = await rpc.getLatestBlockhash({ commitment: "confirmed" }).send();
  const unsigned = buildMemoTransaction(memo, feePayer, lifetime);

  const signedBytes = await options.sign(unsigned);
  const signed = getTransactionDecoder().decode(signedBytes);
  const memoProgram = new Uint8Array(getAddressEncoder().encode(address(MEMO_PROGRAM_ADDRESS)));
  if (!contains(signed.messageBytes, utf8(memo)) || !contains(signed.messageBytes, memoProgram)) {
    throw new RunError(
      "unknown",
      "The signed transaction no longer carries the memo; nothing was sent.",
    );
  }
  // Throws unless the fee payer's signature is on it.
  const expected = getSignatureFromTransaction(signed);

  const sent = await rpc
    .sendTransaction(getBase64EncodedWireTransaction(signed), {
      encoding: "base64",
      preflightCommitment: "confirmed",
    })
    .send();
  const signature = String(sent ?? expected);

  const sleep =
    options.sleep ?? ((ms: number) => new Promise<void>((done) => setTimeout(done, ms)));
  const attempts = options.attempts ?? 60;
  for (let attempt = 0; attempt < attempts; attempt++) {
    const { value } = await rpc.getSignatureStatuses([sent]).send();
    const status = value[0];
    if (status?.err) {
      throw new RunError("unknown", "The memo transaction failed on-chain.", { cause: status.err });
    }
    if (status?.confirmationStatus === "confirmed" || status?.confirmationStatus === "finalized") {
      return { signature };
    }
    await sleep(options.pollMs ?? 1000);
  }
  throw new RunError(
    "outcome_unknown",
    "The memo transaction was sent but not confirmed in time; check the explorer.",
  );
}
