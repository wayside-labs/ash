import { type RunEvent, SYSTEM_PROGRAM_ADDRESS } from "@ash/contract/template-run";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { COMMITMENT_MEMO } from "./commitment.js";
import { NETWORK_BUFFER_LAMPORTS } from "./constants.js";
import { RunError } from "./errors.js";
import type { PayoutSession, SdkPort } from "./ports.js";
import { emptyRunLog, type RunLog, reduceRunLog } from "./report.js";
import { type RunnerDeps, recoverFunds, runPrivatePayout } from "./runner.js";
import { addr, demoPlan, FUNDER } from "./test-support.js";
import {
  createFakeSdk,
  createFakeWallet,
  type FakeSdkOptions,
  type FakeWalletOptions,
} from "./testing.js";

const PAYEE_A = addr(1);
const PAYEE_B = addr(2);

let logged: string[] = [];

beforeEach(() => {
  logged = [];
  for (const method of ["error", "warn", "log", "info", "debug"] as const) {
    vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
      logged.push(args.map(String).join(" "));
    });
  }
});

afterEach(() => {
  vi.restoreAllMocks();
});

function harness(
  options: {
    sdk?: FakeSdkOptions;
    wallet?: FakeWalletOptions["mode"];
    deps?: Partial<RunnerDeps>;
  } = {},
) {
  const sdk = createFakeSdk(options.sdk);
  const wallet = createFakeWallet({
    address: FUNDER,
    ...(options.wallet ? { mode: options.wallet } : {}),
  });
  const events: RunEvent[] = [];
  const logs: RunLog[] = [];
  const deps: RunnerDeps = {
    sdk,
    wallet,
    emit: (event) => events.push(event),
    onLog: (log) => logs.push(log),
    ...options.deps,
  };
  return { sdk, wallet, events, logs, deps };
}

/** What the SDK throws when it learns, after the fact, how a spend whose reply it lost ended. */
const settlement = (outcome: string, signature: string | null) =>
  Object.assign(new Error(`The relay's reply was lost (${outcome}).`), {
    name: "SettlementVerificationError",
    outcome,
    signature,
    safeToRetry: outcome === "not-landed" || outcome === "failed",
  });

const shape = (events: RunEvent[]) =>
  events.filter((e) => e.status !== "progress").map((e) => `${e.step}:${e.status}`);

const toLog = (events: RunEvent[]): RunLog => events.reduce(reduceRunLog, emptyRunLog());

describe("a complete run", () => {
  it("shields once, pays each payee, reports, and proves it", async () => {
    const { sdk, wallet, events, deps } = harness();
    const plan = demoPlan();
    const outcome = await runPrivatePayout(plan, deps);

    expect(sdk.calls).toEqual([
      "shield:40000000",
      `withdraw:${PAYEE_A}:20000000`,
      `swap:${PAYEE_B}:20000000:179340`,
      "scan",
    ]);
    expect(shape(events)).toEqual([
      "preflight:started",
      "preflight:done",
      "derive-keys:started",
      "derive-keys:done",
      "shield:started",
      "shield:done",
      "payout:started",
      "payout:done",
      "payout:started",
      "payout:done",
      "report:started",
      "report:done",
    ]);
    expect(outcome.proof.shield.amountLamports).toBe("40000000");
    expect(outcome.proof.payouts.map((p) => p.deliver)).toEqual(["SOL", "ZEC"]);
    expect(outcome.proof.payouts[1]?.minOutputBaseUnits).toBe("179340");
    expect(outcome.csv.startsWith("type,")).toBe(true);
    expect(outcome.fingerprint).toMatch(/^[0-9a-f]{16}$/);
    // The first run on a device asks the wallet twice, to prove it signs deterministically.
    expect(wallet.prompts()).toBe(2);
    expect(sdk.openSessions()).toBe(1);
    expect(sdk.disposedSessions()).toBe(1);
  });

  it("puts the same signatures in the timeline, the log and the proof", async () => {
    const { events, deps } = harness();
    const outcome = await runPrivatePayout(demoPlan(), deps);
    const fromEvents = events.filter((e) => e.status === "done" && e.signature);
    expect(fromEvents.map((e) => e.signature)).toEqual([
      outcome.proof.shield.signature,
      ...outcome.proof.payouts.map((p) => p.signature),
    ]);
    expect(outcome.log.shieldSignature).toBe(outcome.proof.shield.signature);
    expect(toLog(events)).toEqual(outcome.log);
  });

  it("hands the caller its log as it grows, so what is stored never depends on the events", async () => {
    const { logs, deps } = harness();
    const outcome = await runPrivatePayout(demoPlan(), deps);
    expect(logs).toHaveLength(3); // the shield, then one per payout
    expect(Object.keys(logs[0] ?? {})).toEqual(["shieldSignature", "payoutSignatures"]);
    expect(Object.keys(logs[0]?.payoutSignatures ?? {})).toEqual([]);
    expect(Object.keys(logs[1]?.payoutSignatures ?? {})).toEqual(["0"]);
    expect(logs.at(-1)).toEqual(outcome.log);
    // A snapshot, not the runner's own object: a caller that keeps it cannot be changed under.
    expect(logs[0]).not.toBe(logs[1]);
  });
});

