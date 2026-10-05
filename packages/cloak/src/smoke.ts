#!/usr/bin/env node
import { createHash } from "node:crypto";
import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import {
  CLOAK_PRIVATE_PAYOUT_TEMPLATE_ID,
  cloakPayoutProposalSchema,
  formatLamportsAsSol,
  isTransactionSignature,
  mainnetExplorerTxUrl,
  type RunEvent,
} from "@ash/contract/template-run";
import { createCloakSdkPort } from "./adapter.js";
import { COMMITMENT_MEMO } from "./commitment.js";
import { classifyError, describeForConsole, RunError } from "./errors.js";
import { formatZec } from "./fees.js";
import { keyDerivationMessage } from "./keys.js";
import { createNodeWallet, readKeypairFile } from "./node.js";
import { buildRunPlan, newRunId, type RunPlan } from "./plan.js";
import { checkRunPolicy } from "./policy.js";
import type { SdkPort, WalletPort } from "./ports.js";
import { quoteZecPayouts } from "./quotes.js";
import { emptyRunLog, type RunLog } from "./report.js";
import { recoverFunds, runPrivatePayout } from "./runner.js";

/**
 * The same run the dashboard does, from a terminal with a keypair file: the first mainnet check,
 * and the fallback if the browser path misbehaves. It signs nothing and sends nothing unless
 * `--confirm-mainnet` is given; without it, it prints what the run would do and what the wallet
 * would be asked to sign.
 */

const USAGE = `ash-cloak-smoke — a private payout on Solana mainnet, from a keypair file

  --keypair <file>        Solana CLI keypair (JSON array of 64 bytes). Required.
  --payee-sol <address>   Receives SOL through the Cloak pool.
  --amount-sol <sol>      SOL leaving the pool for that payee (default 0.02).
  --payee-zec <address>   Receives ZEC (verified mint) through a private swap.
  --amount-zec <sol>      SOL swapped for that payee (default 0.02).
  --rpc <url>             A mainnet RPC (default $CLOAK_RPC_URL, else the PublicNode endpoint).
                          Prefer the variable for a URL with a key: argv ends up in shell history.
  --out <file>            Where the proof pack goes (default cloak-proof-<run>.json).
  --log <file>            Public progress log used to resume (default cloak-smoke-log.json).
  --no-commit             Skip the Memo transaction that commits the privacy text's hash on-chain.
                          By default one is sent right after the deposit (about 0.000005 SOL).
  --confirm-mainnet       Actually sign and send. Without it this is a dry run.
  --recover               Send whatever is still spendable in the pool back to the keypair.
  --help

Real funds move with --confirm-mainnet. Amounts are capped by the template (0.05 SOL per payee,
0.10 SOL per run).
`;

export class UsageError extends Error {}

export type SmokeArgs = {
  keypair: string;
  rpc: string;
  payeeSol?: string;
  amountSol: string;
  payeeZec?: string;
  amountZec: string;
  out?: string;
  log: string;
  confirmMainnet: boolean;
  recover: boolean;
  noCommit: boolean;
  help: boolean;
};

export function parseSmokeArgs(argv: string[]): SmokeArgs {
  let values: Record<string, string | boolean | undefined>;
  try {
    values = parseArgs({
      args: argv,
      allowPositionals: false,
      strict: true,
      options: {
        keypair: { type: "string" },
        rpc: { type: "string" },
        "payee-sol": { type: "string" },
        "amount-sol": { type: "string" },
        "payee-zec": { type: "string" },
        "amount-zec": { type: "string" },
        out: { type: "string" },
        log: { type: "string" },
        "confirm-mainnet": { type: "boolean" },
        "no-commit": { type: "boolean" },
        recover: { type: "boolean" },
        help: { type: "boolean" },
      },
    }).values;
  } catch (error) {
    throw new UsageError(error instanceof Error ? error.message : "bad arguments");
  }
  const str = (key: string): string | undefined => {
    const value = values[key];
    return typeof value === "string" ? value : undefined;
  };
  const help = values.help === true;
  const args: SmokeArgs = {
    keypair: str("keypair") ?? "",
    rpc: str("rpc") || process.env.CLOAK_RPC_URL?.trim() || "https://solana-rpc.publicnode.com",
    amountSol: str("amount-sol") ?? "0.02",
    amountZec: str("amount-zec") ?? "0.02",
    log: str("log") ?? "cloak-smoke-log.json",
    confirmMainnet: values["confirm-mainnet"] === true,
    noCommit: values["no-commit"] === true,
    recover: values.recover === true,
    help,
    ...(str("payee-sol") ? { payeeSol: str("payee-sol") as string } : {}),
    ...(str("payee-zec") ? { payeeZec: str("payee-zec") as string } : {}),
    ...(str("out") ? { out: str("out") as string } : {}),
  };
  if (help) return args;
  if (!args.keypair) throw new UsageError("--keypair is required");
  if (!args.recover && !args.payeeSol && !args.payeeZec) {
    throw new UsageError("name at least one payee: --payee-sol and/or --payee-zec");
  }
  return args;
}

