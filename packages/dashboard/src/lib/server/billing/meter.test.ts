import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { jsonLedger } from "./ledger";
import { billingConfig, claimTurn, currentBalance, debitTurn, preflight, priceTurn } from "./meter";

const SONNET = { promptMicros: 2, completionMicros: 10 };
const LOCAL = { kind: "local" } as const;

describe("priceTurn", () => {
  it("charges OpenRouter's reported cost when there is one", () => {
    expect(
      priceTurn({ promptTokens: 100, completionTokens: 50, cost: 0.0007 }, SONNET, 0, 0),
    ).toEqual({ rawCostMicros: 700, promptTokens: 100, completionTokens: 50, estimated: false });
  });

  it("falls back to list price on reported tokens, flagged estimated", () => {
    expect(priceTurn({ promptTokens: 100, completionTokens: 50 }, SONNET, 0, 0)).toEqual({
      rawCostMicros: 700,
      promptTokens: 100,
      completionTokens: 50,
      estimated: true,
    });
  });

  it("still charges an aborted turn that produced text but no usage chunk", () => {
    const priced = priceTurn(null, SONNET, 300, 30);
    expect(priced).toEqual({
      rawCostMicros: 100 * 2 + 10 * 10,
      promptTokens: 100,
      completionTokens: 10,
      estimated: true,
    });
  });

  it("charges nothing for a turn that failed before generating", () => {
    expect(priceTurn(null, SONNET, 300, 0)).toBeNull();
  });
});

describe("preflight", () => {
  it("passes a balance that covers the worst case", () => {
    expect(preflight(1_000_000, SONNET, 1_000, 8_192, 2_000)).toEqual({
      ok: true,
      balanceMicros: 1_000_000,
    });
  });

  it("refuses a zero or negative balance and names what it would take", () => {
    const zero = preflight(0, SONNET, 0, 1, 2_000);
    expect(zero.ok).toBe(false);
    expect(preflight(-5, SONNET, 0, 1, 0).ok).toBe(false);
  });

  it("refuses a positive balance below the worst case", () => {
    const check = preflight(50_000, SONNET, 1_000, 8_192, 2_000);
    expect(check).toMatchObject({ ok: false, balanceMicros: 50_000 });
    if (!check.ok) expect(check.requiredMicros).toBeGreaterThan(50_000);
  });
});

describe("claimTurn", () => {
  it("lets one turn per payer run at a time", () => {
    const release = claimTurn(LOCAL);
    expect(release).not.toBeNull();
    expect(claimTurn(LOCAL)).toBeNull();
    expect(claimTurn({ kind: "org", orgId: "other", accountId: "a" })?.()).toBe(true);
    release?.();
    const again = claimTurn(LOCAL);
    expect(again).not.toBeNull();
    again?.();
  });
});

describe("billingConfig", () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
  });

  it("is off locally unless opted in, and on whenever Supabase is configured", () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.BILLING_ENABLED;
    expect(billingConfig().enabled).toBe(false);
    process.env.BILLING_ENABLED = "true";
    expect(billingConfig().enabled).toBe(true);
    delete process.env.BILLING_ENABLED;
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://x.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";
    expect(billingConfig().enabled).toBe(true);
  });
});

describe("the local ledger, end to end", () => {
  let home: string;
  const saved = process.env.AGENT_RAILS_HOME;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "billing-"));
    process.env.AGENT_RAILS_HOME = home;
  });
  afterEach(() => {
    process.env.AGENT_RAILS_HOME = saved;
    rmSync(home, { recursive: true, force: true });
  });

  const config = { enabled: true, markupBps: 2_000, starterMicros: 500_000 };

  it("grants the starter credit once, however often the balance is read", async () => {
    expect(await currentBalance(LOCAL, config)).toBe(500_000);
    expect(await currentBalance(LOCAL, config)).toBe(500_000);
    const entries = await jsonLedger.entries(LOCAL, 10);
    expect(entries.filter((e) => e.kind === "starter_grant")).toHaveLength(1);
  });

  it("grants nothing when the starter credit is zero", async () => {
    expect(await currentBalance(LOCAL, { ...config, starterMicros: 0 })).toBe(0);
    expect(await jsonLedger.entries(LOCAL, 10)).toEqual([]);
  });

  it("debits cost plus markup, with the breakdown on the entry, idempotently", async () => {
    await currentBalance(LOCAL, config);
    const turn = {
      rawCostMicros: 10_000,
      promptTokens: 1_000,
      completionTokens: 800,
      estimated: false,
    };
    await debitTurn(LOCAL, "req-1", "openrouter:anthropic/claude-sonnet-5.5", turn, 2_000);
    await debitTurn(LOCAL, "req-1", "openrouter:anthropic/claude-sonnet-5.5", turn, 2_000);

    expect(await currentBalance(LOCAL, config)).toBe(500_000 - 12_000);
    const [latest] = await jsonLedger.entries(LOCAL, 10);
    expect(latest).toMatchObject({
      kind: "chat_debit",
      amountMicros: -12_000,
      rawCostMicros: 10_000,
      markupBps: 2_000,
      markupMicros: 2_000,
      promptTokens: 1_000,
      completionTokens: 800,
      model: "openrouter:anthropic/claude-sonnet-5.5",
    });
    expect(latest?.estimated).toBeUndefined();
  });

  it("writes nothing for a zero-cost turn", async () => {
    const turn = { rawCostMicros: 0, promptTokens: 0, completionTokens: 0, estimated: false };
    await debitTurn(LOCAL, "req-0", "m", turn, 2_000);
    expect(await jsonLedger.entries(LOCAL, 10)).toEqual([]);
  });

  it("does not re-grant the starter credit to a balance spent below zero", async () => {
    await currentBalance(LOCAL, config);
    const turn = { rawCostMicros: 600_000, promptTokens: 1, completionTokens: 1, estimated: true };
    await debitTurn(LOCAL, "req-big", "m", turn, 0);
    expect(await currentBalance(LOCAL, config)).toBe(-100_000);
  });
});