describe("what never leaves the session", () => {
  it("keeps every secret out of the timeline, the proof, the CSV, the log and the console", async () => {
    const { sdk, wallet, events, deps } = harness();
    const outcome = await runPrivatePayout(demoPlan(), deps);

    const haystack = [
      JSON.stringify(events),
      JSON.stringify(outcome.proof),
      outcome.csv,
      JSON.stringify(outcome.log),
      logged.join("\n"),
    ].join("\n");
    const secrets = [
      ...sdk.secrets(),
      ...wallet.signatures.flatMap((sig) => [
        Buffer.from(sig).toString("hex"),
        Buffer.from(sig).toString("base64"),
      ]),
    ];
    // A positive control: the fake really holds a seed, keys, notes and the wallet's signature.
    expect(secrets.length).toBeGreaterThanOrEqual(8);
    for (const secret of secrets) expect(haystack, secret.slice(0, 12)).not.toContain(secret);
  });

  it("also keeps them out when the run fails halfway", async () => {
    const { sdk, wallet, events, deps } = harness({
      sdk: { failures: [{ at: "swap", error: new Error("relay said no") }] },
    });
    await expect(runPrivatePayout(demoPlan(), deps)).rejects.toBeInstanceOf(RunError);
    const haystack = JSON.stringify(events) + logged.join("\n");
    for (const secret of [
      ...sdk.secrets(),
      ...wallet.signatures.map((s) => Buffer.from(s).toString("hex")),
    ]) {
      expect(haystack).not.toContain(secret);
    }
  });

  it("drops SDK progress lines that are long tokens or markup, and keeps plain ones", async () => {
    const base = createFakeSdk();
    const sdk: SdkPort = {
      ...base,
      async openSession(seed) {
        const session = await base.openSession(seed);
        const wrapped: PayoutSession = {
          ...session,
          async shield(amount, onStage) {
            onStage?.("Building transaction...");
            onStage?.("A".repeat(80));
            onStage?.("f".repeat(64));
            onStage?.("<script>alert(1)</script>");
            onStage?.("");
            onStage?.("Proof 40%");
            return session.shield(amount, onStage);
          },
        };
        return wrapped;
      },
    };
    const { events, deps } = harness({ deps: { sdk } });
    await runPrivatePayout(demoPlan(), deps);
    const messages = events.filter((e) => e.status === "progress").map((e) => e.message);
    expect(messages).toEqual(["Building transaction...", "Proof 40%"]);
  });
});

describe("before any funds move", () => {
  it("refuses a wallet other than the one the plan was priced for, before touching the network", async () => {
    const sdk = createFakeSdk();
    const wallet = createFakeWallet({ address: addr(555) });
    const events: RunEvent[] = [];
    await expect(
      runPrivatePayout(demoPlan(), { sdk, wallet, emit: (e) => events.push(e) }),
    ).rejects.toMatchObject({ code: "wallet_not_allowed" });
    expect(sdk.calls).toEqual([]);
    expect(wallet.prompts()).toBe(0);
    expect(events.at(-1)).toMatchObject({ step: "preflight", status: "failed" });
  });

  it("stops, without a wallet prompt, when the wallet cannot cover the run", async () => {
    const plan = demoPlan();
    const { sdk, wallet, events, deps } = harness({
      sdk: { balanceLamports: plan.requiredBalanceLamports - 1n },
    });
    await expect(runPrivatePayout(plan, deps)).rejects.toMatchObject({
      code: "insufficient_balance",
    });
    expect(sdk.calls).toEqual([]);
    expect(wallet.prompts()).toBe(0);
    expect(events.at(-1)).toMatchObject({
      step: "preflight",
      status: "failed",
      errorCode: "insufficient_balance",
    });
  });

  it("accepts a wallet that holds exactly what the run needs", async () => {
    const plan = demoPlan();
    const { deps } = harness({
      sdk: { balanceLamports: plan.shieldLamports + NETWORK_BUFFER_LAMPORTS },
    });
    await expect(runPrivatePayout(plan, deps)).resolves.toBeDefined();
  });

  it.each([
    ["rpc", "rpc_unreachable"],
    ["circuits", "circuits_unreachable"],
    ["relay", "relay_unreachable"],
  ] as const)("names the dependency that is down: %s", async (down, code) => {
    const { sdk, wallet, deps } = harness({ sdk: { health: { [down]: false } } });
    await expect(runPrivatePayout(demoPlan(), deps)).rejects.toMatchObject({ code });
    expect(sdk.calls).toEqual([]);
    expect(wallet.prompts()).toBe(0);
  });

  it("will not start a ZEC payout it cannot bound with a quote", async () => {
    const { sdk, wallet, deps } = harness();
    await expect(runPrivatePayout(demoPlan({ quotes: false }), deps)).rejects.toMatchObject({
      code: "swap_quote_unavailable",
    });
    expect(sdk.calls).toEqual([]);
    expect(wallet.prompts()).toBe(0);
  });

  it("stops at a closed signature prompt and opens no session", async () => {
    const { sdk, events, deps } = harness({ wallet: "reject" });
    await expect(runPrivatePayout(demoPlan(), deps)).rejects.toMatchObject({
      code: "wallet_rejected",
    });
    expect(sdk.openSessions()).toBe(0);
    expect(sdk.calls).toEqual([]);
    expect(events.at(-1)).toMatchObject({
      step: "derive-keys",
      status: "failed",
      errorCode: "wallet_rejected",
    });
  });

  it("refuses a wallet that does not sign the same way twice, and shields nothing", async () => {
    const { sdk, deps } = harness({ wallet: "random" });
    await expect(runPrivatePayout(demoPlan(), deps)).rejects.toMatchObject({
      code: "keys_not_deterministic",
    });
    expect(sdk.openSessions()).toBe(0);
    expect(sdk.calls).toEqual([]);
  });
});

