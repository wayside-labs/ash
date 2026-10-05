import { describe, expect, it } from "vitest";
import { NETWORK_BUFFER_LAMPORTS } from "./constants.js";
import { buildRunPlan, newRunId, payoutDigest } from "./plan.js";
import { addr, demoPlan, FUNDER, proposalOf } from "./test-support.js";

describe("buildRunPlan", () => {
  it("prices the demo run exactly", () => {
    const plan = demoPlan();
    expect(plan.payouts).toHaveLength(2);
    expect(plan.payouts[0]).toMatchObject({
      deliver: "SOL",
      grossLamports: 20_000_000n,
      feeLamports: 5_060_000n,
      netLamports: 14_940_000n,
    });
    expect(plan.payouts[1]).toMatchObject({
      deliver: "ZEC",
      grossLamports: 20_000_000n,
      feeLamports: 5_060_000n,
      netLamports: 14_940_000n,
    });
    expect(plan.shieldLamports).toBe(40_000_000n);
    expect(plan.totalFeeLamports).toBe(10_120_000n);
    expect(plan.requiredBalanceLamports).toBe(40_000_000n + NETWORK_BUFFER_LAMPORTS);
    expect(plan.warnings).toEqual([]);
  });

  it("bounds a ZEC payout by the quote minus slippage", () => {
    const zec = demoPlan().payouts[1]?.zec;
    expect(zec).toEqual({ quoteOutBaseUnits: 183_000n, minOutBaseUnits: 179_340n });
  });

  it("leaves a ZEC payout unbounded and warns when there is no quote", () => {
    const plan = demoPlan({ quotes: false });
    expect(plan.payouts[1]?.zec).toBeUndefined();
    expect(plan.warnings).toHaveLength(1);
    expect(plan.warnings[0]).toContain("payout 2");
  });

  it("ignores a zero or missing quote instead of trusting it", () => {
    const plan = buildRunPlan(proposalOf(), {
      runId: "run_x",
      funder: FUNDER,
      zecQuotes: new Map([[1, 0n]]),
    });
    expect(plan.payouts[1]?.zec).toBeUndefined();
    expect(plan.warnings).toHaveLength(1);
  });

  it("shields exactly the sum of the payouts, whatever the mix", () => {
    const plan = buildRunPlan(
      proposalOf([
        { amountSol: "0.01", deliver: "SOL" },
        { amountSol: "0.03", deliver: "SOL" },
        { amountSol: "0.05", deliver: "SOL" },
      ]),
      { runId: "run_x", funder: FUNDER },
    );
    expect(plan.shieldLamports).toBe(90_000_000n);
    expect(plan.totalFeeLamports).toBe(plan.payouts.reduce((sum, p) => sum + p.feeLamports, 0n));
  });

  it("is a pure function of the proposal and the quotes", () => {
    const a = demoPlan();
    const b = demoPlan();
    expect(a).toEqual(b);
  });

  it("keeps each payee's address and label as proposed", () => {
    const plan = buildRunPlan(
      proposalOf([{ address: addr(7), label: "Acme Ltda", deliver: "SOL" }]),
      { runId: "run_x", funder: FUNDER },
    );
    expect(plan.payouts[0]).toMatchObject({ address: addr(7), label: "Acme Ltda", index: 0 });
    expect(plan.funder).toBe(FUNDER);
  });
});

describe("newRunId", () => {
  it("is short, prefixed and different each time", () => {
    const ids = new Set(Array.from({ length: 50 }, () => newRunId()));
    expect(ids.size).toBe(50);
    for (const id of ids) expect(id).toMatch(/^run_[0-9a-f]{12}$/);
  });
});

describe("payoutDigest", () => {
  const same = (a: ReturnType<typeof proposalOf>, b: ReturnType<typeof proposalOf>) =>
    payoutDigest(a) === payoutDigest(b);

  it("is one payout however the amount is spelled, and whatever the labels say", () => {
    const base = proposalOf([{ amountSol: "0.02", label: "Vendor" }]);
    expect(payoutDigest(base)).toMatch(/^[0-9a-f]{16}$/);
    expect(same(base, proposalOf([{ amountSol: "0.020", label: "Someone else" }]))).toBe(true);
    expect(same(base, proposalOf([{ amountSol: "0.0200000" }]))).toBe(true);
  });

  it("changes with a payee, a kind, an amount or the order", () => {
    const base = proposalOf([{ deliver: "SOL" }, { deliver: "ZEC" }]);
    expect(same(base, proposalOf([{ deliver: "SOL" }, { deliver: "SOL" }]))).toBe(false);
    expect(
      same(base, proposalOf([{ deliver: "SOL" }, { deliver: "ZEC", amountSol: "0.03" }])),
    ).toBe(false);
    expect(same(base, proposalOf([{ deliver: "SOL", address: addr(7) }, { deliver: "ZEC" }]))).toBe(
      false,
    );
    // The log is indexed by position, so the same payees the other way round is another run.
    expect(
      same(
        proposalOf([
          { address: addr(1), deliver: "SOL" },
          { address: addr(2), deliver: "SOL" },
        ]),
        proposalOf([
          { address: addr(2), deliver: "SOL" },
          { address: addr(1), deliver: "SOL" },
        ]),
      ),
    ).toBe(false);
  });

  it("does not leave an address readable", () => {
    const proposal = proposalOf([{ address: addr(5) }]);
    expect(payoutDigest(proposal)).not.toContain(addr(5).slice(0, 6));
  });
});
