import { buildRunPlan } from "@agent-rails/cloak";
import {
  CLOAK_PRIVATE_PAYOUT_TEMPLATE_ID,
  cloakPayoutProposalSchema,
  type RunEvent,
} from "@agent-rails/contract/template-run";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cloakRunConfig, DEFAULT_CLOAK_RPC_URL } from "./cloak-config";
import { withWalletRunLock } from "./cloak-lock";
import {
  clearRunLog,
  readFingerprint,
  readRunLog,
  runStorageKey,
  writeFingerprint,
  writeRunLog,
} from "./cloak-storage";
import { buildTimeline, fundsAreInPool } from "./cloak-timeline";

const BASE58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function addr(seed: number): string {
  const bytes = new Uint8Array(32);
  bytes[0] = 0x41 + (seed % 100);
  for (let i = 1; i < 32; i++) bytes[i] = (seed * 31 + i * 17) % 256;
  let n = 0n;
  for (const b of bytes) n = (n << 8n) | BigInt(b);
  let out = "";
  while (n > 0n) {
    out = BASE58[Number(n % 58n)] + out;
    n /= 58n;
  }
  return out;
}
const SIG = "5".repeat(87);
const proposal = cloakPayoutProposalSchema.parse({
  template: CLOAK_PRIVATE_PAYOUT_TEMPLATE_ID,
  payees: [
    { label: "A", address: addr(1), deliver: "SOL", amountSol: "0.02" },
    { label: "B", address: addr(2), deliver: "ZEC", amountSol: "0.02" },
  ],
});
const FUNDER = addr(900);

describe("cloakRunConfig", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("is off, empty and on the default RPC when nothing is set", () => {
    vi.stubEnv("NEXT_PUBLIC_CLOAK_MAINNET", "");
    vi.stubEnv("NEXT_PUBLIC_CLOAK_RPC_URL", "");
    vi.stubEnv("NEXT_PUBLIC_CLOAK_ALLOWED_WALLETS", "");
    vi.stubEnv("NEXT_PUBLIC_CLOAK_FAKE_SDK", "");
    expect(cloakRunConfig()).toEqual({
      mainnetEnabled: false,
      rpcUrl: DEFAULT_CLOAK_RPC_URL,
      allowedWallets: [],
      fakeSdk: false,
    });
  });

  it("turns mainnet on only for the exact value 1", () => {
    for (const value of ["true", "yes", "0", "on", " 1"]) {
      vi.stubEnv("NEXT_PUBLIC_CLOAK_MAINNET", value);
      expect(cloakRunConfig().mainnetEnabled, value).toBe(false);
    }
    vi.stubEnv("NEXT_PUBLIC_CLOAK_MAINNET", "1");
    expect(cloakRunConfig().mainnetEnabled).toBe(true);
  });

  it("reads the RPC and the allow list, dropping what is not an address", () => {
    vi.stubEnv("NEXT_PUBLIC_CLOAK_RPC_URL", " https://rpc.example/key ");
    vi.stubEnv("NEXT_PUBLIC_CLOAK_ALLOWED_WALLETS", `${FUNDER}, nonsense ,${addr(5)}`);
    const config = cloakRunConfig();
    expect(config.rpcUrl).toBe("https://rpc.example/key");
    expect(config.allowedWallets).toEqual([FUNDER, addr(5)]);
  });
});

