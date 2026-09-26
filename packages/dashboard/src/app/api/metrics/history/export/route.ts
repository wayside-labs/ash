/**
 * Payment history export for Metrics §5.
 *
 * Same walk as `/api/metrics/history`, but returns a downloadable blob with
 * counts in headers for the toast.
 */

import { paymentsToCsv, paymentsToJson } from "@/lib/metrics/csv";
import { toPaymentRecord } from "@/lib/metrics/history-aggregate";
import { solanaClusterSchema } from "@/lib/schema";
import { serverT } from "@/lib/server/i18n";
import { fetchPaymentHistory } from "@/lib/server/metrics-history";
import { buildSessionContexts, parseHistoryParams } from "@/lib/server/metrics-history-request";
import { checkFixedWindow } from "@/lib/server/rate-limit";

export const dynamic = "force-dynamic";

const MAX_SESSIONS = 10;
const EXPORT_LIMIT = 100;

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

  const format = url.searchParams.get("format") ?? "csv";
  if (format !== "csv" && format !== "json") {
    return Response.json({ error: await serverT("api.error.invalidPayload") }, { status: 400 });
  }

  const params = parseHistoryParams(url);
  const sessions = params.sessions.slice(0, MAX_SESSIONS);
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
      limit: EXPORT_LIMIT,
      outcome: params.outcome,
      destination: params.destination,
    });
    const records = history.records.map(toPaymentRecord);
    const payload = format === "csv" ? paymentsToCsv(records) : paymentsToJson(records);
    const filename = `agent-rails-payments-${new Date().toISOString().slice(0, 10)}.${format}`;

    return new Response(payload, {
      status: 200,
      headers: {
        "Content-Type": format === "csv" ? "text/csv; charset=utf-8" : "application/json",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "X-Metrics-Records": String(records.length),
        "X-Metrics-Complete": history.complete ? "true" : "false",
      },
    });
  } catch {
    return Response.json({ error: await serverT("api.error.historyUnavailable") }, { status: 502 });
  }
}
