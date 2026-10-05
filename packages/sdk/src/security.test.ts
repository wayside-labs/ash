import { describeSecurity, IMMUTABLE_GUARANTEES, SECURITY_PRESETS } from "@ash/contract";
import { describe, expect, it } from "vitest";
import {
  type ChainFacts,
  requirementsFor,
  resolveSecurity,
  securityCoherenceWarnings,
} from "./security.js";

const USDC = { ref: "USDC", address: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", decimals: 6 };
const SOL = { ref: "SOL", address: "So11111111111111111111111111111111111111112", decimals: 9 };

function chain(overrides: Partial<ChainFacts> = {}): ChainFacts {
  return {
    destinationMode: 1,
    requireMemo: false,
    allowAnyDestination: false,
    registeredDestinations: 3,
    ...overrides,
  };
}

describe("resolveSecurity", () => {
  it("defaults to the balanced preset", () => {
    expect(resolveSecurity().preset).toBe("balanced");
    expect(resolveSecurity().posture).toEqual(SECURITY_PRESETS.balanced);
  });

  it("applies overrides field by field", () => {
    const resolved = resolveSecurity({
      preset: "strict",
      posture: { velocity: { maxPaymentsPerMinute: 30, maxConcurrent: 2 } },
    });

    expect(resolved.posture.velocity.maxPaymentsPerMinute).toBe(30);
    // Untouched fields keep the preset's values rather than reverting to a default.
    expect(resolved.posture.destinations.policy).toBe("labels-only");
    expect(resolved.posture.hooks.onUnavailable).toBe("deny");
  });

  it("replaces value bands wholesale rather than merging them", () => {
    const resolved = resolveSecurity({
      preset: "strict",
      posture: { value: { bands: [{ above: "50", require: ["memo"] }] } },
    });

    // A half-overridden threshold list is a configuration nobody can reason about.
    expect(resolved.posture.value.bands).toEqual([{ above: "50", require: ["memo"] }]);
  });

  it("rejects an unknown preset by name", () => {
    expect(() => resolveSecurity({ preset: "paranoid" as never })).toThrow(
      /Unknown security preset/,
    );
  });

  it("rejects a malformed override instead of silently ignoring it", () => {
    // A typo that leaves a guard at its default is worse than a startup failure.
    expect(() =>
      resolveSecurity({ posture: { velocity: { maxPaymentsPerMinute: -1 } } as never }),
    ).toThrow();
    expect(() =>
      resolveSecurity({ posture: { value: { bands: [{ above: "lots", require: ["memo"] }] } } }),
    ).toThrow();
  });

  it("gives hooks the posture's timeout and fail mode unless they set their own", () => {
    const resolved = resolveSecurity({
      preset: "sandbox",
      hooks: [
        { name: "inherits", evaluate: () => ({ allow: true }) },
        { name: "opts-out", failOpen: false, timeoutMs: 50, evaluate: () => ({ allow: true }) },
      ],
    });

    expect(resolved.hooks[0]).toMatchObject({ failOpen: true, timeoutMs: 2_000 });
    expect(resolved.hooks[1]).toMatchObject({ failOpen: false, timeoutMs: 50 });
  });
});

describe("requirementsFor", () => {
  it("accumulates every matching band", () => {
    const security = resolveSecurity({ preset: "strict" });

    // strict: memo+hooks above 0, dry-run above 100, review above 1000.
    expect([...requirementsFor(security, 1n, USDC)].sort()).toEqual(["hooks", "memo"]);
    expect([...requirementsFor(security, 500_000_000n, USDC)].sort()).toEqual([
      "dry-run-first",
      "hooks",
      "memo",
    ]);
    expect([...requirementsFor(security, 2_000_000_000n, USDC)].sort()).toEqual([
      "dry-run-first",
      "hooks",
      "human-review",
      "memo",
    ]);
  });

  it("compares in base units, so a band means the same thing for every mint", () => {
    const security = resolveSecurity({
      posture: { value: { bands: [{ above: "100", require: ["memo"] }] } },
    });

    // 100 USDC is 100_000_000 base units; 100 SOL is 100_000_000_000. A band that compared
    // raw integers would fire at a hundredth of the intended amount on a 9-decimal mint.
    expect(requirementsFor(security, 99_999_999n, USDC).size).toBe(0);
    expect(requirementsFor(security, 100_000_000n, USDC).has("memo")).toBe(true);
    expect(requirementsFor(security, 100_000_000n, SOL).size).toBe(0);
    expect(requirementsFor(security, 100_000_000_000n, SOL).has("memo")).toBe(true);
  });

  it("scopes a band to one mint when asked", () => {
    const security = resolveSecurity({
      posture: { value: { bands: [{ mint: "USDC", above: "10", require: ["human-review"] }] } },
    });

    expect(requirementsFor(security, 1_000_000_000n, USDC).has("human-review")).toBe(true);
    expect(requirementsFor(security, 1_000_000_000_000n, SOL).size).toBe(0);
  });

  it("requires nothing under the sandbox preset", () => {
    const security = resolveSecurity({ preset: "sandbox" });
    expect(requirementsFor(security, 10n ** 12n, USDC).size).toBe(0);
  });
});

describe("securityCoherenceWarnings", () => {
  it("says nothing when the posture matches the chain", () => {
    expect(securityCoherenceWarnings(resolveSecurity({ preset: "balanced" }), chain())).toEqual([]);
  });

  it("explains that a relaxed destination policy is a no-op under an allowlist", () => {
    const warnings = securityCoherenceWarnings(
      resolveSecurity({ posture: { destinations: { policy: "open", nearMissDistance: 0 } } }),
      chain({ destinationMode: 1 }),
    );

    // The developer set "open", still gets denials, and nothing else would tell them the
    // on-chain policy is what refused.
    expect(warnings.join(" ")).toContain("refused by the program regardless");
  });

  it("warns when an open policy actually is open", () => {
    const warnings = securityCoherenceWarnings(
      resolveSecurity({ preset: "sandbox" }),
      chain({ destinationMode: 0, allowAnyDestination: true }),
    );

    expect(warnings.join(" ")).toContain("any payee");
  });

  it("warns about a fail-open hook only when hooks exist", () => {
    const withHooks = resolveSecurity({
      preset: "sandbox",
      hooks: [{ name: "h", evaluate: () => ({ allow: true }) }],
    });
    expect(securityCoherenceWarnings(withHooks, chain({ destinationMode: 0 })).join(" ")).toContain(
      "times out permits the payment",
    );
    expect(
      securityCoherenceWarnings(
        resolveSecurity({ preset: "sandbox" }),
        chain({ destinationMode: 0 }),
      ).join(" "),
    ).not.toContain("times out permits the payment");
  });

  it("flags an allowlist policy with nothing on it", () => {
    const warnings = securityCoherenceWarnings(
      resolveSecurity(),
      chain({ registeredDestinations: 0 }),
    );
    expect(warnings.join(" ")).toContain("no registered destinations");
  });

  it("describes disabling the quiesce as a liveness choice, not a correctness one", () => {
    const warnings = securityCoherenceWarnings(
      resolveSecurity({ preset: "sandbox" }),
      chain({ destinationMode: 0 }),
    );
    // Because the intent id is derived, the receipt still refuses a duplicate.
    expect(warnings.join(" ")).toContain("refused on-chain by its");
  });
});

describe("posture presets", () => {
  it("relaxes monotonically from strict to sandbox", () => {
    const { sandbox, balanced, strict } = SECURITY_PRESETS;

    expect(strict.velocity.maxPaymentsPerMinute).toBeLessThan(
      balanced.velocity.maxPaymentsPerMinute,
    );
    expect(balanced.velocity.maxPaymentsPerMinute).toBeLessThan(
      sandbox.velocity.maxPaymentsPerMinute,
    );
    expect(strict.value.bands.length).toBeGreaterThan(balanced.value.bands.length);
    expect(balanced.value.bands.length).toBeGreaterThan(sandbox.value.bands.length);
  });

  it("never returns logs to the caller outside the sandbox", () => {
    expect(SECURITY_PRESETS.balanced.disclosure.includeSimulationLogs).toBe(false);
    expect(SECURITY_PRESETS.strict.disclosure.includeSimulationLogs).toBe(false);
  });

  it("keeps the immutable guarantees documented", () => {
    // These have no backstop underneath them, which is why no preset may reach them.
    expect(IMMUTABLE_GUARANTEES.join(" ")).toContain("intent_id is derived");
    expect(IMMUTABLE_GUARANTEES.join(" ")).toContain("never reported as a denial");
  });

  it("describes itself in terms a developer can check", () => {
    const lines = describeSecurity(SECURITY_PRESETS.strict);
    expect(lines.join("\n")).toContain("registered labels only");
    expect(lines.join("\n")).toContain("above 1000: requires human-review");
  });
});
