import { proofPackSchema } from "@agent-rails/contract/template-run";
import { afterEach, describe, expect, it, vi } from "vitest";
import { COMMITMENT_MEMO } from "./commitment.js";
import {
  parseSmokeArgs,
  parseStoredLog,
  planHash,
  runSmoke,
  type SmokeArgs,
  type SmokeIo,
  UsageError,
} from "./smoke.js";
import { addr, demoPlan } from "./test-support.js";
import { createFakeSdk, createFakeWallet, type FakeSdkOptions } from "./testing.js";

const FUNDER = addr(900);
const SOL_PAYEE = addr(1);
const ZEC_PAYEE = addr(2);

function argsFor(overrides: Partial<SmokeArgs> = {}): SmokeArgs {
  return {
    keypair: "key.json",
    rpc: "https://rpc.example",
    payeeSol: SOL_PAYEE,
    amountSol: "0.02",
    payeeZec: ZEC_PAYEE,
    amountZec: "0.02",
    log: "log.json",
    confirmMainnet: false,
    recover: false,
    noCommit: false,
    help: false,
    ...overrides,
  };
}

function ioFor(options: { sdk?: FakeSdkOptions; files?: Record<string, string> } = {}) {
  const sdk = createFakeSdk(options.sdk);
  const wallet = createFakeWallet({ address: FUNDER });
  const files = new Map(Object.entries(options.files ?? {}));
  const writes: { path: string; text: string }[] = [];
  const lines: string[] = [];
  const secretKey = new Uint8Array(64).fill(7);
  const io: SmokeIo = {
    out: (line) => lines.push(line),
    now: () => new Date("2026-10-04T15:00:00.000Z"),
    readKeypair: () => secretKey,
    createWallet: async () => wallet,
    createSdk: () => sdk,
    quote: async (payouts) =>
      new Map(payouts.filter((p) => p.deliver === "ZEC").map((p) => [p.index, 183_000n])),
    exists: (path) => files.has(path),
    readText: (path) => files.get(path) ?? "",
    writeText: (path, text) => {
      writes.push({ path, text });
      files.set(path, text);
    },
    remove: (path) => void files.delete(path),
  };
  return { io, sdk, wallet, files, writes, lines, secretKey, text: () => lines.join("\n") };
}

describe("parseSmokeArgs", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("reads a full command line", () => {
    vi.stubEnv("CLOAK_RPC_URL", "");
    const args = parseSmokeArgs([
      "--keypair",
      "k.json",
      "--payee-sol",
      SOL_PAYEE,
      "--amount-sol",
      "0.03",
      "--payee-zec",
      ZEC_PAYEE,
      "--confirm-mainnet",
      "--out",
      "p.json",
    ]);
    expect(args).toMatchObject({
      keypair: "k.json",
      payeeSol: SOL_PAYEE,
      amountSol: "0.03",
      payeeZec: ZEC_PAYEE,
      amountZec: "0.02",
      confirmMainnet: true,
      out: "p.json",
      recover: false,
      noCommit: false,
      rpc: "https://solana-rpc.publicnode.com",
      log: "cloak-smoke-log.json",
    });
  });

  it("commits the privacy text's hash unless told not to", () => {
    expect(parseSmokeArgs(["--keypair", "k", "--payee-sol", SOL_PAYEE]).noCommit).toBe(false);
    expect(
      parseSmokeArgs(["--keypair", "k", "--payee-sol", SOL_PAYEE, "--no-commit"]).noCommit,
    ).toBe(true);
  });

  it("is a dry run unless told otherwise", () => {
    expect(parseSmokeArgs(["--keypair", "k", "--payee-sol", SOL_PAYEE]).confirmMainnet).toBe(false);
  });

  it("insists on a keypair and at least one payee, except to recover", () => {
    expect(() => parseSmokeArgs(["--payee-sol", SOL_PAYEE])).toThrow(UsageError);
    expect(() => parseSmokeArgs(["--keypair", "k"])).toThrow(/at least one payee/);
    expect(parseSmokeArgs(["--keypair", "k", "--recover"]).recover).toBe(true);
  });

  it("rejects flags it does not know instead of ignoring them", () => {
    expect(() => parseSmokeArgs(["--keypair", "k", "--payee-sol", SOL_PAYEE, "--yolo"])).toThrow(
      UsageError,
    );
    expect(() => parseSmokeArgs(["--keypair", "k", "stray"])).toThrow(UsageError);
  });

  it("answers --help without needing anything else", () => {
    expect(parseSmokeArgs(["--help"]).help).toBe(true);
  });
});

