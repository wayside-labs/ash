import type { MintLimitInputArgs, PolicyInputArgs } from "@agent-rails/client";
import { NATIVE_MINT } from "@agent-rails/contract";
import { type Address, address } from "@solana/kit";
import { describe, expect, it } from "vitest";
import { makeCeiling, makeMintConfig, makeTreasury } from "../fixtures.js";
import {
  applyLimitDelta,
  buildPolicyInput,
  type LimitDraft,
  limitLeqCeiling,
  mintLimitFromDraft,
  preflightPolicyLeqCeiling,
} from "./policy.js";

const SOL = address(NATIVE_MINT);
const OTHER_MINT = address("4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU");
const DESTINATION_MODE_ALLOWLIST = 1;
const DESTINATION_MODE_ANY = 0;

const ceiling = makeCeiling();

/** A draft that sits strictly inside `ceiling`, so each test moves exactly one field. */
function draft(overrides: Partial<LimitDraft> = {}): LimitDraft {
  return {
    perTxMax: 50n,
    shortWindowMax: 500n,
    shortWindowSeconds: 3_600,
    longWindowMax: 500n,
    longWindowSeconds: 86_400,
    lifetimeMax: 5_000n,
    ...overrides,
  };
}

function limitArgs(mint: Address, overrides: Partial<LimitDraft> = {}): MintLimitInputArgs {
  const d = draft(overrides);
  return { mint, ...d };
}

function policyArgs(
  mintLimits: MintLimitInputArgs[],
  overrides: Partial<PolicyInputArgs> = {},
): PolicyInputArgs {
  return {
    mintLimits,
    destinationMode: DESTINATION_MODE_ALLOWLIST,
    requireMemo: false,
    createDestinationAta: false,
    ...overrides,
  };
}

const hint = (mint: Address) => (mint === SOL ? "SOL" : mint);

describe("limitLeqCeiling", () => {
  it("accepts a limit inside the ceiling", () => {
    expect(limitLeqCeiling(draft(), ceiling)).toBe(true);
  });

  it("accepts a limit exactly at the ceiling", () => {
    expect(
      limitLeqCeiling(
        draft({
          perTxMax: ceiling.maxPerTx,
          shortWindowMax: ceiling.maxShortWindow,
          longWindowMax: ceiling.maxLongWindow,
          lifetimeMax: ceiling.maxLifetime,
          shortWindowSeconds: ceiling.minShortWindowSeconds,
          longWindowSeconds: ceiling.minLongWindowSeconds,
        }),
        ceiling,
      ),
    ).toBe(true);
  });

  // One case per field: a conjunction passes for the wrong reason if only one term is ever
  // exercised, which is what the policy crate's mutation gate catches on the Rust side.
  it.each([
    ["per-tx", { perTxMax: ceiling.maxPerTx + 1n }],
    ["short window max", { shortWindowMax: ceiling.maxShortWindow + 1n }],
    ["long window max", { longWindowMax: ceiling.maxLongWindow + 1n }],
    ["lifetime", { lifetimeMax: ceiling.maxLifetime + 1n }],
    ["short window seconds", { shortWindowSeconds: ceiling.minShortWindowSeconds - 1 }],
    ["long window seconds", { longWindowSeconds: ceiling.minLongWindowSeconds - 1 }],
  ] as const)("rejects a limit that loosens %s", (_label, override) => {
    expect(limitLeqCeiling(draft(override), ceiling)).toBe(false);
  });

  // Windows compare the other way round: a *shorter* window is the looser one, because the
  // same cap refills more often.
  it("accepts a window longer than the ceiling minimum", () => {
    expect(limitLeqCeiling(draft({ shortWindowSeconds: 7_200 }), ceiling)).toBe(true);
  });
});

describe("mintLimitFromDraft", () => {
  it("carries the draft over and zeroes the v1.1 reserved fields", () => {
    const limit = mintLimitFromDraft(SOL, draft());
    expect(limit.mint).toBe(SOL);
    expect(limit.perTxMax).toBe(50n);
    expect(limit.approvalThreshold).toBe(0n);
    expect(limit.cooldownSeconds).toBe(0);
    expect(limit.reserved).toEqual(new Uint8Array(12));
  });
});

describe("buildPolicyInput", () => {
  it("passes the flags through untouched", () => {
    const input = buildPolicyInput(
      [mintLimitFromDraft(SOL, draft())],
      DESTINATION_MODE_ANY,
      true,
      true,
    );
    expect(input.destinationMode).toBe(DESTINATION_MODE_ANY);
    expect(input.requireMemo).toBe(true);
    expect(input.createDestinationAta).toBe(true);
    expect(input.mintLimits).toHaveLength(1);
  });
});

