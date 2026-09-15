import { z } from "zod";

/**
 * Configurable guard-rails.
 *
 * Agent Rails has two kinds of control and they must never be confused. The program is the
 * floor: pause, session liveness, mint configuration, the ceiling, the destination
 * allowlist, per-transaction and window and lifetime limits, and the `IntentReceipt`. None
 * of that is reachable from here, and nothing in this file can make the chain accept a
 * payment it would otherwise refuse.
 *
 * What is configurable is the *off-chain* posture: how much a client refuses before the
 * chain ever sees it. Turning a knob down does not grant permission; it moves a refusal
 * from the client to the validator, or gives it up entirely in favour of the floor
 * underneath. That is what makes a sandbox preset safe to ship — the floor does not move.
 *
 * Read `IMMUTABLE_GUARANTEES` before adding a knob. Some properties are not negotiable
 * because nothing underneath them would catch the mistake.
 */

/**
 * Properties no preset may weaken.
 *
 * Each one is here because it has no backstop: if the client gets it wrong, the program
 * cannot tell. A derived `intent_id` is the clearest case — the receipt only refuses a
 * duplicate that arrives under the same id, so a client that picks ids badly disables a
 * guarantee the chain believes it is providing.
 */
export const IMMUTABLE_GUARANTEES = [
  "intent_id is derived from the payment, never random (ADR-012)",
  "tool arguments are strict; unknown keys are refused, not stripped",
  "treasury, policy and session are bound at startup, never taken from a caller",
  "amounts convert to base units with integer arithmetic; excess precision denies",
  "expires_at is server-authored",
  "a broadcast whose outcome is unknown is never reported as a denial",
] as const;

/**
 * How destination references are resolved.
 *
 * The on-chain `destination_mode` is the authority: under `Allowlist` the program requires
 * an `AllowlistEntry` PDA whose seeds match the destination, so an unregistered payee is
 * refused on-chain whatever this says. This setting decides how early, and how legibly,
 * that refusal happens.
 */
export const destinationPolicySchema = z.enum([
  /**
   * Labels only. A raw address is refused by the client with `LITERAL_NOT_PERMITTED`.
   *
   * The strongest posture, and the one every injection defense assumes: a caller has no
   * syntax for naming a payee an operator did not register.
   */
  "labels-only",
  /**
   * Labels resolve; a raw address is passed through to the chain to accept or refuse.
   *
   * Under an on-chain `Allowlist` policy this is identical in outcome to `labels-only` —
   * the program refuses the unregistered address — but the denial costs a round trip and
   * arrives as `DESTINATION_NOT_ALLOWED` rather than a client-side explanation.
   */
  "labels-preferred",
  /**
   * Raw addresses are first-class.
   *
   * Only meaningful when the on-chain policy is in `Any` mode, which itself requires
   * `treasury.allow_any_destination`. Prototyping posture: the blast radius is then bounded
   * by the per-transaction and window limits alone.
   */
  "open",
]);

export type DestinationPolicy = z.infer<typeof destinationPolicySchema>;

/** What a payment must satisfy once it crosses a value band. */
export const requirementSchema = z.enum([
  /** A non-empty memo. */
  "memo",
  /**
   * A `check_payment` for this exact intent must have run first.
   *
   * Cheap to satisfy, and it means a large payment cannot be the first thing an agent does
   * with a freshly hallucinated destination: the dry run resolves the same references and
   * would have failed.
   */
  "dry-run-first",
  /** Hook failures deny, regardless of the global `onUnavailable` setting. */
  "hooks",
  /**
   * Hand off to a human. Returns the terminal outcome `review_required`.
   *
   * Terminal on purpose: a retryable denial here would have the agent loop against the
   * review gate. v1.1 moves this on-chain via the reserved `approval_threshold`.
   */
  "human-review",
]);

export type Requirement = z.infer<typeof requirementSchema>;

/**
 * A value band and what it demands.
 *
 * Bands are evaluated against the resolved base-unit amount, so they are per mint by
 * necessity — "above 100" means nothing until you know which token.
 */
export const valueBandSchema = z.object({
  /** Mint symbol or address. Omit to apply to every mint. */
  mint: z.string().optional(),
  /** Human units, inclusive lower bound. Compared after conversion, never as a float. */
  above: z.string().regex(/^\d+(\.\d+)?$/),
  require: z.array(requirementSchema).min(1),
});

export type ValueBand = z.infer<typeof valueBandSchema>;