describe("run storage", () => {
  const files = new Map<string, string>();
  beforeEach(() => {
    files.clear();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => files.get(key) ?? null,
      setItem: (key: string, value: string) => void files.set(key, value),
      removeItem: (key: string) => void files.delete(key),
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("keys a run by the wallet and the exact payouts", () => {
    const key = runStorageKey(FUNDER, proposal);
    expect(key).toBe(runStorageKey(FUNDER, proposal));
    expect(key).not.toBe(runStorageKey(addr(901), proposal));
    const other = cloakPayoutProposalSchema.parse({
      ...proposal,
      payees: [{ ...proposal.payees[0], amountSol: "0.03" }],
    });
    expect(key).not.toBe(runStorageKey(FUNDER, other));
  });

  it("finds the same log however the amounts were spelled and whatever the payees were called", () => {
    const respelled = cloakPayoutProposalSchema.parse({
      ...proposal,
      payees: proposal.payees.map((payee, i) => ({
        ...payee,
        label: `Renamed ${i}`,
        amountSol: "0.0200",
      })),
    });
    expect(runStorageKey(FUNDER, respelled)).toBe(runStorageKey(FUNDER, proposal));
  });

  it("does not leave a payee's address readable in the key", () => {
    const key = runStorageKey(FUNDER, proposal);
    for (const payee of proposal.payees) expect(key).not.toContain(payee.address.slice(0, 8));
    expect(key.startsWith(`agent-rails.cloak.run:${FUNDER}:`)).toBe(true);
  });

  it("round-trips a log of signatures and forgets it on request", () => {
    const key = runStorageKey(FUNDER, proposal);
    expect(readRunLog(key)).toBeNull();
    writeRunLog(key, { shieldSignature: SIG, payoutSignatures: { 0: SIG } });
    expect(readRunLog(key)).toEqual({ shieldSignature: SIG, payoutSignatures: { 0: SIG } });
    clearRunLog(key);
    expect(readRunLog(key)).toBeNull();
  });

  it("remembers the signature of the commitment, which is public like the others", () => {
    const key = runStorageKey(FUNDER, proposal);
    const log = { shieldSignature: SIG, commitSignature: SIG, payoutSignatures: {} };
    writeRunLog(key, log);
    expect(readRunLog(key)).toEqual(log);
    for (const bad of [
      JSON.stringify({ commitSignature: "short", payoutSignatures: {} }),
      JSON.stringify({ commitSignature: 5, payoutSignatures: {} }),
    ]) {
      files.set(key, bad);
      expect(readRunLog(key), bad).toBeNull();
    }
  });

  it("remembers a deposit that may have landed, with no signature to cite", () => {
    const key = runStorageKey(FUNDER, proposal);
    writeRunLog(key, { shieldUncertain: true, payoutSignatures: {} });
    expect(readRunLog(key)).toEqual({ shieldUncertain: true, payoutSignatures: {} });
  });

  it("stores nothing but signatures", () => {
    const key = runStorageKey(FUNDER, proposal);
    writeRunLog(key, { shieldSignature: SIG, payoutSignatures: { 0: SIG, 1: SIG } });
    const raw = JSON.parse(files.get(key) ?? "null");
    expect(Object.keys(raw).sort()).toEqual(["payoutSignatures", "shieldSignature"]);
  });

  it("ignores a log that was tampered with or is not one", () => {
    const key = runStorageKey(FUNDER, proposal);
    for (const bad of [
      "not json",
      "null",
      "[]",
      JSON.stringify({ payoutSignatures: { 0: "short" } }),
      JSON.stringify({ shieldSignature: "short", payoutSignatures: {} }),
      JSON.stringify({ payoutSignatures: { x: SIG } }),
      JSON.stringify({ payoutSignatures: [SIG] }),
      JSON.stringify({ shieldSignature: 5, payoutSignatures: {} }),
      JSON.stringify({ shieldUncertain: "yes", payoutSignatures: {} }),
    ]) {
      files.set(key, bad);
      expect(readRunLog(key), bad).toBeNull();
    }
  });

  it("keeps the key fingerprint per wallet and only accepts 16 hex characters", () => {
    expect(readFingerprint(FUNDER)).toBeUndefined();
    writeFingerprint(FUNDER, "0123456789abcdef");
    expect(readFingerprint(FUNDER)).toBe("0123456789abcdef");
    expect(readFingerprint(addr(901))).toBeUndefined();
    files.set(`agent-rails.cloak.fingerprint:${FUNDER}`, "NOT-HEX");
    expect(readFingerprint(FUNDER)).toBeUndefined();
  });

  it("keeps working when storage is missing or throws", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
      removeItem: () => {
        throw new Error("blocked");
      },
    });
    const key = runStorageKey(FUNDER, proposal);
    expect(() => writeRunLog(key, { payoutSignatures: {} })).not.toThrow();
    expect(readRunLog(key)).toBeNull();
    expect(() => clearRunLog(key)).not.toThrow();
    expect(() => writeFingerprint(FUNDER, "0123456789abcdef")).not.toThrow();
    expect(readFingerprint(FUNDER)).toBeUndefined();
    vi.stubGlobal("localStorage", undefined);
    expect(readRunLog(key)).toBeNull();
  });
});

