/**
 * Payment history for Metrics §5 (docs/product/metrics-page.md §G).
 *
 * Walks `getSignaturesForAddress(session)` and parses `PaymentExecuted` events
 * from inner instructions. Complete only within this RPC's log retention.
 */

import { paymentHistorySchema } from "@/lib/metrics/schema";
import { solanaClusterSchema } from "@/lib/schema";
import { serverT } from "@/lib/server/i18n";
import { verifiedThroughBySession } from "@/lib/server/metrics-audit";
import { fetchPaymentHistory } from "@/lib/server/metrics-history";
import { buildSessionContexts, parseHistoryParams } from "@/lib/server/metrics-history-request";
import { checkFixedWindow } from "@/lib/server/rate-limit";
import { readTreasury } from "@/lib/server/solana";

export const dynamic = "force-dynamic";

const MAX_SESSIONS = 10;

export async function GET(req: Request) {
  const limited = checkFixedWindow("api");
  if (limited) return limited;

  const url = new URL(req.url);
  const cluster = solanaClusterSchema.safeParse(url.searchParams.get("cluster"));
  if (!cluster.success) {
    return Response.json(
      { error: await serverT("api.error.clusterAddressRequired") },
      { status: 400 },
    );
  }

  const params = parseHistoryParams(url);
  const sessions = params.sessions.slice(0, MAX_SESSIONS);

  if (sessions.length === 0) {
    return Response.json(
      paymentHistorySchema.parse({
        records: [],
        complete: true,
        oldestSlot: null,
        truncatedBy: null,
        before: null,
      }),
    );
  }

  const contexts = await buildSessionContexts({
    cluster: cluster.data,
    rpc: params.rpc,
    sessions,
    treasuries: params.treasuries,
    workflowId: params.workflowId,
    agentId: params.agentId,
  });

  try {
    const history = await fetchPaymentHistory({
      cluster: cluster.data,
      customRpc: params.rpc,
      sessions: contexts,
      before: params.before,
      limit: Number.isFinite(params.limit) ? params.limit : 20,
      outcome: params.outcome,
      destination: params.destination,
    });
    const auditSessions: { session: string; auditHead: string }[] = [];
    for (const treasuryAddress of params.treasuries) {
      const treasury = await readTreasury(cluster.data, params.rpc, treasuryAddress);
      if (!treasury) continue;
      for (const sessionAddress of sessions) {
        const session = treasury.sessions.find((row) => row.address === sessionAddress);
        if (session) auditSessions.push({ session: session.address, auditHead: session.auditHead });
      }
    }
    const parsed = paymentHistorySchema.safeParse({
      ...history,
      verifiedThrough: verifiedThroughBySession(history.records, auditSessions),
    });
    if (!parsed.success) {
      return Response.json(
        { error: await serverT("api.error.metricsReadFailed") },
        { status: 502 },
      );
    }
    return Response.json(parsed.data);
  } catch {
    return Response.json({ error: await serverT("api.error.historyUnavailable") }, { status: 502 });
  }
}
