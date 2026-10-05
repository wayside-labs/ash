#!/usr/bin/env node
/**
 * Minimal Guardian-as-a-Service watcher (F5 / P1-01).
 *
 * Polls on-chain session spend counters and calls `pause` when a configurable share of the
 * policy window limit is consumed. Opt-in: the owner must `guardian add` this key; revocable
 * with `guardian rm`. Pause blocks agent payments only — owner `withdraw` keeps working.
 *
 * Requires `pnpm build` so workspace packages resolve from dist/.
 *
 *   pnpm guardian-watch --rpc <url> --treasury <addr> --policy <addr> \
 *     --guardian-keypair <path> [--threshold-bps 8000] [--interval 30] [--once]
 */

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  type Address,
  address,
  appendTransactionMessageInstructions,
  createKeyPairSignerFromBytes,
  createSolanaRpc,
  createTransactionMessage,
  getBase58Decoder,
  getBase64EncodedWireTransaction,
  getBase64Encoder,
  getProgramDerivedAddress,
  getSignatureFromTransaction,
  type KeyPairSigner,
  pipe,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransactionMessageWithSigners,
} from "@solana/kit";
import {
  AGENT_SESSION_DISCRIMINATOR,
  ASH_PROGRAM_ADDRESS,
  decodeAgentSession,
  fetchMaybePolicy,
  fetchMaybeTreasury,
  getPauseInstruction,
  type MintLimit,
  type SpendCounter,
} from "../packages/client/dist/index.js";
import { applyLegacyEnv } from "../packages/contract/dist/legacy-env.js";
import { stringifyRpcError } from "../packages/sdk/dist/index.js";
import { rollWindow } from "./guardian-roll-window.ts";

const repoRoot = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const base64 = getBase64Encoder();
const base58 = getBase58Decoder();
const SESSION_DISCRIMINATOR_B58 = base58.decode(AGENT_SESSION_DISCRIMINATOR);
const TREASURY_FIELD_OFFSET = 10n;
const SYSTEM_PROGRAM = address("11111111111111111111111111111111");

type WindowKind = "short" | "long";

type Options = {
  rpcUrl: string;
  treasury: Address;
  policy: Address;
  guardianKeypair: string;
  thresholdBps: number;
  window: WindowKind;
  intervalSeconds: number;
  once: boolean;
  dryRun: boolean;
};

type Breach = {
  session: Address;
  mint: Address;
  spent: bigint;
  limit: bigint;
  threshold: bigint;
};

function usage(): string {
  return `usage: pnpm guardian-watch \\
  --rpc <url> --treasury <address> --policy <address> \\
  --guardian-keypair <path> \\
  [--threshold-bps 8000] [--window short|long] [--interval 30] [--once] [--dry-run]`;
}

function parseArgs(argv: string[]): Options {
  const map = new Map<string, string>();
  const flags = new Set<string>();
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--once" || arg === "--dry-run") {
      flags.add(arg);
      continue;
    }
    if (!arg.startsWith("--")) continue;
    const value = argv[i + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`missing value for ${arg}`);
    }
    map.set(arg, value);
    i++;
  }

  const rpcUrl = map.get("--rpc") ?? process.env.ASH_RPC ?? "https://api.devnet.solana.com";
  const treasuryRaw = map.get("--treasury") ?? process.env.ASH_TREASURY;
  const policyRaw = map.get("--policy") ?? process.env.ASH_POLICY;
  const guardianKeypair = map.get("--guardian-keypair") ?? process.env.ASH_GUARDIAN_KEYPAIR ?? "";
  if (!treasuryRaw || !policyRaw) {
    throw new Error(`${usage()}\n--treasury and --policy are required`);
  }
  if (!guardianKeypair) {
    throw new Error(`${usage()}\n--guardian-keypair is required (hot guardian key only)`);
  }

  const thresholdBps = Number(map.get("--threshold-bps") ?? "8000");
  if (!Number.isInteger(thresholdBps) || thresholdBps < 1 || thresholdBps > 10_000) {
    throw new Error("--threshold-bps must be an integer from 1 to 10000");
  }

  const windowRaw = map.get("--window") ?? "short";
  if (windowRaw !== "short" && windowRaw !== "long") {
    throw new Error("--window must be short or long");
  }

  const intervalSeconds = Number(map.get("--interval") ?? "30");
  if (!Number.isFinite(intervalSeconds) || intervalSeconds < 5) {
    throw new Error("--interval must be at least 5 seconds");
  }

  return {
    rpcUrl,
    treasury: address(treasuryRaw),
    policy: address(policyRaw),
    guardianKeypair: resolve(guardianKeypair),
    thresholdBps,
    window: windowRaw,
    intervalSeconds,
    once: flags.has("--once"),
    dryRun: flags.has("--dry-run"),
  };
}

