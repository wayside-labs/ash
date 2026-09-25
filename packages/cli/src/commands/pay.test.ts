/**
 * The decision `pay` makes before it touches an RPC: which mint an operator meant.
 *
 * Getting this wrong is not a failed transaction, it is the wrong one — "10" against a
 * 9-decimal mint instead of a 6-decimal one is a payment a thousand times larger that the
 * policy may well allow. The rest of the handler is RPC orchestration and belongs on
 * litesvm (ADR-008 layer 4), which `packages/cli` has not reached yet.
 */
import { NATIVE_MINT } from "@agent-rails/contract";
import { address } from "@solana/kit";
import { describe, expect, it } from "vitest";
import type { MintCeilingView } from "../chain/read.js";
import { isCliError } from "../errors.js";
import { resolveMint } from "./pay.js";

const USDC = address("4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU");

const ceiling = (over: Partial<MintCeilingView> & Pick<MintCeilingView, "mint" | "symbol">) =>
  ({
    decimals: 6,
    maxPerTx: 0n,
    maxShortWindow: 0n,
    maxLongWindow: 0n,
    maxLifetime: 0n,
    minShortWindowSeconds: 0,
    minLongWindowSeconds: 0,
    vaultBalance: 0n,
    ...over,
  }) as MintCeilingView;

const CEILINGS = [
  ceiling({ mint: address(NATIVE_MINT), symbol: "SOL", decimals: 9 }),
  ceiling({ mint: USDC, symbol: "USDC", decimals: 6 }),
];

describe("resolveMint", () => {
  it("defaults to SOL when no mint is named", () => {
    expect(resolveMint(CEILINGS, undefined).symbol).toBe("SOL");
  });

  it("matches a symbol regardless of case", () => {
    expect(resolveMint(CEILINGS, "usdc").mint).toBe(USDC);
    expect(resolveMint(CEILINGS, "sol").decimals).toBe(9);
  });

  it("matches a raw mint address", () => {
    expect(resolveMint(CEILINGS, USDC).symbol).toBe("USDC");
  });

  it("ignores surrounding whitespace", () => {
    expect(resolveMint(CEILINGS, "  USDC  ").mint).toBe(USDC);
  });

  // A mint the treasury never configured has no ceiling, so the program would refuse the
  // payment anyway — this refuses first, and says which mints exist.
  it("refuses a mint the treasury does not accept", () => {
    try {
      resolveMint(CEILINGS, "BONK");
      expect.unreachable("should have thrown");
    } catch (error) {
      expect(isCliError(error)).toBe(true);
      expect((error as Error).message).toContain("BONK");
    }
  });

  it("refuses SOL on a treasury with no native mint", () => {
    expect(() => resolveMint([CEILINGS[1] as MintCeilingView], "SOL")).toThrow(/native SOL/);
  });
});

describe("resolveMint with manifest aliases", () => {
  // `init --mock-mint` records `MOCK`, and the chain has no ticker to match it against:
  // the ceiling's symbol is the first four characters of the address. Without the alias
  // the name `init` printed is not a name `pay` accepts.
  const aliases = { MOCK: String(USDC) };

  it("resolves a name the manifest recorded", () => {
    expect(resolveMint(CEILINGS, "MOCK", aliases).mint).toBe(USDC);
    expect(resolveMint(CEILINGS, "mock", aliases).mint).toBe(USDC);
  });

  it("says so when the alias names a mint this treasury dropped", () => {
    const withoutUsdc = [CEILINGS[0] as MintCeilingView];
    expect(() => resolveMint(withoutUsdc, "MOCK", aliases)).toThrow(/does not accept/);
  });

  it("still prefers SOL over an alias that shadows it", () => {
    expect(resolveMint(CEILINGS, "SOL", { SOL: String(USDC) }).decimals).toBe(9);
  });
});