describe("a dry run", () => {
  it("prints the plan and the message the wallet would sign, and sends nothing", async () => {
    const { io, sdk, wallet, files, text } = ioFor();
    const code = await runSmoke(argsFor(), io);
    expect(code).toBe(0);
    expect(sdk.calls).toEqual([]);
    expect(wallet.prompts()).toBe(0);
    expect(files.size).toBe(0);
    const out = text();
    expect(out).toContain("on Solana MAINNET (real funds)");
    expect(out).toContain(`Funder   ${FUNDER}`);
    expect(out).toContain(`-> ${SOL_PAYEE}`);
    expect(out).toContain("gross 0.02  fee 0.00506  net 0.01494");
    expect(out).toContain("Shield   0.04 SOL");
    expect(out).toContain("DRY RUN: nothing was signed or sent.");
    expect(out).toContain("does NOT authorize a transaction");
    expect(out).toContain("--confirm-mainnet");
  });

  it("exits 3 when the wallet cannot cover the run, so a script notices", async () => {
    const { io, text } = ioFor({ sdk: { balanceLamports: 1_000_000n } });
    expect(await runSmoke(argsFor(), io)).toBe(3);
    expect(text()).toContain("a real run would stop in preflight");
  });

  it("exits 3 when a dependency is down", async () => {
    const { io, text } = ioFor({ sdk: { health: { relay: false } } });
    expect(await runSmoke(argsFor(), io)).toBe(3);
    expect(text()).toContain("relay DOWN");
  });
});

