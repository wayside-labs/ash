import { DESTINATION_MODE_ALLOWLIST } from "../bound-context.js";
import type { ServerContext } from "../context.js";

/**
 * The destinations this session can pay, by name.
 *
 * Without this tool a caller has no way to name a payee except by writing an address, which
 * is the one thing a model must never author (blueprint II-1). Publishing the labels is
 * what makes label-only payment usable.
 */
export type ListDestinationsResponse = {
  policy: string;
  destination_mode: "allowlist" | "any";
  count: number;
  destinations: Array<{
    label: string;
    owner: string;
    per_tx_max_override?: string;
  }>;
  message: string;
};

export function handleListDestinations(context: ServerContext): ListDestinationsResponse {
  const allowlisted = context.bound.destinationMode === DESTINATION_MODE_ALLOWLIST;

  return {
    policy: context.bound.policy,
    destination_mode: allowlisted ? "allowlist" : "any",
    count: context.bound.destinations.entries.length,
    destinations: context.bound.destinations.entries.map((entry) => ({
      label: entry.label,
      owner: String(entry.owner),
      ...(entry.perTxMaxOverride > 0n
        ? { per_tx_max_override: entry.perTxMaxOverride.toString() }
        : {}),
    })),
    message: allowlisted
      ? "Pay by label. Addresses are not accepted under this policy."
      : "This policy permits any destination. Registered labels are listed for convenience.",
  };
}