describe("buildTimeline", () => {
  const plan = buildRunPlan(proposal, {
    runId: "run_x",
    funder: FUNDER,
    zecQuotes: new Map([[1, 100_000n]]),
  });
  const event = (e: Partial<RunEvent> & Pick<RunEvent, "step" | "status">): RunEvent => ({
    runId: "run_x",
    at: "2026-10-04T15:00:00.000Z",
    ...e,
  });

  it("lists every planned step as pending before anything happens", () => {
    const rows = buildTimeline(plan, []);
    expect(rows.map((r) => r.id)).toEqual([
      "preflight",
      "derive-keys",
      "shield",
      "payout:0",
      "payout:1",
      "report",
    ]);
    expect(rows.every((r) => r.status === "pending")).toBe(true);
  });

  it("moves rows with the events and keeps signatures", () => {
    const rows = buildTimeline(plan, [
      event({ step: "preflight", status: "started" }),
      event({ step: "preflight", status: "done" }),
      event({ step: "shield", status: "started" }),
      event({ step: "shield", status: "progress", message: "Proof 40%" }),
      event({ step: "shield", status: "done", signature: SIG }),
      event({ step: "payout", status: "started", payeeIndex: 0 }),
    ]);
    const by = Object.fromEntries(rows.map((r) => [r.id, r]));
    expect(by.preflight?.status).toBe("done");
    expect(by.shield).toMatchObject({ status: "done", signature: SIG });
    expect(by.shield?.message).toBeUndefined(); // a finished step drops its progress line
    expect(by["payout:0"]?.status).toBe("started");
    expect(by["payout:1"]?.status).toBe("pending");
  });

  it("shows a progress line on a step that has not announced itself yet", () => {
    const rows = buildTimeline(plan, [
      event({ step: "shield", status: "progress", message: "Building transaction..." }),
    ]);
    expect(rows.find((r) => r.id === "shield")).toMatchObject({
      status: "started",
      message: "Building transaction...",
    });
  });

  it("marks the payee that failed and keeps the reason", () => {
    const rows = buildTimeline(plan, [
      event({ step: "payout", status: "started", payeeIndex: 1 }),
      event({
        step: "payout",
        status: "failed",
        payeeIndex: 1,
        errorCode: "unknown",
        message: "The run failed.",
      }),
    ]);
    expect(rows.find((r) => r.id === "payout:1")).toMatchObject({
      status: "failed",
      message: "The run failed.",
    });
    expect(rows.find((r) => r.id === "payout:0")?.status).toBe("pending");
  });

  it("shows skipped steps with their original signature", () => {
    const rows = buildTimeline(plan, [
      event({ step: "payout", status: "skipped", payeeIndex: 0, signature: SIG }),
    ]);
    expect(rows.find((r) => r.id === "payout:0")).toMatchObject({
      status: "skipped",
      signature: SIG,
    });
  });

  it("adds a row for the commitment between the deposit and the payouts, once it has events", () => {
    expect(buildTimeline(plan, []).some((r) => r.step === "commit")).toBe(false);
    const rows = buildTimeline(plan, [
      event({ step: "commit", status: "started" }),
      event({ step: "commit", status: "done", signature: SIG }),
    ]);
    expect(rows.map((r) => r.id)).toEqual([
      "preflight",
      "derive-keys",
      "shield",
      "commit",
      "payout:0",
      "payout:1",
      "report",
    ]);
    expect(rows.find((r) => r.id === "commit")).toMatchObject({ status: "done", signature: SIG });
  });

  it("shows a commitment that could not be written without calling the run a failure", () => {
    const rows = buildTimeline(plan, [
      event({ step: "shield", status: "done", signature: SIG }),
      event({
        step: "commit",
        status: "failed",
        errorCode: "unknown",
        message: "The hash of the privacy text was not recorded; the payouts go on.",
      }),
      event({ step: "payout", status: "started", payeeIndex: 0 }),
    ]);
    const by = Object.fromEntries(rows.map((r) => [r.id, r]));
    expect(by.commit).toMatchObject({ status: "failed" });
    expect(by.commit?.message).toContain("the payouts go on");
    expect(by.shield?.status).toBe("done");
    expect(by["payout:0"]?.status).toBe("started");
  });

  it("adds a recovery row only when a recovery ran", () => {
    expect(buildTimeline(plan, []).some((r) => r.step === "recover")).toBe(false);
    const rows = buildTimeline(plan, [event({ step: "recover", status: "done", signature: SIG })]);
    expect(rows.at(-1)).toMatchObject({ step: "recover", status: "done", signature: SIG });
  });
});

