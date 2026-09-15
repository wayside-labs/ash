import {
  DEFAULT_SECURITY_PRESET,
  type Requirement,
  SECURITY_PRESETS,
  type SecurityPosture,
  type SecurityPresetName,
  securityPostureSchema,
  toBaseUnits,
} from "@agent-rails/contract";
import type { PolicyHook } from "./policy-hooks.js";

/**
 * Turning a declared posture into something the payment path can ask questions of.
 *
 * The posture in `@agent-rails/contract` is data: serializable, loggable, snapshot-testable.
 * This adds the parts that cannot be serialized — the hooks themselves — and precomputes the
 * value bands so the hot path does no string parsing.
 */

export type AgentRailsSecurityConfig = {
  /** Starting point. Defaults to `balanced`. */
  preset?: SecurityPresetName;
  /** Overrides applied on top of the preset, one field at a time. */
  posture?: DeepPartial<SecurityPosture>;
  /** Contextual rules the chain cannot see (ADR-005 section 6). */
  hooks?: PolicyHook[];
};

type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends Array<infer U>
    ? Array<U>
    : T[K] extends object
      ? DeepPartial<T[K]>
      : T[K];
};

export type ResolvedSecurity = {
  preset: SecurityPresetName;
  posture: SecurityPosture;
  hooks: PolicyHook[];
};

function mergePosture(
  base: SecurityPosture,
  overrides: DeepPartial<SecurityPosture> | undefined,
): SecurityPosture {
  if (!overrides) return base;
  return {
    destinations: { ...base.destinations, ...overrides.destinations },
    // Bands replace rather than merge: a partially overridden list of thresholds is a
    // configuration nobody can reason about.
    value: { bands: overrides.value?.bands ?? base.value.bands },
    hooks: { ...base.hooks, ...overrides.hooks },
    velocity: { ...base.velocity, ...overrides.velocity },
    outcomes: { ...base.outcomes, ...overrides.outcomes },
    disclosure: { ...base.disclosure, ...overrides.disclosure },
  };
}

/**
 * Resolve a config into a validated posture.
 *
 * Validation is not a formality: a posture is parsed by the same Zod schema that documents
 * it, so a typo in a preset override fails at startup rather than silently leaving a guard
 * at its default.
 */
export function resolveSecurity(config: AgentRailsSecurityConfig = {}): ResolvedSecurity {
  const preset = config.preset ?? DEFAULT_SECURITY_PRESET;
  const base = SECURITY_PRESETS[preset];
  if (!base) {
    throw new Error(
      `Unknown security preset "${preset}". Expected one of: ${Object.keys(SECURITY_PRESETS).join(", ")}`,
    );
  }

  const posture = securityPostureSchema.parse(mergePosture(base, config.posture));
  const hooks = config.hooks ?? [];

  // A hook's own timeout wins; otherwise it inherits the posture's, so one setting governs
  // a whole set of hooks that did not each have to be told.
  const withDefaults = hooks.map((hook) => ({
    ...hook,
    timeoutMs: hook.timeoutMs ?? posture.hooks.timeoutMs,
    failOpen: hook.failOpen ?? posture.hooks.onUnavailable === "allow",
  }));

  return { preset, posture, hooks: withDefaults };
}

export type MintView = {
  /** Symbol if the operator gave one, otherwise the address. */
  ref: string;
  address: string;
  decimals: number;
};

/**
 * Which requirements a payment of this size in this mint has to satisfy.
 *
 * Every matching band contributes, so bands accumulate rather than override: a strict
 * posture can say "everything needs a memo" and "above 1000 also needs review" without
 * restating the first rule in the second band.
 */
export function requirementsFor(
  security: ResolvedSecurity,
  amount: bigint,
  mint: MintView,
): Set<Requirement> {
  const required = new Set<Requirement>();

  for (const band of security.posture.value.bands) {
    if (band.mint && band.mint !== mint.ref && band.mint !== mint.address) continue;
    // Converted with the mint's own decimals, so a band is compared in base units and never
    // as a float.
    if (amount >= toBaseUnits(band.above, mint.decimals)) {
      for (const requirement of band.require) required.add(requirement);
    }
  }

  return required;
}

export type ChainFacts = {
  /** 0 = Any, 1 = Allowlist. */
  destinationMode: number;
  requireMemo: boolean;
  allowAnyDestination: boolean;
  registeredDestinations: number;
};

/**
 * Warnings about a posture that does not match the chain it is pointed at.
 *
 * A relaxation the program will refuse anyway is not dangerous, it is confusing: the
 * developer set `open` and still gets denials, and nothing tells them the ceiling is what
 * refused. Saying so once at startup is much kinder than letting them find out one failed
 * payment at a time. These are warnings and never errors — the chain is the authority, and
 * a client that refuses to start because it is stricter than necessary helps nobody.
 */
export function securityCoherenceWarnings(security: ResolvedSecurity, chain: ChainFacts): string[] {
  const warnings: string[] = [];
  const { policy } = security.posture.destinations;

  if (policy !== "labels-only" && chain.destinationMode === 1) {
    warnings.push(
      `destinations.policy is "${policy}", but the on-chain policy is in Allowlist mode: ` +
        "raw addresses will be refused by the program regardless. " +
        'Use "labels-only" to refuse them here, with a clearer message and no wasted fee.',
    );
  }

  if (policy === "open" && chain.destinationMode === 0) {
    warnings.push(
      'destinations.policy is "open" and the on-chain policy accepts any destination: ' +
        "an injected instruction can name any payee, bounded only by the per-transaction " +
        "and window limits. Appropriate for prototyping, not for a treasury with a float.",
    );
  }

  if (security.posture.hooks.onUnavailable === "allow" && security.hooks.length > 0) {
    warnings.push(
      'hooks.onUnavailable is "allow": a hook that times out permits the payment. ' +
        "The on-chain limits still apply, but the contextual rule does not.",
    );
  }

  if (security.posture.disclosure.includeSimulationLogs) {
    warnings.push(
      "disclosure.includeSimulationLogs is on: program logs are returned to the caller, " +
        "which puts attacker-influenceable text into a model's context. Development only.",
    );
  }

  if (!security.posture.outcomes.quiesceOnIndeterminate) {
    warnings.push(
      "outcomes.quiesceOnIndeterminate is off: after an unresolved payment the session " +
        "keeps paying. A retry of the same payment is still refused on-chain by its " +
        "receipt, so this is a liveness choice rather than a correctness one.",
    );
  }

  if (chain.requireMemo && !security.posture.value.bands.some((b) => b.require.includes("memo"))) {
    warnings.push(
      "the on-chain policy requires a memo on every payment, which is stricter than any " +
        "configured value band. The program will enforce it.",
    );
  }

  if (chain.destinationMode === 1 && chain.registeredDestinations === 0) {
    warnings.push(
      "the on-chain policy is in Allowlist mode with no registered destinations: " +
        "no payment can succeed until an operator adds one.",
    );
  }

  return warnings;
}