describe("keys from an earlier run", () => {
  it("asks once, and stores nothing new, when the checksum matches", async () => {
    const first = harness();
    const { fingerprint } = await runPrivatePayout(demoPlan(), first.deps);

    const seen: string[] = [];
    const again = harness({
      deps: { expectFingerprint: fingerprint, onFingerprint: (f) => seen.push(f) },
    });
    await runPrivatePayout(demoPlan(), again.deps);
    expect(again.wallet.prompts()).toBe(1);
    expect(seen).toEqual([fingerprint]);
  });

  it("stops before shielding when the wallet now derives other keys", async () => {
    const seen: string[] = [];
    const { sdk, events, deps } = harness({
      deps: { expectFingerprint: "0".repeat(16), onFingerprint: (f) => seen.push(f) },
    });
    await expect(runPrivatePayout(demoPlan(), deps)).rejects.toMatchObject({
      code: "keys_mismatch",
    });
    expect(sdk.calls).toEqual([]);
    expect(sdk.disposedSessions()).toBe(1);
    expect(seen).toEqual([]);
    expect(events.at(-1)?.message).not.toContain("Funds are in the Cloak pool");
  });

  it("hands the checksum over as soon as the keys exist, even if the run then fails", async () => {
    const seen: string[] = [];
    const { deps } = harness({
      sdk: { failures: [{ at: "shield", error: new Error("boom") }] },
      deps: { onFingerprint: (f) => seen.push(f) },
    });
    await expect(runPrivatePayout(demoPlan(), deps)).rejects.toBeInstanceOf(RunError);
    expect(seen).toHaveLength(1);
  });
});