export type SmokeIo = {
  out: (line: string) => void;
  now: () => Date;
  readKeypair: (path: string) => Uint8Array;
  createWallet: (secretKey: Uint8Array) => Promise<WalletPort>;
  createSdk: (rpcUrl: string, secretKey: Uint8Array) => SdkPort;
  quote: typeof quoteZecPayouts;
  exists: (path: string) => boolean;
  readText: (path: string) => string;
  writeText: (path: string, text: string) => void;
  remove: (path: string) => void;
};

export const defaultIo: SmokeIo = {
  out: (line) => process.stdout.write(`${line}\n`),
  now: () => new Date(),
  readKeypair: readKeypairFile,
  createWallet: (secretKey) => createNodeWallet(secretKey),
  createSdk: (rpcUrl, secretKey) =>
    createCloakSdkPort({ rpcUrl, auth: { kind: "keypair", secretKey } }),
  quote: quoteZecPayouts,
  exists: existsSync,
  readText: (path) => readFileSync(path, "utf8"),
  writeText: (path, text) => writeFileSync(path, text, { mode: 0o644 }),
  remove: (path) => {
    if (existsSync(path)) unlinkSync(path);
  },
};

type StoredLog = RunLog & { planHash: string; fingerprint?: string };

/**
 * The progress log is read back and decides what a resume skips, so it is checked like any other
 * input: a hand-edited or foreign file must not mark a payout as paid.
 */
export function parseStoredLog(text: string): StoredLog {
  const bad = () =>
    new UsageError(
      "the progress log is not one this tool wrote; remove it, or pass --log with another path",
    );
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw bad();
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw bad();
  const {
    planHash,
    fingerprint,
    shieldSignature,
    shieldUncertain,
    commitSignature,
    payoutSignatures,
    ...rest
  } = value as Record<string, unknown>;
  const sixteenHex = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f]{16}$/.test(v);
  const signature = (v: unknown): v is string => typeof v === "string" && isTransactionSignature(v);
  if (Object.keys(rest).length > 0 || !sixteenHex(planHash)) throw bad();
  if (fingerprint !== undefined && !sixteenHex(fingerprint)) throw bad();
  if (shieldSignature !== undefined && !signature(shieldSignature)) throw bad();
  if (shieldUncertain !== undefined && typeof shieldUncertain !== "boolean") throw bad();
  if (commitSignature !== undefined && !signature(commitSignature)) throw bad();
  if (
    !payoutSignatures ||
    typeof payoutSignatures !== "object" ||
    Array.isArray(payoutSignatures)
  ) {
    throw bad();
  }
  const entries = Object.entries(payoutSignatures);
  if (!entries.every(([index, sig]) => /^\d$/.test(index) && signature(sig))) throw bad();
  return {
    planHash,
    ...(fingerprint ? { fingerprint } : {}),
    ...(shieldSignature ? { shieldSignature } : {}),
    ...(shieldUncertain ? { shieldUncertain: true } : {}),
    ...(commitSignature ? { commitSignature } : {}),
    payoutSignatures: Object.fromEntries(entries) as Record<number, string>,
  };
}

/** Ties a progress log to the exact payouts it was written for, so a stale log cannot skip a payout. */
export function planHash(plan: RunPlan): string {
  const material = JSON.stringify({
    funder: plan.funder,
    payouts: plan.payouts.map((p) => [p.address, p.deliver, p.grossLamports.toString()]),
  });
  return createHash("sha256").update(material).digest("hex").slice(0, 16);
}

