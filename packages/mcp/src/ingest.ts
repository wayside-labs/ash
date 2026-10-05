import type { AgentEvent } from "@ash/contract/alerts";
import { postAgentEvent } from "@ash/sdk";
import type { ServerContext } from "./context.js";

/** Fire-and-forget: the dashboard being down must never stop or slow a payment. */
export function emitAgentEvent(context: ServerContext, event: AgentEvent): void {
  const ingest = context.runtime.config.ingest;
  if (!ingest) return;
  void postAgentEvent(`${ingest.url}/events`, ingest.token, event).catch(() => {});
}

export type ReviewDecision = "approved" | "rejected" | "pending" | "none" | "unavailable";

/**
 * What a person decided about this exact payment. Keyed by intent id, which the payment's
 * own arguments derive — an approval cannot be stretched to a different amount, destination
 * or reference, and it cannot pay twice because the receipt settles an intent once.
 *
 * `unavailable` (no dashboard configured, unreachable, or a malformed answer) is treated by
 * the caller exactly like `pending`: fail closed.
 */
export async function fetchReviewDecision(
  context: ServerContext,
  intentIdHex: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ReviewDecision> {
  const ingest = context.runtime.config.ingest;
  if (!ingest) return "unavailable";
  try {
    const res = await fetchImpl(`${ingest.url}/reviews/${intentIdHex}`, {
      headers: { Authorization: `Bearer ${ingest.token}` },
      signal: AbortSignal.timeout(5_000),
    });
    if (res.status === 404) return "none";
    if (!res.ok) return "unavailable";
    const body = (await res.json()) as { status?: unknown };
    return body.status === "approved" || body.status === "rejected" || body.status === "pending"
      ? body.status
      : "unavailable";
  } catch {
    return "unavailable";
  }
}