describe("a run that stops halfway", () => {
  it("says the funds are in the pool, and names the payee that failed", async () => {
    const { events, deps } = harness({
      sdk: { failures: [{ at: "withdraw", recipient: PAYEE_A, error: new Error("boom") }] },
    });
    await expect(runPrivatePayout(demoPlan(), deps)).rejects.toMatchObject({ code: "unknown" });
    const failed = events.at(-1);
    expect(failed).toMatchObject({ step: "payout", status: "failed", payeeIndex: 0 });
    expect(failed?.message).toContain("Funds are in the Cloak pool");
  });

  it("resumes without shielding again and without paying anyone twice", async () => {
    const sdk = createFakeSdk({
      failures: [{ at: "swap", recipient: PAYEE_B, error: new Error("relay hiccup") }],
    });
    const wallet = createFakeWallet({ address: FUNDER });
    const firstEvents: RunEvent[] = [];
    await expect(
      runPrivatePayout(demoPlan(), { sdk, wallet, emit: (e) => firstEvents.push(e) }),
    ).rejects.toBeInstanceOf(RunError);
    // SOL payout done, ZEC payout not: 20,000,000 lamports still in the pool.
    const log = toLog(firstEvents);
    expect(log.shieldSignature).toBeDefined();
    expect(Object.keys(log.payoutSignatures)).toEqual(["0"]);

    sdk.calls.length = 0;
    const secondEvents: RunEvent[] = [];
    const outcome = await runPrivatePayout(demoPlan(), {
      sdk,
      wallet,
      emit: (e) => secondEvents.push(e),
      resume: log,
    });

    expect(sdk.calls).toEqual(["recover", `swap:${PAYEE_B}:20000000:179340`, "scan"]);
    // Scoped to this run's deposit: an earlier run's leftover cannot stand in for what is owed.
    expect(sdk.scopes).toEqual([{ shieldSignature: log.shieldSignature }]);
    expect(shape(secondEvents)).toContain("shield:skipped");
    expect(secondEvents.find((e) => e.step === "payout" && e.status === "skipped")).toMatchObject({
      payeeIndex: 0,
      signature: log.payoutSignatures[0],
    });
    expect(outcome.proof.shield.signature).toBe(log.shieldSignature);
    expect(outcome.proof.payouts[0]?.signature).toBe(log.payoutSignatures[0]);
    expect(outcome.proof.payouts[1]?.signature).not.toBe(log.payoutSignatures[0]);
  });

  it("does not trust a log the chain no longer backs", async () => {
    const sdk = createFakeSdk(); // an empty pool: whatever the log says was shielded is not there
    const wallet = createFakeWallet({ address: FUNDER });
    const events: RunEvent[] = [];
    const log: RunLog = { shieldSignature: "5".repeat(87), payoutSignatures: {} };
    await expect(
      runPrivatePayout(demoPlan(), { sdk, wallet, emit: (e) => events.push(e), resume: log }),
    ).rejects.toMatchObject({ code: "outcome_unknown" });
    expect(sdk.calls).toEqual(["recover"]);
  });

  it("can be stopped between steps, and says what that left behind", async () => {
    const controller = new AbortController();
    const sdk = createFakeSdk();
    const wallet = createFakeWallet({ address: FUNDER });
    const events: RunEvent[] = [];
    await expect(
      runPrivatePayout(demoPlan(), {
        sdk,
        wallet,
        signal: controller.signal,
        emit: (event) => {
          events.push(event);
          if (event.step === "shield" && event.status === "done") controller.abort();
        },
      }),
    ).rejects.toMatchObject({ code: "aborted" });
    expect(sdk.calls).toEqual(["shield:40000000"]);
    expect(events.at(-1)?.message).toContain("Funds are in the Cloak pool");
    expect(sdk.disposedSessions()).toBe(1);
  });
});

describe("the report", () => {
  it("does not turn a lost CSV into a failed payout", async () => {
    const { events, deps } = harness({
      sdk: { failures: [{ at: "scan", error: new Error("rpc down") }] },
    });
    const outcome = await runPrivatePayout(demoPlan(), deps);
    expect(outcome.csv).toBe("");
    expect(outcome.proof.payouts).toHaveLength(2);
    expect(events.at(-1)).toMatchObject({ step: "report", status: "failed" });
    expect(events.at(-1)?.message).toContain("transactions above are final");
  });
});