function describePlan(plan: RunPlan, say: (line: string) => void): void {
  say(`Run ${plan.runId} on Solana MAINNET (real funds)`);
  say(`Funder   ${plan.funder}`);
  for (const p of plan.payouts) {
    const money =
      p.deliver === "SOL"
        ? `SOL  gross ${formatLamportsAsSol(p.grossLamports)}  fee ${formatLamportsAsSol(p.feeLamports)}  net ${formatLamportsAsSol(p.netLamports)}`
        : `ZEC  swaps ${formatLamportsAsSol(p.netLamports)} SOL after a ${formatLamportsAsSol(p.feeLamports)} fee  min ${p.zec ? formatZec(p.zec.minOutBaseUnits) : "?"} ZEC`;
    say(`Payout ${p.index + 1} ${p.label} -> ${p.address}  ${money}`);
  }
  say(
    `Shield   ${formatLamportsAsSol(plan.shieldLamports)} SOL; the wallet needs at least ${formatLamportsAsSol(plan.requiredBalanceLamports)} SOL`,
  );
  for (const warning of plan.warnings) say(`warning: ${warning}`);
}

function printEvent(event: RunEvent, say: (line: string) => void): void {
  if (event.status === "progress") {
    say(`    · ${event.message ?? ""}`);
    return;
  }
  const who = event.payeeIndex !== undefined ? ` #${event.payeeIndex + 1}` : "";
  const sig = event.signature
    ? `  ${event.signature}\n    ${mainnetExplorerTxUrl(event.signature)}`
    : "";
  const why = event.status === "failed" ? `  ${event.errorCode ?? ""} ${event.message ?? ""}` : "";
  say(`[${event.step}${who}] ${event.status}${sig}${why}`);
}

