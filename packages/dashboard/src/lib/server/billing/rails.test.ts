import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { jsonLedger } from "./ledger";
import { listWithdrawals, requestWithdrawal, solanaPayConfig, validDestination } from "./rails";

const LOCAL = { kind: "local" } as const;
const WALLET = "5LwWtPdEvVUSbYCTv5zvhP9gkt3nKANLGkvD2xa6jvvD";

describe("solanaPayConfig", () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
  });

  it("is off without a recipient, and off with one that is not an address", () => {
    delete process.env.SOLANA_PAY_RECIPIENT;
    expect(solanaPayConfig()).toBeNull();
    process.env.SOLANA_PAY_RECIPIENT = "not-an-address";
    expect(solanaPayConfig()).toBeNull();
  });

  it("defaults to mainnet USDC and switches to devnet only when asked", () => {
    process.env.SOLANA_PAY_RECIPIENT = WALLET;
    delete process.env.SOLANA_PAY_CLUSTER;
    expect(solanaPayConfig()).toMatchObject({
      cluster: "mainnet-beta",
      mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    });
    process.env.SOLANA_PAY_CLUSTER = "devnet";
    expect(solanaPayConfig()?.cluster).toBe("devnet");
  });
});

describe("validDestination", () => {
  it("takes a Solana address for USDC and a short PIX key", () => {
    expect(validDestination("solana_usdc", ` ${WALLET} `)).toBe(WALLET);
    expect(validDestination("solana_usdc", "abc")).toBeNull();
    expect(validDestination("pix", " user@example.com ")).toBe("user@example.com");
    expect(validDestination("pix", "   ")).toBeNull();
    expect(validDestination("pix", "x".repeat(141))).toBeNull();
  });
});

describe("requestWithdrawal", () => {
  let home: string;
  const saved = process.env.AGENT_RAILS_HOME;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "rails-"));
    process.env.AGENT_RAILS_HOME = home;
  });
  afterEach(() => {
    process.env.AGENT_RAILS_HOME = saved;
    rmSync(home, { recursive: true, force: true });
  });

  it("holds the amount on the ledger and records a pending request", async () => {
    await jsonLedger.append(LOCAL, {
      kind: "deposit",
      amountMicros: 5_000_000,
      idempotencyKey: "d1",
    });
    const result = await requestWithdrawal(LOCAL, 5_000_000, 2_000_000, "solana_usdc", WALLET);
    expect(result.ok).toBe(true);
    expect(await jsonLedger.balance(LOCAL)).toBe(3_000_000);
    const [entry] = await jsonLedger.entries(LOCAL, 1);
    expect(entry).toMatchObject({ kind: "withdrawal", amountMicros: -2_000_000 });
    expect(await listWithdrawals(LOCAL)).toEqual([
      expect.objectContaining({ amountMicros: 2_000_000, status: "pending", destination: WALLET }),
    ]);
  });

  it("refuses more than the balance and holds nothing", async () => {
    const result = await requestWithdrawal(LOCAL, 1_000_000, 2_000_000, "pix", "key");
    expect(result).toEqual({ ok: false, reason: "insufficient" });
    expect(await jsonLedger.balance(LOCAL)).toBe(0);
    expect(await listWithdrawals(LOCAL)).toEqual([]);
  });
});
