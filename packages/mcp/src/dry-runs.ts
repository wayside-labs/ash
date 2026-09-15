/**
 * Which intents have been proposed before being paid.
 *
 * Backs the `dry-run-first` requirement: above a configured value, a payment must have been
 * through `check_payment` first. That is cheap to satisfy and rules out a whole class of
 * mistake, because the dry run resolves the same label, converts the same amount, runs the
 * same hooks and simulates the same instruction — so a large payment can never be the first
 * time a hallucinated destination or a mistyped amount is examined.
 *
 * Keyed by `intent_id`, which is derived from the payment itself, so the entry only matches
 * when the dry run and the payment are the same payment. A caller cannot satisfy the
 * requirement by dry-running something cheap and then sending something else.
 *
 * In-process and short-lived on purpose: this is a sequencing check, not an audit record.
 * A restart loses it, and the worst outcome is that a caller dry-runs once more.
 */
export type DryRunLedger = {
  record(intentId: string): void;
  has(intentId: string): boolean;
  readonly size: number;
};

const DEFAULT_TTL_MS = 15 * 60 * 1000;
const MAX_ENTRIES = 1_000;

export function createDryRunLedger(
  options: { ttlMs?: number; now?: () => number } = {},
): DryRunLedger {
  const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
  const now = options.now ?? (() => Date.now());
  const seen = new Map<string, number>();

  const prune = () => {
    const cutoff = now() - ttlMs;
    for (const [intentId, at] of seen) {
      if (at <= cutoff) seen.delete(intentId);
    }
    // Bounded regardless of TTL, so a looping caller cannot grow this without limit.
    while (seen.size > MAX_ENTRIES) {
      const oldest = seen.keys().next().value;
      if (oldest === undefined) break;
      seen.delete(oldest);
    }
  };

  return {
    record(intentId: string) {
      seen.set(intentId, now());
      prune();
    },
    has(intentId: string) {
      const at = seen.get(intentId);
      if (at === undefined) return false;
      if (at <= now() - ttlMs) {
        seen.delete(intentId);
        return false;
      }
      return true;
    },
    get size() {
      prune();
      return seen.size;
    },
  };
}