describe("recoverFunds", () => {
  async function strandedFunds() {
    const sdk = createFakeSdk({
      failures: [{ at: "withdraw", recipient: PAYEE_A, error: new Error("boom") }],
    });
    const wallet = createFakeWallet({ address: FUNDER });
    await expect(
      runPrivatePayout(demoPlan(), { sdk, wallet, emit: () => {} }),
    ).rejects.toBeInstanceOf(RunError);
    sdk.calls.length = 0;
    return { sdk, wallet };
  }

  it("sends everything spendable back to the wallet that funded the run", async () => {
    const { sdk, wallet } = await strandedFunds();
    const events: RunEvent[] = [];
    const result = await recoverFunds({ sdk, wallet, runId: "run_x", emit: (e) => events.push(e) });
    expect(result.spendableLamports).toBe(40_000_000n);
    expect(result.receipt?.signature).toBeDefined();
    expect(sdk.calls).toEqual(["recover", `sweep:${FUNDER}`]);
    expect(shape(events)).toEqual(["recover:started", "recover:done"]);
    expect(events.at(-1)?.signature).toBe(result.receipt?.signature);
  });

  it("looks for everything the keys can rebuild, not for one run's deposit", async () => {
    const { sdk, wallet } = await strandedFunds();
    await recoverFunds({ sdk, wallet, runId: "run_x", emit: () => {} });
    expect(sdk.scopes).toEqual([undefined]);
  });

  it("does not call an empty answer a recovery when the run says funds were shielded", async () => {
    const sdk = createFakeSdk();
    const wallet = createFakeWallet({ address: FUNDER });
    const events: RunEvent[] = [];
    await expect(
      recoverFunds({
        sdk,
        wallet,
        runId: "run_x",
        emit: (e) => events.push(e),
        expectFunds: true,
      }),
    ).rejects.toMatchObject({ code: "outcome_unknown" });
    expect(shape(events)).toEqual(["recover:started", "recover:failed"]);
    expect(events.at(-1)?.message).toContain("full-history RPC");
  });

  it("names a recovery that sent back a transfer it cannot cite", async () => {
    const base = createFakeSdk();
    const sdk: SdkPort = {
      ...base,
      async openSession(seed) {
        const session = await base.openSession(seed);
        await session.shield(10_000_000n);
        return { ...session, sweepAll: async () => ({ signature: "nope" }) };
      },
    };
    const wallet = createFakeWallet({ address: FUNDER });
    await expect(
      recoverFunds({ sdk, wallet, runId: "run_x", emit: () => {} }),
    ).rejects.toMatchObject({ code: "outcome_unknown" });
  });

  it("reports an empty pool instead of failing", async () => {
    const { sdk, wallet } = await strandedFunds();
    await recoverFunds({ sdk, wallet, runId: "run_x", emit: () => {} });
    sdk.calls.length = 0;
    const events: RunEvent[] = [];
    const again = await recoverFunds({ sdk, wallet, runId: "run_x", emit: (e) => events.push(e) });
    expect(again).toEqual({ spendableLamports: 0n, receipt: null });
    expect(sdk.calls).toEqual(["recover"]);
    expect(events.at(-1)?.message).toContain("Nothing was found in the pool");
  });

  it("refuses to sweep under keys that are not the ones that funded the pool", async () => {
    const { sdk, wallet } = await strandedFunds();
    await expect(
      recoverFunds({
        sdk,
        wallet,
        runId: "run_x",
        emit: () => {},
        expectFingerprint: "f".repeat(16),
      }),
    ).rejects.toMatchObject({ code: "keys_mismatch" });
    expect(sdk.calls).toEqual([]);
  });

  it("reports a sweep that fails, and leaves the pool as it was", async () => {
    const { sdk, wallet } = await strandedFunds();
    const failing = createFakeSdk({ failures: [{ at: "sweep", error: new Error("boom") }] });
    // Same seed => same keys => a fresh fake has an empty pool; fund it through a shield first.
    const session = await failing.openSession(
      await (async () => {
        const w = createFakeWallet({ address: FUNDER });
        const { obtainMasterSeed } = await import("./keys.js");
        return obtainMasterSeed(w, { verifyDeterminism: false });
      })(),
    );
    await session.shield(10_000_000n);
    session.dispose();
    const events: RunEvent[] = [];
    await expect(
      recoverFunds({ sdk: failing, wallet, runId: "run_x", emit: (e) => events.push(e) }),
    ).rejects.toMatchObject({ code: "unknown" });
    expect(events.at(-1)).toMatchObject({ step: "recover", status: "failed" });
    void sdk;
  });
});

describe("payees that are not wallets", () => {
  const TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";

  it("refuses a payee the chain says belongs to a program, before anything is shielded", async () => {
    const { sdk, wallet, events, logs, deps } = harness({
      sdk: { owners: { [PAYEE_B]: TOKEN_PROGRAM } },
    });
    await expect(runPrivatePayout(demoPlan(), deps)).rejects.toMatchObject({
      code: "payee_invalid",
    });
    expect(sdk.calls).toEqual([]);
    expect(wallet.prompts()).toBe(0);
    expect(logs).toEqual([]);
    expect(events.at(-1)).toMatchObject({ step: "preflight", errorCode: "payee_invalid" });
  });

  it("accepts a payee with no account yet, and one a wallet owns", async () => {
    const { sdk, deps } = harness({
      sdk: { owners: { [PAYEE_A]: SYSTEM_PROGRAM_ADDRESS } }, // PAYEE_B has no account
    });
    await expect(runPrivatePayout(demoPlan(), deps)).resolves.toBeDefined();
    expect(sdk.lookups.sort()).toEqual([PAYEE_A, PAYEE_B].sort());
  });

  it("does not look up a payee a resume has already paid", async () => {
    const sdk = createFakeSdk({
      failures: [{ at: "swap", recipient: PAYEE_B, error: new Error("relay hiccup") }],
    });
    const wallet = createFakeWallet({ address: FUNDER });
    const events: RunEvent[] = [];
    await expect(
      runPrivatePayout(demoPlan(), { sdk, wallet, emit: (e) => events.push(e) }),
    ).rejects.toBeInstanceOf(RunError);
    const log = toLog(events);
    sdk.lookups.length = 0;
    await runPrivatePayout(demoPlan(), { sdk, wallet, emit: () => {}, resume: log });
    expect(sdk.lookups).toEqual([PAYEE_B]);
  });
});

