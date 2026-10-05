import type { Address } from "@solana/kit";
import { describe, expect, it } from "vitest";
import {
  type DestinationIndex,
  editDistance,
  nearMisses,
  normalizeLabel,
  resolveDestination,
} from "./destinations.js";
import { isAshError } from "./errors.js";

const POLICY = "11111111111111111111111111111113" as Address;
const ACME = "11111111111111111111111111111115" as Address;
const OTHER = "11111111111111111111111111111116" as Address;

function index(
  entries: Array<{ label: string; owner: Address }> = [{ label: "acme-hosting", owner: ACME }],
): DestinationIndex {
  return {
    policy: POLICY,
    loadedAt: Date.now(),
    entries: entries.map((entry) => ({
      label: entry.label,
      normalizedLabel: normalizeLabel(entry.label),
      owner: entry.owner,
      entry: OTHER,
      perTxMaxOverride: 0n,
    })),
  };
}

function reasonOf(fn: () => unknown): string {
  try {
    fn();
  } catch (error) {
    if (isAshError(error)) return error.reasonCode;
    throw error;
  }
  return "no-error";
}

describe("normalizeLabel", () => {
  it("folds the differences a human cannot see", () => {
    expect(normalizeLabel("  Acme-Hosting  ")).toBe("acme-hosting");
    expect(normalizeLabel("acme   hosting")).toBe("acme hosting");
    // NFKC: a full-width form is the same label, not a different one.
    expect(normalizeLabel("ＡＣＭＥ")).toBe("acme");
  });
});

describe("resolveDestination", () => {
  it("resolves an exact label to its registered owner", () => {
    const resolved = resolveDestination({
      index: index(),
      ref: "Acme-Hosting",
      allowRawAddress: false,
    });
    expect(resolved.owner).toBe(ACME);
    expect(resolved.label).toBe("acme-hosting");
  });

  it("refuses a near miss rather than guessing", () => {
    // One transposition away. Fuzzy matching here is the attack, not a convenience.
    expect(
      reasonOf(() =>
        resolveDestination({ index: index(), ref: "acme-hostlng", allowRawAddress: false }),
      ),
    ).toBe("UNKNOWN_DESTINATION");
  });

  it("refuses a raw address under an allowlist policy", () => {
    expect(
      reasonOf(() => resolveDestination({ index: index(), ref: ACME, allowRawAddress: false })),
    ).toBe("LITERAL_NOT_PERMITTED");
  });

  it("accepts a raw address only where the policy permits any destination", () => {
    const resolved = resolveDestination({ index: index(), ref: ACME, allowRawAddress: true });
    expect(resolved.owner).toBe(ACME);
    expect(resolved.label).toBeUndefined();
  });

  it("refuses when two entries collide on one normalized label", () => {
    const colliding = index([
      { label: "acme-hosting", owner: ACME },
      { label: "ACME-Hosting", owner: OTHER },
    ]);

    // Either an operator mistake or a registered look-alike. Paying either one is wrong.
    expect(
      reasonOf(() =>
        resolveDestination({ index: colliding, ref: "acme-hosting", allowRawAddress: false }),
      ),
    ).toBe("AMBIGUOUS_DESTINATION");
  });

  it("does not leak the real label in a denial message", () => {
    try {
      resolveDestination({ index: index(), ref: "acme-hostlng", allowRawAddress: false });
    } catch (error) {
      if (!isAshError(error)) throw error;
      expect(error.message).not.toContain("acme-hosting");
    }
  });
});

describe("nearMisses", () => {
  it("flags labels close enough to look like impersonation", () => {
    expect(nearMisses(index(), "acme-hostlng")).toEqual(["acme-hosting"]);
    expect(nearMisses(index(), "totally-different")).toEqual([]);
  });

  it("measures distance without running away on long strings", () => {
    expect(editDistance("kitten", "sitting")).toBe(3);
    expect(editDistance("a", "a".repeat(40), 2)).toBe(3);
  });
});