async function loadSigner(path: string): Promise<KeyPairSigner> {
  const raw = await readFile(path, "utf8");
  const bytes = Uint8Array.from(JSON.parse(raw) as number[]);
  return createKeyPairSignerFromBytes(bytes);
}

async function findEventAuthority(): Promise<Address> {
  const [pda] = await getProgramDerivedAddress({
    programAddress: ASH_PROGRAM_ADDRESS,
    seeds: [new TextEncoder().encode("__event_authority")],
  });
  return pda;
}

function rolledSpend(
  counter: SpendCounter,
  limit: MintLimit,
  window: WindowKind,
  now: bigint,
): bigint {
  if (window === "short") {
    const [, spent] = rollWindow(
      counter.shortWindowStart,
      counter.shortSpent,
      limit.shortWindowSeconds,
      now,
    );
    return spent;
  }
  const [, spent] = rollWindow(
    counter.longWindowStart,
    counter.longSpent,
    limit.longWindowSeconds,
    now,
  );
  return spent;
}

function windowLimit(limit: MintLimit, window: WindowKind): bigint {
  return window === "short" ? limit.shortWindowMax : limit.longWindowMax;
}

function thresholdAmount(limit: bigint, thresholdBps: number): bigint {
  return (limit * BigInt(thresholdBps)) / 10_000n;
}

function counterForMint(spend: SpendCounter[], mint: Address): SpendCounter | undefined {
  return spend.find((c) => c.mint === mint && c.mint !== SYSTEM_PROGRAM);
}

async function fetchSessions(
  rpc: ReturnType<typeof createSolanaRpc>,
  treasury: Address,
): Promise<{ address: Address; policy: Address; spend: SpendCounter[]; live: boolean }[]> {
  const accounts = await rpc
    .getProgramAccounts(ASH_PROGRAM_ADDRESS, {
      encoding: "base64",
      filters: [
        { memcmp: { offset: 0n, bytes: SESSION_DISCRIMINATOR_B58, encoding: "base58" } },
        {
          memcmp: {
            offset: TREASURY_FIELD_OFFSET,
            bytes: treasury as string,
            encoding: "base58",
          },
        },
      ],
    })
    .send();

  const now = BigInt(Math.floor(Date.now() / 1000));
  return accounts.map((acc) => {
    const decoded = decodeAgentSession({
      address: acc.pubkey,
      data: new Uint8Array(base64.encode(acc.account.data[0])),
      executable: acc.account.executable,
      lamports: acc.account.lamports,
      programAddress: acc.account.owner,
      space: BigInt(acc.account.space ?? 0),
    }).data;
    const expiresAt = decoded.expiresAt;
    const live = !decoded.revoked && expiresAt > now;
    return { address: acc.pubkey, policy: decoded.policy, spend: decoded.spend, live };
  });
}

function findBreaches(input: {
  policy: Address;
  sessions: { address: Address; policy: Address; spend: SpendCounter[]; live: boolean }[];
  limits: MintLimit[];
  window: WindowKind;
  thresholdBps: number;
  now: bigint;
}): Breach[] {
  const breaches: Breach[] = [];
  for (const session of input.sessions) {
    if (!session.live || session.policy !== input.policy) continue;
    for (const limit of input.limits) {
      if (!limit.mint || limit.mint === SYSTEM_PROGRAM) continue;
      const counter = counterForMint(session.spend, limit.mint);
      if (!counter) continue;
      const spent = rolledSpend(counter, limit, input.window, input.now);
      const cap = windowLimit(limit, input.window);
      const threshold = thresholdAmount(cap, input.thresholdBps);
      if (spent >= threshold && cap > 0n) {
        breaches.push({
          session: session.address,
          mint: limit.mint,
          spent,
          limit: cap,
          threshold,
        });
      }
    }
  }
  return breaches;
}