export const securityPostureSchema = z.object({
  destinations: z.object({
    policy: destinationPolicySchema,
    /**
     * Refuse a label within this edit distance of a registered one instead of reporting a
     * plain miss. Zero disables the check. A near miss is more often impersonation than a
     * typo, and the denial message never names the real label either way.
     */
    nearMissDistance: z.number().int().min(0).max(4),
  }),
  value: z.object({
    /** Evaluated in order; every matching band's requirements apply. */
    bands: z.array(valueBandSchema),
  }),
  hooks: z.object({
    /**
     * What a hook timeout or exception means.
     *
     * `deny` is the production answer: a control that evaporates under load is not a
     * control. `allow` is for prototyping against a half-built hook service, and is safe
     * only because hooks see context the chain cannot — they are additive restrictions, so
     * losing one falls back to the on-chain limits rather than to nothing.
     */
    onUnavailable: z.enum(["deny", "allow"]),
    timeoutMs: z.number().int().positive(),
  }),
  velocity: z.object({
    maxPaymentsPerMinute: z.number().int().positive(),
    /**
     * Payments in flight at once.
     *
     * The on-chain counters are consistent per transaction, so a burst cannot exceed a
     * window limit — the program evaluates each payment against committed state. Raising
     * this trades predictability for throughput, not safety.
     */
    maxConcurrent: z.number().int().positive(),
  }),
  outcomes: z.object({
    /**
     * Stop paying after an unresolved outcome, until the receipt is observed.
     *
     * Safe to disable *only* because `intent_id` is derived: a retry of the same payment
     * addresses the same receipt and the program refuses it. This is the clearest example
     * of the rule — a client-side guard may be relaxed when the property it protects is
     * independently guaranteed underneath.
     */
    quiesceOnIndeterminate: z.boolean(),
    resolveAttempts: z.number().int().positive(),
    resolveIntervalMs: z.number().int().positive(),
  }),
  disclosure: z.object({
    /**
     * Return program logs to the caller.
     *
     * Off in anything but local development: logs carry text an attacker can influence,
     * straight back into a model's context. The operator sink always receives them.
     */
    includeSimulationLogs: z.boolean(),
  }),
});

export type SecurityPosture = z.infer<typeof securityPostureSchema>;

export const SECURITY_PRESET_NAMES = ["sandbox", "balanced", "strict"] as const;
export type SecurityPresetName = (typeof SECURITY_PRESET_NAMES)[number];

/**
 * Three points on the spectrum.
 *
 * `balanced` is the default because it is the one that is right for most people: labels
 * required, hooks fail closed, logs withheld, and a review gate only at a value where a
 * human would want to look anyway.
 */
export const SECURITY_PRESETS: Record<SecurityPresetName, SecurityPosture> = {
  /** Prototyping. Every off-chain refusal relaxed; the on-chain floor unchanged. */
  sandbox: {
    destinations: { policy: "open", nearMissDistance: 0 },
    value: { bands: [] },
    hooks: { onUnavailable: "allow", timeoutMs: 2_000 },
    velocity: { maxPaymentsPerMinute: 60, maxConcurrent: 4 },
    outcomes: {
      quiesceOnIndeterminate: false,
      resolveAttempts: 4,
      resolveIntervalMs: 500,
    },
    disclosure: { includeSimulationLogs: true },
  },
  /** The default. Safe to run against real funds without being unusable. */
  balanced: {
    destinations: { policy: "labels-only", nearMissDistance: 2 },
    value: { bands: [{ above: "100", require: ["memo", "dry-run-first"] }] },
    hooks: { onUnavailable: "deny", timeoutMs: 2_000 },
    velocity: { maxPaymentsPerMinute: 12, maxConcurrent: 1 },
    outcomes: {
      quiesceOnIndeterminate: true,
      resolveAttempts: 8,
      resolveIntervalMs: 750,
    },
    disclosure: { includeSimulationLogs: false },
  },
  /** Treasury operations. Every band escalates; nothing large moves unattended. */
  strict: {
    destinations: { policy: "labels-only", nearMissDistance: 2 },
    value: {
      bands: [
        { above: "0", require: ["memo", "hooks"] },
        { above: "100", require: ["dry-run-first"] },
        { above: "1000", require: ["human-review"] },
      ],
    },
    hooks: { onUnavailable: "deny", timeoutMs: 2_000 },
    velocity: { maxPaymentsPerMinute: 6, maxConcurrent: 1 },
    outcomes: {
      quiesceOnIndeterminate: true,
      resolveAttempts: 8,
      resolveIntervalMs: 750,
    },
    disclosure: { includeSimulationLogs: false },
  },
};

export const DEFAULT_SECURITY_PRESET: SecurityPresetName = "balanced";

/** Lines describing a posture, for a startup log and for `get_policy`. */
export function describeSecurity(posture: SecurityPosture): string[] {
  const lines = [
    `destinations: ${
      {
        "labels-only": "registered labels only; raw addresses refused",
        "labels-preferred": "labels resolved; raw addresses left to the chain",
        open: "raw addresses accepted where the policy permits them",
      }[posture.destinations.policy]
    }`,
    `hooks: ${posture.hooks.onUnavailable === "deny" ? "fail closed" : "fail open"} after ${
      posture.hooks.timeoutMs
    }ms`,
    `velocity: ${posture.velocity.maxPaymentsPerMinute}/min, ${posture.velocity.maxConcurrent} in flight`,
    `unresolved outcome: ${
      posture.outcomes.quiesceOnIndeterminate ? "stops the session" : "reported, session continues"
    }`,
  ];

  for (const band of posture.value.bands) {
    lines.push(
      `above ${band.above}${band.mint ? ` ${band.mint}` : ""}: requires ${band.require.join(", ")}`,
    );
  }
  if (posture.disclosure.includeSimulationLogs) {
    lines.push("disclosure: simulation logs are returned to the caller (development only)");
  }
  return lines;
}
