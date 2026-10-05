#!/usr/bin/env node
/**
 * Poll on-chain session spend and POST `headroom_low` alerts when headroom drops below 20%
 * (same 80%-of-limit signal as guardian-watch, without calling `pause`).
 *
 * Without a hosted indexer this is the server-side path for ceiling alerts: one process per
 * treasury/policy pair you watch. Pair with MCP's `ASH_ALERT_WEBHOOK_URL` for denials.
 *
 *   pnpm alert-watch --rpc <url> --treasury <addr> --policy <addr> \
 *     --webhook-url <https://…> [--headroom-threshold-bps 2000] [--interval 30] [--once]
 */

import { buildHeadroomLowAlert, headroomBps } from "@ash/contract/alerts";
import { applyLegacyEnv } from "@ash/contract/legacy-env";
import { postAlertWebhook } from "@ash/sdk";
import {
  type Address,
  address,
  createSolanaRpc,
  getBase58Decoder,
  getBase64Encoder,
} from "@solana/kit";
import {
  AGENT_SESSION_DISCRIMINATOR,
  ASH_PROGRAM_ADDRESS,
  decodeAgentSession,
  fetchMaybePolicy,
  type MintLimit,
  type SpendCounter,
} from "../packages/client/dist/index.js";
import { rollWindow } from "./guardian-roll-window.ts";

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
  webhookUrl: string;
  headroomThresholdBps: number;
  window: WindowKind;
  intervalSeconds: number;
  once: boolean;
};

type Breach = {
  session: Address;
  mint: Address;
  spent: bigint;
  limit: bigint;
  headroom_bps: number;
};

function usage(): string {
  return `usage: pnpm alert-watch \\
  --rpc <url> --treasury <address> --policy <address> --webhook-url <https://…> \\
  [--headroom-threshold-bps 2000] [--window short|long] [--interval 30] [--once]`;
}

function parseArgs(argv: string[]): Options {
  const map = new Map<string, string>();
  const flags = new Set<string>();
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--once") {
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
  const webhookUrl = map.get("--webhook-url") ?? process.env.ASH_ALERT_WEBHOOK_URL ?? "";
  if (!treasuryRaw || !policyRaw) {
    throw new Error(`${usage()}\n--treasury and --policy are required`);
  }
  if (!webhookUrl) {
    throw new Error(`${usage()}\n--webhook-url is required`);
  }

  const headroomThresholdBps = Number(map.get("--headroom-threshold-bps") ?? "2000");
  if (
    !Number.isInteger(headroomThresholdBps) ||
    headroomThresholdBps < 0 ||
    headroomThresholdBps > 10_000
  ) {
    throw new Error("--headroom-threshold-bps must be an integer from 0 to 10000");
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
    webhookUrl,
    headroomThresholdBps,
    window: windowRaw,
    intervalSeconds,
    once: flags.has("--once"),
  };
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
  headroomThresholdBps: number;
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
      if (cap <= 0n) continue;
      const remaining = headroomBps(spent, cap);
      if (remaining < input.headroomThresholdBps) {
        breaches.push({
          session: session.address,
          mint: limit.mint,
          spent,
          limit: cap,
          headroom_bps: remaining,
        });
      }
    }
  }
  return breaches;
}

function logStatus(message: string): void {
  process.stderr.write(`${new Date().toISOString()} ${message}\n`);
}

const alerted = new Set<string>();

function breachKey(treasury: Address, breach: Breach, window: WindowKind): string {
  return `${treasury}:${breach.session}:${breach.mint}:${window}`;
}

async function evaluateOnce(options: Options): Promise<number> {
  const rpc = createSolanaRpc(options.rpcUrl);
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
    headroomThresholdBps: options.headroomThresholdBps,
    now,
  });

  if (breaches.length === 0) {
    logStatus(
      `ok — headroom above ${options.headroomThresholdBps / 100}% on ${options.window} window`,
    );
    return 0;
  }

  let sent = 0;
  for (const breach of breaches) {
    const key = breachKey(options.treasury, breach, options.window);
    if (alerted.has(key)) continue;
    const payload = buildHeadroomLowAlert({
      headroom: {
        treasury: options.treasury as string,
        session: breach.session as string,
        policy: options.policy as string,
        mint: breach.mint as string,
        window: options.window,
        spent: breach.spent.toString(),
        limit: breach.limit.toString(),
        headroom_bps: breach.headroom_bps,
        headroom_threshold_bps: options.headroomThresholdBps,
      },
    });
    const result = await postAlertWebhook(options.webhookUrl, payload);
    if (result.ok) {
      alerted.add(key);
      sent += 1;
      logStatus(
        `webhook headroom_low session=${breach.session} mint=${breach.mint} headroom_bps=${breach.headroom_bps}`,
      );
    } else {
      logStatus(`webhook failed: ${result.error ?? result.status}`);
    }
  }
  return sent;
}

async function main(): Promise<void> {
  applyLegacyEnv();
  const options = parseArgs(process.argv.slice(2));

  if (options.once) {
    await evaluateOnce(options);
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