async function sendPause(
  rpc: ReturnType<typeof createSolanaRpc>,
  guardian: KeyPairSigner,
  treasury: Address,
): Promise<string> {
  const eventAuthority = await findEventAuthority();
  const instruction = getPauseInstruction({
    authority: guardian,
    treasury,
    eventAuthority,
    program: ASH_PROGRAM_ADDRESS,
  });

  const { value: blockhash } = await rpc.getLatestBlockhash({ commitment: "confirmed" }).send();
  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayerSigner(guardian, m),
    (m) => setTransactionMessageLifetimeUsingBlockhash(blockhash, m),
    (m) => appendTransactionMessageInstructions([instruction], m),
  );
  const signed = await signTransactionMessageWithSigners(message);
  const signature = getSignatureFromTransaction(signed);
  const wire = getBase64EncodedWireTransaction(signed);

  await rpc
    .sendTransaction(wire, {
      encoding: "base64",
      skipPreflight: false,
      preflightCommitment: "confirmed",
    })
    .send();

  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    const { value } = await rpc.getSignatureStatuses([signature]).send();
    const status = value[0];
    if (status?.err) {
      throw new Error(`pause failed on-chain: ${stringifyRpcError(status.err)}`);
    }
    if (status?.confirmationStatus === "confirmed" || status?.confirmationStatus === "finalized") {
      return signature;
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error(`pause timed out waiting for confirmation: ${signature}`);
}

function logStatus(message: string): void {
  process.stderr.write(`${new Date().toISOString()} ${message}\n`);
}

async function evaluateOnce(options: Options): Promise<{ paused: boolean; breaches: Breach[] }> {
  const rpc = createSolanaRpc(options.rpcUrl);
  const guardian = await loadSigner(options.guardianKeypair);

  const treasuryAccount = await fetchMaybeTreasury(rpc, options.treasury, {
    commitment: "confirmed",
  });
  if (!treasuryAccount.exists) {
    throw new Error(`no treasury at ${options.treasury}`);
  }

  const guardians = treasuryAccount.data.guardians.slice(0, treasuryAccount.data.guardianCount);
  if (!guardians.includes(guardian.address)) {
    throw new Error(
      `wallet ${guardian.address} is not a guardian on this treasury — run guardian add first`,
    );
  }

  if (treasuryAccount.data.paused) {
    logStatus("treasury already paused; nothing to do");
    return { paused: false, breaches: [] };
  }

  const policyAccount = await fetchMaybePolicy(rpc, options.policy, { commitment: "confirmed" });
  if (!policyAccount.exists) {
    throw new Error(`no policy at ${options.policy}`);
  }
  if (policyAccount.data.treasury !== options.treasury) {
    throw new Error("policy does not belong to this treasury");
  }

  const limits = policyAccount.data.mintLimits.slice(0, policyAccount.data.mintCount);
  const sessions = await fetchSessions(rpc, options.treasury);
  const now = BigInt(Math.floor(Date.now() / 1000));
  const breaches = findBreaches({
    policy: options.policy,
    sessions,
    limits,
    window: options.window,
    thresholdBps: options.thresholdBps,
    now,
  });

  if (breaches.length === 0) {
    logStatus(
      `ok — no breach (${options.window} window, threshold ${options.thresholdBps / 100}% of limit)`,
    );
    return { paused: false, breaches };
  }

  for (const b of breaches) {
    logStatus(
      `breach session=${b.session} mint=${b.mint} spent=${b.spent} threshold=${b.threshold} limit=${b.limit}`,
    );
  }

  if (options.dryRun) {
    logStatus("dry-run: would send pause");
    return { paused: false, breaches };
  }

  const signature = await sendPause(rpc, guardian, options.treasury);
  logStatus(`pause confirmed: ${signature}`);
  return { paused: true, breaches };
}

async function main(): Promise<void> {
  applyLegacyEnv();
  process.chdir(repoRoot);
  const options = parseArgs(process.argv.slice(2));

  if (options.once) {
    const result = await evaluateOnce(options);
    process.exitCode = result.paused ? 2 : 0;
    return;
  }

  for (;;) {
    try {
      await evaluateOnce(options);
    } catch (error) {
      logStatus(`error: ${error instanceof Error ? error.message : String(error)}`);
    }
    await new Promise((r) => setTimeout(r, options.intervalSeconds * 1000));
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