describe("a real run", () => {
  it("pays everyone, writes a valid proof pack, a CSV and a progress log", async () => {
    const { io, sdk, files, writes, text } = ioFor();
    const code = await runSmoke(argsFor({ confirmMainnet: true, out: "proof.json" }), io);
    expect(code).toBe(0);
    // The commitment is its own transaction, right after the deposit and before any payout.
    expect(sdk.calls.map((c) => c.split(":")[0])).toEqual([
      "shield",
      "commit",
      "withdraw",
      "swap",
      "scan",
    ]);
    expect(sdk.commitments).toEqual([COMMITMENT_MEMO]);

    const proof = proofPackSchema.parse(JSON.parse(files.get("proof.json") ?? "null"));
    expect(proof.payouts).toHaveLength(2);
    expect(proof.commitment?.memo).toBe(COMMITMENT_MEMO);
    expect(files.get("proof.json.csv")).toContain("shield");
    // The log was written as the run went, and is gone once the payout is finished.
    const last = writes.filter((w) => w.path === "log.json").at(-1);
    const log = JSON.parse(last?.text ?? "{}");
    expect(log.shieldSignature).toBe(proof.shield.signature);
    expect(log.commitSignature).toBe(proof.commitment?.signature);
    expect(Object.keys(log.payoutSignatures)).toEqual(["0", "1"]);
    expect(log.fingerprint).toMatch(/^[0-9a-f]{16}$/);
    expect(files.has("log.json")).toBe(false);
    expect(text()).toContain("explorer.solana.com/tx/");
    expect(text()).toContain("Done. Proof pack: proof.json");
  });

  it("prints no secret, and zeroes the keypair it was given", async () => {
    const { io, sdk, wallet, files, text, secretKey } = ioFor();
    await runSmoke(argsFor({ confirmMainnet: true, out: "proof.json" }), io);
    const haystack = [text(), ...files.values()].join("\n");
    for (const secret of [
      ...sdk.secrets(),
      ...wallet.signatures.map((s) => Buffer.from(s).toString("hex")),
    ]) {
      expect(haystack).not.toContain(secret);
    }
    expect(secretKey.every((b) => b === 0)).toBe(true);
  });

  it("stops at a payout that fails, says how to resume, and exits 1", async () => {
    const { io, text, files } = ioFor({
      sdk: { failures: [{ at: "swap", recipient: ZEC_PAYEE, error: new Error("boom") }] },
    });
    const code = await runSmoke(argsFor({ confirmMainnet: true }), io);
    expect(code).toBe(1);
    expect(text()).toContain("Stopped: unknown.");
    expect(text()).toContain("run the same command again to resume");
    expect(text()).toContain("--recover --confirm-mainnet");
    const log = JSON.parse(files.get("log.json") ?? "{}");
    expect(log.shieldSignature).toBeDefined();
    expect(Object.keys(log.payoutSignatures)).toEqual(["0"]);
  });

  it("resumes from its log without shielding or paying twice", async () => {
    const sdk: FakeSdkOptions = {
      failures: [{ at: "swap", recipient: ZEC_PAYEE, error: new Error("boom") }],
    };
    const first = ioFor({ sdk });
    expect(await runSmoke(argsFor({ confirmMainnet: true }), first.io)).toBe(1);

    // Same fake chain (same pool), same log file, a fresh process.
    const second = ioFor({ files: Object.fromEntries(first.files) });
    second.sdk.calls.length = 0;
    // The second fake has an empty pool; fund it as the first one left it.
    const reopen = await second.sdk.openSession(
      await (await import("./keys.js")).obtainMasterSeed(second.wallet, {
        verifyDeterminism: false,
      }),
    );
    await reopen.shield(20_000_000n);
    reopen.dispose();
    second.sdk.calls.length = 0;

    const code = await runSmoke(argsFor({ confirmMainnet: true, out: "proof.json" }), second.io);
    expect(code).toBe(0);
    expect(second.text()).toContain("Resuming from the log");
    expect(second.sdk.calls.map((c) => c.split(":")[0])).toEqual(["recover", "swap", "scan"]);
  });

  it("makes the same command a new payout once one has finished, not a resume of the old one", async () => {
    const first = ioFor();
    expect(await runSmoke(argsFor({ confirmMainnet: true, out: "a.json" }), first.io)).toBe(0);
    const second = ioFor({ files: Object.fromEntries(first.files) });
    expect(await runSmoke(argsFor({ confirmMainnet: true, out: "b.json" }), second.io)).toBe(0);
    expect(second.text()).not.toContain("Resuming from the log");
    expect(second.sdk.calls.map((c) => c.split(":")[0])).toEqual([
      "shield",
      "commit",
      "withdraw",
      "swap",
      "scan",
    ]);
  });

  it("does not write the commitment when asked not to, and the pack says nothing of one", async () => {
    const { io, sdk, files, text } = ioFor();
    expect(
      await runSmoke(argsFor({ confirmMainnet: true, out: "p.json", noCommit: true }), io),
    ).toBe(0);
    expect(sdk.calls.map((c) => c.split(":")[0])).toEqual(["shield", "withdraw", "swap", "scan"]);
    expect(sdk.commitments).toEqual([]);
    expect(
      proofPackSchema.parse(JSON.parse(files.get("p.json") ?? "null")).commitment,
    ).toBeUndefined();
    expect(text()).not.toContain("Memo transaction");
  });

  it("says in the dry run what the extra transaction will write, before anything is signed", async () => {
    const { io, sdk, text } = ioFor();
    expect(await runSmoke(argsFor(), io)).toBe(0);
    expect(text()).toContain(
      `separate Memo transaction right after the deposit writes: ${COMMITMENT_MEMO}`,
    );
    expect(sdk.calls).toEqual([]);
  });

  it("goes on paying when the commitment cannot be written, and says so", async () => {
    const { io, sdk, files, text } = ioFor({
      sdk: { failures: [{ at: "commit", error: new Error("rpc dropped it") }] },
    });
    expect(await runSmoke(argsFor({ confirmMainnet: true, out: "p.json" }), io)).toBe(0);
    expect(sdk.calls.map((c) => c.split(":")[0])).toEqual([
      "shield",
      "commit",
      "withdraw",
      "swap",
      "scan",
    ]);
    expect(text()).toContain("The hash of the privacy text was not recorded; the payouts go on.");
    expect(
      proofPackSchema.parse(JSON.parse(files.get("p.json") ?? "null")).commitment,
    ).toBeUndefined();
  });

  it("keeps the log of a deposit it could not confirm, and will not shield a second one", async () => {
    const first = ioFor({
      sdk: { failures: [{ at: "shield", landed: true, error: new Error("socket hang up") }] },
    });
    expect(await runSmoke(argsFor({ confirmMainnet: true }), first.io)).toBe(1);
    const stored = parseStoredLog(first.files.get("log.json") ?? "");
    expect(stored.shieldUncertain).toBe(true);
    expect(stored.shieldSignature).toBeUndefined();

    const second = ioFor({ files: Object.fromEntries(first.files) });
    expect(await runSmoke(argsFor({ confirmMainnet: true }), second.io)).toBe(1);
    expect(second.sdk.calls).toEqual([]);
    expect(second.text()).toContain("Use Recover");
  });

  it("refuses a log written for different payouts, so nothing is skipped by mistake", async () => {
    const stale = JSON.stringify({
      planHash: "0000000000000000",
      shieldSignature: "5".repeat(87),
      payoutSignatures: { 0: "5".repeat(87) },
    });
    const { io, sdk, text } = ioFor({ files: { "log.json": stale } });
    expect(await runSmoke(argsFor({ confirmMainnet: true }), io)).toBe(2);
    expect(text()).toContain("written for different payouts");
    expect(sdk.calls).toEqual([]);
  });

  it("refuses a payout to the funder", async () => {
    const { io, sdk, text } = ioFor();
    expect(await runSmoke(argsFor({ payeeSol: FUNDER, confirmMainnet: true }), io)).toBe(2);
    expect(text()).toContain("Refused");
    expect(sdk.calls).toEqual([]);
  });

  it("refuses an amount outside the template's caps before touching the network", async () => {
    const { io, sdk, text } = ioFor();
    expect(await runSmoke(argsFor({ amountSol: "0.5", confirmMainnet: true }), io)).toBe(2);
    expect(text()).toContain("Invalid payout");
    expect(sdk.calls).toEqual([]);
  });
});