describe("a step that landed although the SDK threw", () => {
  it("records the signature of a payout whose reply was lost, so a resume does not repeat it", async () => {
    const { sdk, wallet, events, logs, deps } = harness({
      sdk: {
        failures: [
          {
            at: "withdraw",
            recipient: PAYEE_A,
            landed: true,
            error: (receipt: { signature: string }) => settlement("landed", receipt.signature),
          },
        ],
      },
    });
    await expect(runPrivatePayout(demoPlan(), deps)).rejects.toMatchObject({
      code: "outcome_unknown",
    });
    const landed = events.find((e) => e.step === "payout" && e.status === "done");
    expect(landed).toMatchObject({ payeeIndex: 0 });
    expect(logs.at(-1)?.payoutSignatures[0]).toBe(landed?.signature);
    // The failure is the run's, not the payee's: that payout is paid.
    expect(events.at(-1)).toMatchObject({ status: "failed", errorCode: "outcome_unknown" });
    expect(events.at(-1)?.payeeIndex).toBeUndefined();

    sdk.calls.length = 0;
    const second = await runPrivatePayout(demoPlan(), {
      sdk,
      wallet,
      emit: () => {},
      resume: logs.at(-1) as RunLog,
    });
    expect(sdk.calls).toEqual(["recover", `swap:${PAYEE_B}:20000000:179340`, "scan"]);
    expect(second.proof.payouts[0]?.signature).toBe(landed?.signature);
  });

  it("records a deposit that landed although its reply was lost, and says to resume", async () => {
    const { sdk, wallet, events, logs, deps } = harness({
      sdk: {
        failures: [
          {
            at: "shield",
            landed: true,
            error: (receipt: { signature: string }) => settlement("landed", receipt.signature),
          },
        ],
      },
    });
    await expect(runPrivatePayout(demoPlan(), deps)).rejects.toMatchObject({
      code: "outcome_unknown",
    });
    expect(logs.at(-1)?.shieldSignature).toBeDefined();
    expect(logs.at(-1)?.shieldUncertain).toBeUndefined();
    expect(events.at(-1)?.message).toContain("Resume checks the chain");

    sdk.calls.length = 0;
    const outcome = await runPrivatePayout(demoPlan(), {
      sdk,
      wallet,
      emit: () => {},
      resume: logs.at(-1) as RunLog,
    });
    expect(sdk.calls).not.toContain("shield:40000000");
    expect(outcome.proof.shield.signature).toBe(logs.at(-1)?.shieldSignature);
  });

  it("does not record a signature the SDK could not give, and treats a landed spend as unknown", async () => {
    const { logs, deps } = harness({
      sdk: {
        failures: [{ at: "withdraw", recipient: PAYEE_A, error: settlement("landed", null) }],
      },
    });
    await expect(runPrivatePayout(demoPlan(), deps)).rejects.toMatchObject({
      code: "outcome_unknown",
    });
    expect(Object.keys(logs.at(-1)?.payoutSignatures ?? {})).toEqual([]);
  });

  it("lets a spend the chain says did not land fail like any other, safe to try again", async () => {
    const { deps } = harness({
      sdk: {
        failures: [{ at: "withdraw", recipient: PAYEE_A, error: settlement("not-landed", null) }],
      },
    });
    await expect(runPrivatePayout(demoPlan(), deps)).rejects.toMatchObject({ code: "unknown" });
  });

  it("reads the SDK's own words for a swap that timed out as unknown, not as a closed prompt", async () => {
    const { deps } = harness({
      sdk: {
        failures: [
          {
            at: "swap",
            recipient: PAYEE_B,
            error: new Error("Swap execution cancelled: refunded after timeout"),
          },
        ],
      },
    });
    await expect(runPrivatePayout(demoPlan(), deps)).rejects.toMatchObject({
      code: "outcome_unknown",
    });
  });
});

