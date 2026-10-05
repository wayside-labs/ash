#!/usr/bin/env node
/**
 * Proof of existence for the Privacy Sprint text: commit, then reveal.
 *
 * Before the text was submitted, a SHA-256 of it was written on Solana mainnet, in a transaction
 * of its own that holds one instruction for the SPL Memo program. The submission is the reveal:
 * this script hashes the text again, and with `--tx` it reads the transaction back from a Solana
 * RPC and checks that the memo on-chain is that hash. If one character of the text changed after
 * the commitment, the hash differs and the check fails.
 *
 * It needs Node 22 or later and nothing installed: it imports only Node's own modules, and it
 * runs from the checkout as it is (no build), from the repository root:
 *
 *   node --experimental-strip-types packages/cloak/src/verify-hash.ts
 *   node --experimental-strip-types packages/cloak/src/verify-hash.ts \
 *     --tx <COMMIT_TX_SIGNATURE> [--signer <WALLET>] [--rpc <URL>]
 *
 *   --text-file <path>   hash another file (default: the Portuguese text that is submitted,
 *                        examples/templates/cloak-private-payout/PRIVACY.md)
 *   --stdin              hash the text read from standard input (e.g. pasted from a form)
 *   --print-text         print the canonical text and nothing else, so that
 *                        `... --print-text | sha256sum` reproduces the hash with no code of ours
 *   --tx <signature>     also check the memo of that transaction on-chain
 *   --signer <address>   also require that this wallet paid for and signed that transaction
 *   --rpc <url>          a Solana mainnet RPC (default $SOLANA_RPC_URL, else the public endpoint)
 *   --help
 *
 * Exit code: 0 the hash was computed (and, with --tx, matches the chain), 1 it does not match or
 * the transaction is not the commitment, 2 bad input or the RPC could not be read.
 *
 * Which bytes are hashed (the "canonical text"): the text between the markers in PRIVACY.md
 * (`<!-- texto:inicio -->` and `<!-- texto:fim -->`; PRIVACY.en.md uses `text:start` and
 * `text:end`), Unicode NFC, line ends as LF, trailing spaces removed from every line, runs of
 * blank lines cut to one, the whole text trimmed, then UTF-8 without a byte-order mark.
 *
 * The same constants and format live in `commitment.ts` beside this file, which the browser runner
 * imports; `commitment.test.ts` fails if the two drift apart or if the hash there stops matching
 * PRIVACY.md.
 */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/** The SPL Memo program, v2. Checked on mainnet: it exists, it is executable, loader v2 owns it. */
export const MEMO_PROGRAM_ADDRESS = "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr";

/**
 * What the memo starts with; the SHA-256 in lowercase hex follows. Fixed by the memo already on
 * mainnet (`agent-rails/...`), so it must match what was written, not a later name of the project.
 */
export const MEMO_PREFIX = "agent-rails/privacy-text/v1 sha256=";

/** The Privacy Sprint's limit for the text. */
export const WORD_LIMIT = 300;

const DEFAULT_RPC = "https://api.mainnet-beta.solana.com";

/** From this file (in `src/` or in `dist/`, both two levels under the package) to the text. */
export const DEFAULT_TEXT_PATH = "../../../examples/templates/cloak-private-payout/PRIVACY.md";

const MARKERS: readonly (readonly [string, string])[] = [
  ["<!-- texto:inicio -->", "<!-- texto:fim -->"],
  ["<!-- text:start -->", "<!-- text:end -->"],
];

/** The text between the first pair of markers the file has; the whole file when it has none. */
export function extractText(source: string): string {
  for (const [open, close] of MARKERS) {
    const start = source.indexOf(open);
    if (start === -1) continue;
    const end = source.indexOf(close, start + open.length);
    if (end === -1) throw new Error(`found ${open} but not ${close}`);
    return source.slice(start + open.length, end);
  }
  return source;
}