describe("fundsAreInPool", () => {
  const base = { runId: "run_x", at: "2026-10-04T15:00:00.000Z" } as const;
  it("is true once a shield landed, or was found already landed", () => {
    expect(fundsAreInPool([])).toBe(false);
    expect(fundsAreInPool([{ ...base, step: "shield", status: "started" }])).toBe(false);
    expect(fundsAreInPool([{ ...base, step: "shield", status: "failed" }])).toBe(false);
    expect(fundsAreInPool([{ ...base, step: "shield", status: "done", signature: SIG }])).toBe(
      true,
    );
    expect(fundsAreInPool([{ ...base, step: "shield", status: "skipped", signature: SIG }])).toBe(
      true,
    );
  });

  it("is also true when the shield failed in a way that cannot say whether it left the wallet", () => {
    expect(
      fundsAreInPool([{ ...base, step: "shield", status: "failed", errorCode: "outcome_unknown" }]),
    ).toBe(true);
    // A refusal that moved nothing is not that.
    for (const errorCode of ["wallet_rejected", "unknown", "insufficient_balance"] as const) {
      expect(fundsAreInPool([{ ...base, step: "shield", status: "failed", errorCode }])).toBe(
        false,
      );
    }
    // Nor is an unknown outcome of some other step.
    expect(
      fundsAreInPool([{ ...base, step: "payout", status: "failed", errorCode: "outcome_unknown" }]),
    ).toBe(false);
  });
});

describe("withWalletRunLock", () => {
  afterEach(() => vi.unstubAllGlobals());

  /** A LockManager that grants a name to one holder at a time, as a browser's does across tabs. */
  function fakeLocks() {
    const taken = new Set<string>();
    return {
      taken,
      request: async (
        name: string,
        _options: { ifAvailable?: boolean },
        callback: (lock: object | null) => Promise<unknown>,
      ) => {
        if (taken.has(name)) return callback(null);
        taken.add(name);
        try {
          return await callback({ name });
        } finally {
          taken.delete(name);
        }
      },
    };
  }
  const deferred = () => {
    let release!: () => void;
    const promise = new Promise<void>((resolve) => {
      release = resolve;
    });
    return { promise, release };
  };

  it("runs the work, hands back its value and lets go afterwards", async () => {
    const locks = fakeLocks();
    vi.stubGlobal("navigator", { locks });
    await expect(withWalletRunLock(FUNDER, async () => 42)).resolves.toEqual({
      held: true,
      value: 42,
    });
    expect(locks.taken.size).toBe(0);
    await expect(withWalletRunLock(FUNDER, async () => 43)).resolves.toMatchObject({ held: true });
  });

  it("refuses a second run for the same wallet in this tab, without running it", async () => {
    vi.stubGlobal("navigator", { locks: fakeLocks() });
    const gate = deferred();
    const first = withWalletRunLock(FUNDER, () => gate.promise);
    const work = vi.fn(async () => "second");
    await expect(withWalletRunLock(FUNDER, work)).resolves.toEqual({ held: false });
    expect(work).not.toHaveBeenCalled();
    gate.release();
    await expect(first).resolves.toMatchObject({ held: true });
  });

  it("refuses a run another tab already holds the lock for", async () => {
    const locks = fakeLocks();
    locks.taken.add(`agent-rails.cloak.run:${FUNDER}`);
    vi.stubGlobal("navigator", { locks });
    const work = vi.fn(async () => "never");
    await expect(withWalletRunLock(FUNDER, work)).resolves.toEqual({ held: false });
    expect(work).not.toHaveBeenCalled();
    // Once that tab is done, this one can run: nothing is left held in this tab.
    locks.taken.clear();
    await expect(withWalletRunLock(FUNDER, async () => "now")).resolves.toMatchObject({
      held: true,
    });
  });

  it("does not make one wallet wait for another", async () => {
    vi.stubGlobal("navigator", { locks: fakeLocks() });
    const gate = deferred();
    const first = withWalletRunLock(FUNDER, () => gate.promise);
    await expect(withWalletRunLock(addr(901), async () => 1)).resolves.toMatchObject({
      held: true,
    });
    gate.release();
    await first;
  });

  it("lets go when the work throws", async () => {
    const locks = fakeLocks();
    vi.stubGlobal("navigator", { locks });
    await expect(
      withWalletRunLock(FUNDER, async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(locks.taken.size).toBe(0);
    await expect(withWalletRunLock(FUNDER, async () => 1)).resolves.toMatchObject({ held: true });
  });

  it("still keeps one run per wallet in a tab where the browser has no lock manager", async () => {
    vi.stubGlobal("navigator", {});
    const gate = deferred();
    const first = withWalletRunLock(FUNDER, () => gate.promise);
    await expect(withWalletRunLock(FUNDER, async () => 1)).resolves.toEqual({ held: false });
    gate.release();
    await first;
    await expect(withWalletRunLock(FUNDER, async () => 1)).resolves.toMatchObject({ held: true });
  });
});