describe("--recover", () => {
  it("only describes itself without --confirm-mainnet", async () => {
    const { io, sdk, text } = ioFor();
    expect(await runSmoke(argsFor({ recover: true }), io)).toBe(0);
    expect(text()).toContain("DRY RUN");
    expect(sdk.calls).toEqual([]);
  });

  it("sends what is spendable back to the keypair", async () => {
    const { io, sdk, text, wallet } = ioFor();
    const { obtainMasterSeed } = await import("./keys.js");
    const session = await sdk.openSession(
      await obtainMasterSeed(wallet, { verifyDeterminism: false }),
    );
    await session.shield(40_000_000n);
    session.dispose();
    sdk.calls.length = 0;

    expect(await runSmoke(argsFor({ recover: true, confirmMainnet: true }), io)).toBe(0);
    expect(sdk.calls).toEqual(["recover", `sweep:${FUNDER}`]);
    expect(text()).toContain("Recovered 0.04 SOL.");
  });

  const logNaming = (deposit: boolean) =>
    JSON.stringify({
      planHash: "0123456789abcdef",
      ...(deposit ? { shieldSignature: "5".repeat(87) } : {}),
      payoutSignatures: {},
    });

  it("is a stop, not a result, when the log names a deposit and the pool shows nothing", async () => {
    const { io, files, text } = ioFor({ files: { "log.json": logNaming(true) } });
    expect(await runSmoke(argsFor({ recover: true, confirmMainnet: true }), io)).toBe(1);
    expect(text()).toContain("Stopped: outcome_unknown");
    expect(text()).toContain("full-history RPC");
    expect(files.has("log.json")).toBe(true); // nothing is confirmed back, so nothing is forgotten
  });

  it("reports an empty pool as such when nothing says there should be funds", async () => {
    const { io, files, text } = ioFor({ files: { "log.json": logNaming(false) } });
    expect(await runSmoke(argsFor({ recover: true, confirmMainnet: true }), io)).toBe(0);
    expect(text()).toContain("Nothing was found to recover.");
    expect(files.has("log.json")).toBe(true);
  });

  it("forgets the log once the funds are back in the wallet", async () => {
    const { io, sdk, wallet, files } = ioFor({ files: { "log.json": logNaming(true) } });
    const { obtainMasterSeed } = await import("./keys.js");
    const session = await sdk.openSession(
      await obtainMasterSeed(wallet, { verifyDeterminism: false }),
    );
    await session.shield(20_000_000n);
    session.dispose();
    expect(await runSmoke(argsFor({ recover: true, confirmMainnet: true }), io)).toBe(0);
    expect(files.has("log.json")).toBe(false);
  });
});