describe("a deposit that may have landed", () => {
  it("marks it when the wallet is lighter by the deposit, and blocks a second one", async () => {
    const { sdk, wallet, events, logs, deps } = harness({
      sdk: { failures: [{ at: "shield", landed: true, error: new Error("socket hang up") }] },
    });
    await expect(runPrivatePayout(demoPlan(), deps)).rejects.toMatchObject({
      code: "outcome_unknown",
    });
    expect(logs.at(-1)).toEqual({ shieldUncertain: true, payoutSignatures: {} });
    expect(events.at(-1)?.message).toContain("Use Recover");

    // Asking again must not shield a second time beside the first.
    sdk.calls.length = 0;
    const promptsBefore = wallet.prompts();
    await expect(
      runPrivatePayout(demoPlan(), {
        sdk,
        wallet,
        emit: () => {},
        resume: logs.at(-1) as RunLog,
      }),
    ).rejects.toMatchObject({ code: "outcome_unknown" });
    expect(sdk.calls).toEqual([]);
    expect(wallet.prompts()).toBe(promptsBefore);
  });

  it("leaves it alone when the deposit never left the wallet", async () => {
    const { logs, deps } = harness({
      sdk: { failures: [{ at: "shield", error: new Error("proof failed") }] },
    });
    await expect(runPrivatePayout(demoPlan(), deps)).rejects.toMatchObject({ code: "unknown" });
    expect(logs).toEqual([]);
  });

  it("does not suspect a deposit when the wallet itself said no", async () => {
    const { logs, deps } = harness({
      sdk: {
        failures: [
          {
            at: "shield",
            landed: true,
            error: { code: 4001, message: "User rejected the request." },
          },
        ],
      },
    });
    await expect(runPrivatePayout(demoPlan(), deps)).rejects.toMatchObject({
      code: "wallet_rejected",
    });
    expect(logs).toEqual([]);
  });

  it("treats a deposit with no signature to cite as possibly landed", async () => {
    const base = createFakeSdk();
    const sdk: SdkPort = {
      ...base,
      async openSession(seed) {
        const session = await base.openSession(seed);
        return {
          ...session,
          shield: async (amount) => ({ ...(await session.shield(amount)), signature: "nope" }),
        };
      },
    };
    const { logs, deps } = harness({ deps: { sdk } });
    await expect(runPrivatePayout(demoPlan(), deps)).rejects.toMatchObject({
      code: "outcome_unknown",
    });
    expect(logs.at(-1)).toEqual({ shieldUncertain: true, payoutSignatures: {} });
  });

  it("will not put a payout in the proof without a signature to cite, and keeps the ones it has", async () => {
    const base = createFakeSdk();
    const sdk: SdkPort = {
      ...base,
      async openSession(seed) {
        const session = await base.openSession(seed);
        return {
          ...session,
          withdrawSol: async (args) => ({
            ...(await session.withdrawSol(args)),
            signature: "nope",
          }),
        };
      },
    };
    const { events, logs, deps } = harness({ deps: { sdk } });
    await expect(runPrivatePayout(demoPlan(), deps)).rejects.toMatchObject({
      code: "outcome_unknown",
    });
    expect(logs.at(-1)?.shieldSignature).toBeDefined();
    expect(Object.keys(logs.at(-1)?.payoutSignatures ?? {})).toEqual([]);
    expect(events.at(-1)).toMatchObject({ step: "payout", payeeIndex: 0, status: "failed" });
  });
});