/** Returns the process exit code: 0 done, 1 the run failed, 2 bad input, 3 dry run found a problem. */
export async function runSmoke(args: SmokeArgs, io: SmokeIo = defaultIo): Promise<number> {
  const say = io.out;
  if (args.help) {
    say(USAGE);
    return 0;
  }

  let secretKey: Uint8Array;
  try {
    secretKey = io.readKeypair(args.keypair);
  } catch (error) {
    say(error instanceof Error ? error.message : "could not read the keypair");
    return 2;
  }

  try {
    const wallet = await io.createWallet(secretKey);
    const sdk = io.createSdk(args.rpc, secretKey);
    const stored: StoredLog | null = io.exists(args.log)
      ? parseStoredLog(io.readText(args.log))
      : null;

    if (args.recover) {
      say(`Recover: send everything still spendable in the pool back to ${wallet.address}`);
      if (!args.confirmMainnet) {
        say("DRY RUN: nothing was signed or sent. Re-run with --confirm-mainnet.");
        return 0;
      }
      try {
        const result = await recoverFunds({
          sdk,
          wallet,
          runId: newRunId(),
          emit: (event) => printEvent(event, say),
          // A log that names a deposit says funds should be there: finding none is then a stop.
          ...(stored?.shieldSignature ? { expectFunds: true } : {}),
          ...(stored?.fingerprint ? { expectFingerprint: stored.fingerprint } : {}),
        });
        if (result.receipt) {
          say(`Recovered ${formatLamportsAsSol(result.spendableLamports)} SOL.`);
          // The money is back in the wallet: nothing is left to resume.
          io.remove(args.log);
        } else {
          say("Nothing was found to recover.");
        }
        return 0;
      } catch (error) {
        const failure = error instanceof RunError ? error : classifyError(error);
        say(`Stopped: ${failure.code}. ${failure.message}`);
        return 1;
      }
    }

    const proposalInput = {
      template: CLOAK_PRIVATE_PAYOUT_TEMPLATE_ID,
      payees: [
        ...(args.payeeSol
          ? [
              {
                label: "SOL payee",
                address: args.payeeSol,
                deliver: "SOL",
                amountSol: args.amountSol,
              },
            ]
          : []),
        ...(args.payeeZec
          ? [
              {
                label: "ZEC payee",
                address: args.payeeZec,
                deliver: "ZEC",
                amountSol: args.amountZec,
              },
            ]
          : []),
      ],
    };
    const parsed = cloakPayoutProposalSchema.safeParse(proposalInput);
    if (!parsed.success) {
      say(`Invalid payout: ${parsed.error.issues.map((issue) => issue.message).join("; ")}`);
      return 2;
    }
    const proposal = parsed.data;
    const policy = checkRunPolicy(proposal, {
      funder: wallet.address,
      mainnetEnabled: true,
      allowedWallets: [wallet.address],
      // The smoke run pays the addresses it was given, so they are its own contacts.
      contacts: new Map(proposal.payees.map((payee) => [payee.label, payee.address])),
    });
    if (!policy.ok) {
      say(`Refused: ${policy.message}`);
      return 2;
    }

    const runId = newRunId();
    const unquoted = buildRunPlan(proposal, { runId, funder: wallet.address });
    const zecQuotes = await io.quote(unquoted.payouts);
    const plan = buildRunPlan(proposal, { runId, funder: wallet.address, zecQuotes });
    describePlan(plan, say);
    if (!args.noCommit) {
      say(
        `Commit   a separate Memo transaction right after the deposit writes: ${COMMITMENT_MEMO}`,
      );
    }

    const hash = planHash(plan);
    if (stored && stored.planHash !== hash) {
      say(
        `${args.log} was written for different payouts. Remove it, or pass --log with another path, so nothing is skipped by mistake.`,
      );
      return 2;
    }

    const info = await sdk.info();
    const health = await sdk.checkEndpoints();
    const balance = await sdk.balanceLamports(wallet.address);
    say(
      `Preflight: SDK ${info.sdkVersion}; rpc ${health.rpc ? "ok" : "DOWN"}, circuits ${health.circuits ? "ok" : "DOWN"}, relay ${health.relay ? "ok" : "DOWN"}; balance ${formatLamportsAsSol(balance)} SOL`,
    );

    if (!args.confirmMainnet) {
      const problems =
        !health.rpc || !health.circuits || !health.relay || balance < plan.requiredBalanceLamports;
      say("");
      say("DRY RUN: nothing was signed or sent.");
      say("A real run first asks the wallet to sign this message, which derives the payout keys");
      say("and moves no funds:");
      for (const line of new TextDecoder()
        .decode(keyDerivationMessage(wallet.address))
        .split("\n")) {
        say(`  | ${line}`);
      }
      say("Re-run with --confirm-mainnet to execute.");
      if (problems) say("Something above is not ready; a real run would stop in preflight.");
      return problems ? 3 : 0;
    }

    let log: RunLog = stored
      ? {
          ...(stored.shieldSignature ? { shieldSignature: stored.shieldSignature } : {}),
          ...(stored.shieldUncertain ? { shieldUncertain: true } : {}),
          ...(stored.commitSignature ? { commitSignature: stored.commitSignature } : {}),
          payoutSignatures: stored.payoutSignatures,
        }
      : emptyRunLog();
    if (stored) say("Resuming from the log: nothing already finished is sent again.");
    let fingerprint = stored?.fingerprint;
    const persist = (): void => {
      const body: StoredLog = { planHash: hash, ...log, ...(fingerprint ? { fingerprint } : {}) };
      io.writeText(args.log, JSON.stringify(body, null, 2));
    };

    try {
      const outcome = await runPrivatePayout(plan, {
        sdk,
        wallet,
        now: io.now,
        emit: (event) => printEvent(event, say),
        ...(args.noCommit ? {} : { commitment: { memo: COMMITMENT_MEMO } }),
        // The runner's own log, not one folded from events: an event that fails its schema is
        // dropped, and a log rebuilt from them would then lack a signature the run holds.
        onLog: (next) => {
          log = next;
          persist();
        },
        onFingerprint: (value) => {
          fingerprint = value;
          persist();
        },
        ...(stored?.fingerprint ? { expectFingerprint: stored.fingerprint } : {}),
        ...(stored ? { resume: log } : {}),
      });
      const proofPath = args.out ?? `cloak-proof-${plan.runId}.json`;
      io.writeText(proofPath, `${JSON.stringify(outcome.proof, null, 2)}\n`);
      if (outcome.csv) io.writeText(`${proofPath}.csv`, outcome.csv);
      // A finished payout is not resumable: leaving the log would make the same command "resume"
      // and write a proof with old signatures and new timestamps.
      io.remove(args.log);
      say("");
      say(`Done. Proof pack: ${proofPath}${outcome.csv ? ` (CSV: ${proofPath}.csv)` : ""}`);
      return 0;
    } catch (error) {
      const failure = error instanceof RunError ? error : classifyError(error);
      say("");
      say(`Stopped: ${failure.code}. ${failure.message}`);
      say(
        `If funds were shielded, run the same command again to resume, or add --recover --confirm-mainnet to send them back to ${wallet.address}.`,
      );
      return 1;
    }
  } catch (error) {
    say(`Failed before the run started: ${describeForConsole(error)}`);
    return 2;
  } finally {
    secretKey.fill(0);
  }
}

async function main(): Promise<void> {
  let args: SmokeArgs;
  try {
    args = parseSmokeArgs(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : "bad arguments"}\n\n${USAGE}`);
    process.exitCode = 2;
    return;
  }
  process.exitCode = await runSmoke(args);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main();
}
