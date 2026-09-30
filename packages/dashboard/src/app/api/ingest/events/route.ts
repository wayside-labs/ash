import { agentEventSchema, agentEventTreasury } from "@agent-rails/contract/alerts";
import { fanOut, readNotifyConfig, recordDeliveries } from "@/lib/server/notify";
import { authenticateIngest, opsStore } from "@/lib/server/ops";
import { hashToken } from "@/lib/server/ops/logic";
import { checkFixedWindow } from "@/lib/server/rate-limit";

export const dynamic = "force-dynamic";

/** Per token, per minute. An agent in a denial loop must not become a notification storm. */
const EVENTS_PER_MINUTE = 60;

/**
 * Where an agent's MCP reports to its operator (ADR-022). Bearer-authenticated by the
 * workflow's ingest token instead of `assertSameOrigin`: the caller is a process, not a
 * browser, and holds no cookie a hostile page could ride.
 *
 * An event is stored even when no channel delivers it — the dashboard's own Reviews and
 * Activity pages read from the store, not from the channels.
 */
export async function POST(req: Request) {
  const auth = await authenticateIngest(req);
  if (auth instanceof Response) return auth;
  const limited = checkFixedWindow(
    `ingest:${hashToken(auth.token).slice(0, 16)}`,
    EVENTS_PER_MINUTE,
  );
  if (limited) return limited;

  const parsed = agentEventSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return Response.json(
      { error: "invalid event", issues: parsed.error.issues.slice(0, 5) },
      { status: 422 },
    );
  }
  const event = parsed.data;

  const config = await readNotifyConfig(auth.scope);
  const treasury = config.treasuries.get(auth.workflowId);
  // A token speaks for one workflow. An event about another treasury is either a
  // misconfigured agent or a stolen token probing; either way it is not this workflow's.
  if (treasury && agentEventTreasury(event) !== treasury) {
    return Response.json({ error: "event treasury does not match the workflow" }, { status: 422 });
  }

  const { eventId, review } = await opsStore().recordEvent(auth.scope, auth.workflowId, event);
  const results = await fanOut(event, config, config.workflowNames.get(auth.workflowId));
  await recordDeliveries(auth.scope, results).catch(() => {});

  return Response.json(
    {
      event_id: eventId,
      ...(review ? { review: { id: review.id, status: review.status } } : {}),
      delivered: results.filter((r) => r.ok).length,
    },
    { status: 202 },
  );
}