describe("the commitment of the privacy text's hash", () => {
  const commitment = { memo: COMMITMENT_MEMO };
  const withCommitment = (extra: Parameters<typeof harness>[0] = {}) =>
    harness({ ...extra, deps: { commitment, ...extra.deps } });

  it("is written in a transaction of its own right after the deposit, before any payout", async () => {
    const { sdk, events, logs, deps } = withCommitment();
    const outcome = await runPrivatePayout(demoPlan(), deps);

    expect(sdk.calls).toEqual([
      "shield:40000000",
      `commit:${COMMITMENT_MEMO}`,
      `withdraw:${PAYEE_A}:20000000`,
      `swap:${PAYEE_B}:20000000:179340`,
      "scan",
    ]);
    expect(sdk.commitments).toEqual([COMMITMENT_MEMO]);
    expect(shape(events).slice(4, 9)).toEqual([
      "shield:started",
      "shield:done",
      "commit:started",
      "commit:done",
      "payout:started",
    ]);
    // The same signature in the timeline, the log and the proof.
    const written = events.find((e) => e.step === "commit" && e.status === "done");
    expect(written?.signature).toBeDefined();
    expect(logs.find((l) => l.commitSignature)?.commitSignature).toBe(written?.signature);
    expect(outcome.log.commitSignature).toBe(written?.signature);
    expect(outcome.proof.commitment).toEqual({
      signature: written?.signature,
      memo: COMMITMENT_MEMO,
    });
    expect(toLog(events)).toEqual(outcome.log);
  });

  it("is not written unless the caller asks for it", async () => {
    const { sdk, events, deps } = harness();
    const outcome = await runPrivatePayout(demoPlan(), deps);
    expect(sdk.commitments).toEqual([]);
    expect(events.some((e) => e.step === "commit")).toBe(false);
    expect(outcome.proof.commitment).toBeUndefined();
    expect(outcome.log.commitSignature).toBeUndefined();
  });

  it("never stops the payouts: a hash that could not be written is said so and the run goes on", async () => {
    const { sdk, events, deps } = withCommitment({
      sdk: { failures: [{ at: "commit", error: new Error("the RPC dropped it") }] },
    });
    const outcome = await runPrivatePayout(demoPlan(), deps);

    const failed = events.find((e) => e.step === "commit" && e.status === "failed");
    expect(failed).toMatchObject({
      errorCode: "unknown",
      message: "The hash of the privacy text was not recorded; the payouts go on.",
    });
    expect(outcome.proof.payouts).toHaveLength(2);
    expect(sdk.calls.at(-1)).toBe("scan");
    // Nothing is claimed that did not happen.
    expect(outcome.proof.commitment).toBeUndefined();
    expect(outcome.log.commitSignature).toBeUndefined();
  });

  it("reads a closed wallet prompt as a prompt that was closed, and goes on", async () => {
    const { events, deps } = withCommitment({
      sdk: {
        failures: [{ at: "commit", error: { code: 4001, message: "User rejected the request." } }],
      },
    });
    await expect(runPrivatePayout(demoPlan(), deps)).resolves.toBeDefined();
    expect(events.find((e) => e.step === "commit" && e.status === "failed")?.errorCode).toBe(
      "wallet_rejected",
    );
  });

  it("does not take a receipt with no signature to cite for a commitment", async () => {
    const base = createFakeSdk();
    const sdk: SdkPort = {
      ...base,
      async openSession(seed) {
        const session = await base.openSession(seed);
        return { ...session, recordCommitment: async () => ({ signature: "nope" }) };
      },
    };
    const { events, logs, deps } = withCommitment({ deps: { sdk } });
    const outcome = await runPrivatePayout(demoPlan(), deps);
    expect(events.find((e) => e.step === "commit")?.status).toBe("started");
    expect(events.find((e) => e.step === "commit" && e.status === "failed")).toBeDefined();
    expect(logs.every((log) => log.commitSignature === undefined)).toBe(true);
    expect(outcome.proof.commitment).toBeUndefined();
  });

  it("is not written twice when a run is resumed", async () => {
    const sdk = createFakeSdk({
      failures: [{ at: "swap", recipient: PAYEE_B, error: new Error("relay hiccup") }],
    });
    const wallet = createFakeWallet({ address: FUNDER });
    const firstEvents: RunEvent[] = [];
    await expect(
      runPrivatePayout(demoPlan(), { sdk, wallet, emit: (e) => firstEvents.push(e), commitment }),
    ).rejects.toBeInstanceOf(RunError);
    const log = toLog(firstEvents);
    expect(log.commitSignature).toBeDefined();

    const secondEvents: RunEvent[] = [];
    const outcome = await runPrivatePayout(demoPlan(), {
      sdk,
      wallet,
      emit: (e) => secondEvents.push(e),
      resume: log,
      commitment,
    });

    expect(sdk.commitments).toEqual([COMMITMENT_MEMO]); // still the one
    expect(secondEvents.find((e) => e.step === "commit")).toMatchObject({
      status: "skipped",
      signature: log.commitSignature,
    });
    expect(outcome.proof.commitment?.signature).toBe(log.commitSignature);
  });

  it("is written by a resumed run that never got to it", async () => {
    const sdk = createFakeSdk({
      failures: [{ at: "swap", recipient: PAYEE_B, error: new Error("relay hiccup") }],
    });
    const wallet = createFakeWallet({ address: FUNDER });
    const firstEvents: RunEvent[] = [];
    await expect(
      runPrivatePayout(demoPlan(), { sdk, wallet, emit: (e) => firstEvents.push(e) }), // no commitment
    ).rejects.toBeInstanceOf(RunError);

    sdk.calls.length = 0;
    const outcome = await runPrivatePayout(demoPlan(), {
      sdk,
      wallet,
      emit: () => {},
      resume: toLog(firstEvents),
      commitment,
    });
    expect(sdk.calls).toEqual([
      "recover",
      `commit:${COMMITMENT_MEMO}`,
      `swap:${PAYEE_B}:20000000:179340`,
      "scan",
    ]);
    expect(outcome.proof.commitment?.memo).toBe(COMMITMENT_MEMO);
  });

  it("is not sent when the run is stopped right after the deposit", async () => {
    const controller = new AbortController();
    const sdk = createFakeSdk();
    const wallet = createFakeWallet({ address: FUNDER });
    const events: RunEvent[] = [];
    await expect(
      runPrivatePayout(demoPlan(), {
        sdk,
        wallet,
        signal: controller.signal,
        commitment,
        emit: (event) => {
          events.push(event);
          if (event.step === "shield" && event.status === "done") controller.abort();
        },
      }),
    ).rejects.toMatchObject({ code: "aborted" });
    expect(sdk.calls).toEqual(["shield:40000000"]);
    expect(events.at(-1)).toMatchObject({ step: "commit", status: "failed", errorCode: "aborted" });
    expect(events.at(-1)?.message).toContain("Funds are in the Cloak pool");
  });

  it("keeps every secret out of what it emits, like the rest of the run", async () => {
    const { sdk, wallet, events, deps } = withCommitment();
    const outcome = await runPrivatePayout(demoPlan(), deps);
    const haystack = [
      JSON.stringify(events),
      JSON.stringify(outcome.proof),
      outcome.csv,
      JSON.stringify(outcome.log),
      logged.join("\n"),
    ].join("\n");
    const secrets = [
      ...sdk.secrets(),
      ...wallet.signatures.flatMap((sig) => [
        Buffer.from(sig).toString("hex"),
        Buffer.from(sig).toString("base64"),
      ]),
    ];
    expect(secrets.length).toBeGreaterThanOrEqual(8);
    for (const secret of secrets) expect(haystack, secret.slice(0, 12)).not.toContain(secret);
  });
});
