import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { USDC_MINTS } from "@/lib/solana-pay";

// The chain, as the check sees it: signatures by reference, then each transaction.
const chain = vi.hoisted(() => ({
  signatures: [] as { signature: string; err: unknown }[],
  txs: new Map<string, unknown>(),
}));

vi.mock("@/lib/server/solana", () => ({
  rpcFor: () => ({
    getSignaturesForAddress: () => ({ send: async () => chain.signatures }),
    getTransaction: (sig: string) => ({ send: async () => chain.txs.get(sig) ?? null }),
  }),
}));

const { jsonLedger } = await import("./ledger");
const { checkDepositIntent, createDepositIntent } = await import("./rails");

const LOCAL = { kind: "local" } as const;
const RECIPIENT = "5LwWtPdEvVUSbYCTv5zvhP9gkt3nKANLGkvD2xa6jvvD";
const MINT = USDC_MINTS.devnet;
const CONFIG = { recipient: RECIPIENT, cluster: "devnet" as const, mint: MINT, rpcUrl: null };
// A well-formed 64-byte signature; the mock never looks it up on a real chain.
const SIG =
  "99eUso3aSbE9tqGSTXzo3TLfKb9RkMTURrHKQ1K7Zh3BbeqPevr5E1iCbpTjqHuTFLtfxTTD5ekfVuZFzQyEQf8";

function paid(amount: string, err: unknown = null) {
  return {
    meta: {
      err,
      preTokenBalances: [],
      postTokenBalances: [
        { accountIndex: 2, mint: MINT, owner: RECIPIENT, uiTokenAmount: { amount } },
      ],
    },
  };
}

describe("checkDepositIntent", () => {
  let home: string;
  const saved = process.env.AGENT_RAILS_HOME;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "deposit-"));
    process.env.AGENT_RAILS_HOME = home;
    chain.signatures = [];
    chain.txs.clear();
  });
  afterEach(() => {
    process.env.AGENT_RAILS_HOME = saved;
    rmSync(home, { recursive: true, force: true });
  });

  it("stays pending and credits nothing until a transfer is found", async () => {
    const intent = await createDepositIntent(LOCAL, CONFIG, 10_000_000);
    const checked = await checkDepositIntent(LOCAL, CONFIG, intent.id);
    expect(checked?.status).toBe("pending");
    expect(await jsonLedger.balance(LOCAL)).toBe(0);
  });

  it("credits a finalized transfer once, however often it is checked", async () => {
    const intent = await createDepositIntent(LOCAL, CONFIG, 10_000_000);
    chain.signatures = [{ signature: SIG, err: null }];
    chain.txs.set(SIG, paid("10000000"));

    const first = await checkDepositIntent(LOCAL, CONFIG, intent.id);
    await checkDepositIntent(LOCAL, CONFIG, intent.id);
    await checkDepositIntent(LOCAL, CONFIG, intent.id);

    expect(first).toMatchObject({
      status: "confirmed",
      creditedMicros: 10_000_000,
      signature: SIG,
    });
    expect(await jsonLedger.balance(LOCAL)).toBe(10_000_000);
  });

  it("does not let one transaction credit a second intent", async () => {
    const a = await createDepositIntent(LOCAL, CONFIG, 10_000_000);
    const b = await createDepositIntent(LOCAL, CONFIG, 10_000_000);
    chain.signatures = [{ signature: SIG, err: null }];
    chain.txs.set(SIG, paid("10000000"));

    await checkDepositIntent(LOCAL, CONFIG, a.id);
    await checkDepositIntent(LOCAL, CONFIG, b.id);
    expect(await jsonLedger.balance(LOCAL)).toBe(10_000_000);
  });

  it("ignores a failed transaction", async () => {
    const intent = await createDepositIntent(LOCAL, CONFIG, 10_000_000);
    chain.signatures = [{ signature: SIG, err: { InstructionError: [0, "Custom"] } }];
    chain.txs.set(SIG, paid("10000000", { InstructionError: [0, "Custom"] }));

    const checked = await checkDepositIntent(LOCAL, CONFIG, intent.id);
    expect(checked?.status).toBe("pending");
    expect(await jsonLedger.balance(LOCAL)).toBe(0);
  });

  it("returns null for an intent that does not exist", async () => {
    expect(
      await checkDepositIntent(LOCAL, CONFIG, "00000000-0000-0000-0000-000000000000"),
    ).toBeNull();
  });
});