/** The exact form that is hashed. See the header for each step. */
export function canonicalizeText(text: string): string {
  return text
    .normalize("NFC")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function sha256Hex(canonicalText: string): string {
  return createHash("sha256").update(Buffer.from(canonicalText, "utf8")).digest("hex");
}

/** Counted the way `wc -w` counts: runs of characters between whitespace. */
export function countWords(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

export function expectedMemo(hashHex: string): string {
  if (!/^[0-9a-f]{64}$/.test(hashHex)) throw new Error("not a SHA-256 in lowercase hex");
  return `${MEMO_PREFIX}${hashHex}`;
}

type ParsedInstruction = { programId?: unknown; parsed?: unknown };
type ParsedAccountKey = { pubkey?: unknown; signer?: unknown };
type ParsedTransaction = {
  slot?: unknown;
  blockTime?: unknown;
  meta?: { err?: unknown } | null;
  transaction?: {
    signatures?: unknown;
    message?: { accountKeys?: unknown; instructions?: unknown };
  };
};

/**
 * The memos of the Memo-program instructions at the top level of a `getTransaction` answer asked
 * with `encoding: "jsonParsed"`. The program id is compared, not the label the RPC puts on it: a
 * program that merely calls itself a memo does not count.
 */
export function findMemos(result: ParsedTransaction): string[] {
  const instructions = result.transaction?.message?.instructions;
  if (!Array.isArray(instructions)) return [];
  const memos: string[] = [];
  for (const instruction of instructions as ParsedInstruction[]) {
    if (instruction.programId === MEMO_PROGRAM_ADDRESS && typeof instruction.parsed === "string") {
      memos.push(instruction.parsed);
    }
  }
  return memos;
}

function feePayerOf(result: ParsedTransaction): string | null {
  const keys = result.transaction?.message?.accountKeys;
  if (!Array.isArray(keys) || keys.length === 0) return null;
  const first = keys[0] as ParsedAccountKey | string;
  const pubkey = typeof first === "string" ? first : first.pubkey;
  return typeof pubkey === "string" ? pubkey : null;
}

export type Verdict =
  | {
      ok: true;
      memo: string;
      feePayer: string | null;
      slot: number | null;
      blockTime: string | null;
    }
  | { ok: false; reason: string };

/** Whether this transaction is the commitment for `memo`, and if so who sent it and when. */
export function verifyTransaction(
  result: ParsedTransaction | null,
  memo: string,
  signer: string | null,
): Verdict {
  if (!result) {
    return {
      ok: false,
      reason:
        "the RPC has no such transaction: it is not confirmed, or this endpoint does not keep that far back (try --rpc with another one)",
    };
  }
  if (result.meta?.err !== null && result.meta?.err !== undefined) {
    return { ok: false, reason: "the transaction failed on-chain, so it commits nothing" };
  }
  const found = findMemos(result);
  if (found.length === 0) {
    return { ok: false, reason: `no instruction of the Memo program (${MEMO_PROGRAM_ADDRESS})` };
  }
  if (!found.includes(memo)) {
    return {
      ok: false,
      reason: `the memo on-chain is ${JSON.stringify(found[0])}, not ${JSON.stringify(memo)}`,
    };
  }
  const feePayer = feePayerOf(result);
  if (signer !== null && feePayer !== signer) {
    return {
      ok: false,
      reason: `paid for by ${feePayer ?? "an unknown account"}, not by ${signer}`,
    };
  }
  const time = result.blockTime;
  return {
    ok: true,
    memo,
    feePayer,
    slot: typeof result.slot === "number" ? result.slot : null,
    blockTime: typeof time === "number" ? new Date(time * 1000).toISOString() : null,
  };
}

export type Io = {
  out: (line: string) => void;
  readText: (path: string) => string;
  readStdin: () => string;
  fetchJson: (url: string, body: unknown) => Promise<unknown>;
  env: (name: string) => string | undefined;
  here: string;
};

const USAGE = `verify-hash.ts: proof of existence for the privacy text (commit, then reveal)

  --text-file <path>   hash another file (default: examples/templates/cloak-private-payout/PRIVACY.md)
  --stdin              hash the text read from standard input
  --print-text         print the canonical text only (pipe it to sha256sum)
  --tx <signature>     also check the memo of that transaction on-chain
  --signer <address>   also require that this wallet paid for that transaction
  --rpc <url>          a Solana mainnet RPC (default $SOLANA_RPC_URL, else the public endpoint)
  --help
`;

type Args = {
  textFile: string | null;
  stdin: boolean;
  printText: boolean;
  tx: string | null;
  signer: string | null;
  rpc: string | null;
  help: boolean;
};

function parseArgs(argv: readonly string[]): Args {
  const args: Args = {
    textFile: null,
    stdin: false,
    printText: false,
    tx: null,
    signer: null,
    rpc: null,
    help: false,
  };
  const valueAt = (index: number, flag: string): string => {
    const value = argv[index];
    if (value === undefined || value.startsWith("--")) throw new Error(`${flag} needs a value`);
    return value;
  };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (flag === "--help" || flag === "-h") args.help = true;
    else if (flag === "--stdin") args.stdin = true;
    else if (flag === "--print-text") args.printText = true;
    else if (flag === "--text-file") args.textFile = valueAt(++i, flag);
    else if (flag === "--tx") args.tx = valueAt(++i, flag);
    else if (flag === "--signer") args.signer = valueAt(++i, flag);
    else if (flag === "--rpc") args.rpc = valueAt(++i, flag);
    else throw new Error(`unknown argument ${flag ?? ""}`);
  }
  return args;
}

/** Returns the exit code. Everything it needs from the outside comes in through `io`. */
export async function run(argv: readonly string[], io: Io): Promise<number> {
  let args: Args;
  try {
    args = parseArgs(argv);
  } catch (error) {
    io.out(`${error instanceof Error ? error.message : "bad arguments"}\n\n${USAGE}`);
    return 2;
  }
  if (args.help) {
    io.out(USAGE);
    return 0;
  }

  let label: string;
  let canonical: string;
  try {
    if (args.stdin) {
      label = "standard input";
      canonical = canonicalizeText(extractText(io.readStdin()));
    } else {
      const path = args.textFile ?? resolve(io.here, DEFAULT_TEXT_PATH);
      label = path;
      canonical = canonicalizeText(extractText(io.readText(path)));
    }
  } catch (error) {
    io.out(`could not read the text: ${error instanceof Error ? error.message : String(error)}`);
    return 2;
  }
  if (canonical.length === 0) {
    io.out("the text is empty");
    return 2;
  }

  if (args.printText) {
    io.out(canonical);
    return 0;
  }

  const hash = sha256Hex(canonical);
  const memo = expectedMemo(hash);
  const words = countWords(canonical);
  io.out(`Text      ${label}`);
  io.out(
    `Words     ${words}${words > WORD_LIMIT ? `  (OVER the ${WORD_LIMIT}-word limit)` : ` (limit ${WORD_LIMIT})`}`,
  );
  io.out(`SHA-256   ${hash}`);
  io.out(`Memo      ${memo}`);
  if (args.tx === null) return 0;

  const rpc = args.rpc ?? io.env("SOLANA_RPC_URL")?.trim() ?? DEFAULT_RPC;
  let answer: unknown;
  try {
    answer = await io.fetchJson(rpc, {
      jsonrpc: "2.0",
      id: 1,
      method: "getTransaction",
      params: [
        args.tx,
        { encoding: "jsonParsed", maxSupportedTransactionVersion: 0, commitment: "confirmed" },
      ],
    });
  } catch (error) {
    io.out(`could not reach the RPC: ${error instanceof Error ? error.message : String(error)}`);
    return 2;
  }
  const body = answer as { result?: ParsedTransaction | null; error?: { message?: unknown } };
  if (body.error) {
    io.out(`the RPC refused the request: ${String(body.error.message ?? "unknown error")}`);
    return 2;
  }

  const verdict = verifyTransaction(body.result ?? null, memo, args.signer);
  io.out("");
  io.out(`Transaction  ${args.tx}`);
  io.out(`Explorer     https://explorer.solana.com/tx/${args.tx}`);
  if (!verdict.ok) {
    io.out(`RESULT: NOT VERIFIED. ${verdict.reason}.`);
    return 1;
  }
  io.out(`Signed by    ${verdict.feePayer ?? "unknown"}`);
  io.out(
    `Block time   ${verdict.blockTime ?? "unknown"}${verdict.slot !== null ? ` (slot ${verdict.slot})` : ""}`,
  );
  io.out(`On-chain     ${verdict.memo}`);
  io.out(
    "RESULT: VERIFIED. The memo on-chain is the SHA-256 of the text above, so this text existed, unchanged, when that block was produced.",
  );
  return 0;
}

const defaultIo: Io = {
  out: (line) => process.stdout.write(`${line}\n`),
  readText: (path) => readFileSync(path, "utf8"),
  readStdin: () => readFileSync(0, "utf8"),
  fetchJson: async (url, body) => {
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  },
  env: (name) => process.env[name],
  here: dirname(fileURLToPath(import.meta.url)),
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run(process.argv.slice(2), defaultIo).then(
    (code) => {
      process.exitCode = code;
    },
    (error) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 2;
    },
  );
}