describe("preflightPolicyLeqCeiling", () => {
  const treasury = makeTreasury({
    mints: [makeMintConfig(SOL), makeMintConfig(OTHER_MINT)],
    mintCount: 2,
  });

  it("accepts a policy under every ceiling", () => {
    expect(() =>
      preflightPolicyLeqCeiling(policyArgs([limitArgs(SOL)]), treasury, hint),
    ).not.toThrow();
  });

  it("rejects an empty policy", () => {
    expect(() => preflightPolicyLeqCeiling(policyArgs([]), treasury, hint)).toThrow(
      /at least one mint limit/,
    );
  });

  it("rejects a mint the treasury has no ceiling for", () => {
    const unknown = address("So11111111111111111111111111111111111111113");
    expect(() =>
      preflightPolicyLeqCeiling(policyArgs([limitArgs(unknown)]), treasury, hint),
    ).toThrow(/no ceiling on this treasury/);
  });

  // The slots past `mintCount` are zeroed, not absent: reading them would match a limit
  // against a ceiling of all zeros and reject a legitimate policy for the wrong reason.
  it("ignores mint slots past mintCount", () => {
    const stale = makeTreasury({
      mints: [makeMintConfig(SOL), makeMintConfig(OTHER_MINT)],
      mintCount: 1,
    });
    expect(() =>
      preflightPolicyLeqCeiling(policyArgs([limitArgs(OTHER_MINT)]), stale, hint),
    ).toThrow(/no ceiling on this treasury/);
  });

  it("rejects a limit above the ceiling and names the mint", () => {
    expect(() =>
      preflightPolicyLeqCeiling(
        policyArgs([limitArgs(SOL, { perTxMax: ceiling.maxPerTx + 1n })]),
        treasury,
        hint,
      ),
    ).toThrow(/SOL.*exceeds the owner ceiling/);
  });

  it("checks every limit, not just the first", () => {
    expect(() =>
      preflightPolicyLeqCeiling(
        policyArgs([limitArgs(SOL), limitArgs(OTHER_MINT, { lifetimeMax: 1_000_000n })]),
        treasury,
        hint,
      ),
    ).toThrow(/exceeds the owner ceiling/);
  });

  // The two ceiling flags are the owner's, and the policy may only narrow them.
  it("rejects createDestinationAta when the treasury forbids it", () => {
    expect(() =>
      preflightPolicyLeqCeiling(
        policyArgs([limitArgs(SOL)], { createDestinationAta: true }),
        treasury,
        hint,
      ),
    ).toThrow(/treasury ceiling forbids it/);
  });

  it("accepts createDestinationAta once the treasury allows it", () => {
    const permissive = makeTreasury({
      mints: [makeMintConfig(SOL)],
      mintCount: 1,
      allowCreateDestinationAta: true,
    });
    expect(() =>
      preflightPolicyLeqCeiling(
        policyArgs([limitArgs(SOL)], { createDestinationAta: true }),
        permissive,
        hint,
      ),
    ).not.toThrow();
  });

  it("rejects destination mode Any when the treasury forbids it", () => {
    expect(() =>
      preflightPolicyLeqCeiling(
        policyArgs([limitArgs(SOL)], { destinationMode: DESTINATION_MODE_ANY }),
        treasury,
        hint,
      ),
    ).toThrow(/destination mode exceeds treasury ceiling/);
  });

  it("accepts destination mode Any once the treasury allows it", () => {
    const permissive = makeTreasury({
      mints: [makeMintConfig(SOL)],
      mintCount: 1,
      allowAnyDestination: true,
    });
    expect(() =>
      preflightPolicyLeqCeiling(
        policyArgs([limitArgs(SOL)], { destinationMode: DESTINATION_MODE_ANY }),
        permissive,
        hint,
      ),
    ).not.toThrow();
  });

  it("accepts the allowlist mode without the any-destination ceiling", () => {
    expect(() =>
      preflightPolicyLeqCeiling(
        policyArgs([limitArgs(SOL)], { destinationMode: DESTINATION_MODE_ALLOWLIST }),
        treasury,
        hint,
      ),
    ).not.toThrow();
  });
});

describe("applyLimitDelta", () => {
  const current = mintLimitFromDraft(SOL, draft({ perTxMax: 10n }));

  it("overrides only supplied fields", () => {
    const next = applyLimitDelta(current, { perTxMax: 5n });
    expect(next.perTxMax).toBe(5n);
    expect(next.longWindowMax).toBe(current.longWindowMax);
    expect(next.mint).toBe(SOL);
  });

  it("is an identity for an empty delta", () => {
    expect(applyLimitDelta(current, {})).toEqual(current);
  });

  // `?? current` must not swallow a deliberate zero — zero is how a limit is closed off.
  it("applies a zero override rather than falling back", () => {
    expect(applyLimitDelta(current, { perTxMax: 0n }).perTxMax).toBe(0n);
    expect(applyLimitDelta(current, { shortWindowSeconds: 0 }).shortWindowSeconds).toBe(0);
  });
});