describe("the progress log is input like any other", () => {
  const sig = "5".repeat(87);
  const good = { planHash: "0123456789abcdef", payoutSignatures: { 0: sig } };

  it("reads the commitment's signature too", () => {
    expect(parseStoredLog(JSON.stringify({ ...good, commitSignature: sig })).commitSignature).toBe(
      sig,
    );
  });

  it("reads what the tool wrote", () => {
    expect(
      parseStoredLog(
        JSON.stringify({ ...good, shieldSignature: sig, fingerprint: "a".repeat(16) }),
      ),
    ).toEqual({ ...good, shieldSignature: sig, fingerprint: "a".repeat(16) });
    expect(parseStoredLog(JSON.stringify({ ...good, shieldUncertain: true })).shieldUncertain).toBe(
      true,
    );
  });

  it.each([
    ["not JSON", "{nope"],
    ["an array", "[]"],
    ["a foreign field", JSON.stringify({ ...good, extra: 1 })],
    ["a short signature", JSON.stringify({ ...good, payoutSignatures: { 0: "short" } })],
    ["a payee index out of shape", JSON.stringify({ ...good, payoutSignatures: { "1x": sig } })],
    ["a signature list", JSON.stringify({ ...good, payoutSignatures: [sig] })],
    ["a bad plan hash", JSON.stringify({ ...good, planHash: "xyz" })],
    ["a bad fingerprint", JSON.stringify({ ...good, fingerprint: "nope" })],
    ["a flag that is not a boolean", JSON.stringify({ ...good, shieldUncertain: "yes" })],
    ["a commitment signature that is not one", JSON.stringify({ ...good, commitSignature: "x" })],
  ])("refuses %s", (_name, text) => {
    expect(() => parseStoredLog(text)).toThrow(UsageError);
  });

  it("stops the run before it touches the network when the log is not one the tool wrote", async () => {
    const { io, sdk, text } = ioFor({
      files: { "log.json": JSON.stringify({ ...good, payoutSignatures: { 0: "paid" } }) },
    });
    expect(await runSmoke(argsFor({ confirmMainnet: true }), io)).toBe(2);
    expect(text()).toContain("is not one this tool wrote");
    expect(sdk.calls).toEqual([]);
  });
});

describe("the RPC url", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("can come from the environment, so a key stays out of the shell's history", () => {
    vi.stubEnv("CLOAK_RPC_URL", "https://rpc.example/with-key");
    expect(parseSmokeArgs(["--keypair", "k", "--payee-sol", SOL_PAYEE]).rpc).toBe(
      "https://rpc.example/with-key",
    );
    // An explicit flag still wins.
    expect(
      parseSmokeArgs(["--keypair", "k", "--payee-sol", SOL_PAYEE, "--rpc", "https://other.example"])
        .rpc,
    ).toBe("https://other.example");
  });
});

describe("the log's plan hash", () => {
  it("changes with any payee, kind or amount, and not with the run id", () => {
    const base = demoPlan();
    expect(planHash(base)).toBe(planHash({ ...base, runId: "run_other" }));
    const changed = {
      ...base,
      payouts: base.payouts.map((p, i) =>
        i === 0 ? { ...p, grossLamports: p.grossLamports + 1n } : p,
      ),
    };
    expect(planHash(changed)).not.toBe(planHash(base));
    const swapped = {
      ...base,
      payouts: base.payouts.map((p, i) => (i === 0 ? { ...p, deliver: "ZEC" as const } : p)),
    };
    expect(planHash(swapped)).not.toBe(planHash(base));
  });
});

describe("--help", () => {
  it("prints the usage and exits 0", async () => {
    const { io, text } = ioFor();
    expect(await runSmoke(argsFor({ help: true }), io)).toBe(0);
    expect(text()).toContain("--confirm-mainnet");
  });
});
