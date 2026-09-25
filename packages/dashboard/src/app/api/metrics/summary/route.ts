/**
 * The Metrics page's one aggregate read (docs/product/metrics-page.md §G).
 *
 * Server-side rather than composed from the existing hooks, for three reasons in
 * order of weight: the custom-RPC allowlist is enforced here and the browser
 * never holds an RPC URL; the page needs three fan-outs across N treasuries and
 * doing that client-side is an N-deep waterfall that re-runs on every period
 * change; and `exactness` has to be decided in one place, which is the only
 * place all the inputs exist at once.
 *
 * Read-only. No instruction builder is reachable from this file, and
 * `privileged-surface.test.ts` enforces that mechanically.
 */

import { foldMetrics } from "@/lib/metrics/fold";
import { metricsPeriodSchema, metricsSummarySchema } from "@/lib/metrics/schema";
import { solanaClusterSchema } from "@/lib/schema";
import { serverT } from "@/lib/server/i18n";
import { getSolUsdPrice } from "@/lib/server/price";
import { getVaultBalances, readTreasury } from "@/lib/server/solana";

export const dynamic = "force-dynamic";

/** One page's worth of vaults. Beyond this the caller is not a dashboard. */
const MAX_TREASURIES = 25;

function list(value: string | null): string[] {
  return (value ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const cluster = solanaClusterSchema.safeParse(url.searchParams.get("cluster"));
  if (!cluster.success) {
    return Response.json(
      { error: await serverT("api.error.clusterAddressRequired") },
      { status: 400 },
    );
  }

  const period = metricsPeriodSchema.safeParse(url.searchParams.get("period") ?? "short-window");
  if (!period.success) {
    return Response.json({ error: await serverT("api.error.invalidPayload") }, { status: 400 });
  }

  const rpc = url.searchParams.get("rpc");
  const treasuries = [...new Set(list(url.searchParams.get("treasuries")))].slice(
    0,
    MAX_TREASURIES,
  );
  const sessions = list(url.searchParams.get("sessions"));
  const mint = url.searchParams.get("mint");

  // One treasury failing must not take the others with it: a partial read is
  // reported through `unreadable` so the UI can say a total is incomplete,
  // rather than folding the failure in as a zero.
  const reads = await Promise.all(
    treasuries.map(async (treasury) => {
      try {
        const view = await readTreasury(cluster.data, rpc, treasury);
        return view
          ? ({ ok: true, view } as const)
          : ({
              ok: false,
              treasury,
              detail: await serverT("api.error.treasuryNotFound"),
            } as const);
      } catch (error) {
        return {
          ok: false,
          treasury,
          detail:
            error instanceof Error ? error.message : await serverT("api.error.metricsReadFailed"),
        } as const;
      }
    }),
  );

  const readable = reads.flatMap((read) => (read.ok ? [read.view] : []));
  const unreadable = reads.flatMap((read) =>
    read.ok ? [] : [{ treasury: read.treasury, detail: read.detail }],
  );

  // Balances and price are best-effort in exactly the way the page is designed
  // to render: no price means token-only amounts, not a broken page.
  const [vaults, price] = await Promise.all([
    treasuries.length === 0
      ? Promise.resolve(null)
      : getVaultBalances(cluster.data, rpc, treasuries, null).catch(() => null),
    getSolUsdPrice().catch(() => null),
  ]);

  const summary = foldMetrics({
    cluster: cluster.data,
    asOf: new Date().toISOString(),
    scope: {
      workflowId: url.searchParams.get("workflowId"),
      agentId: url.searchParams.get("agentId"),
      mint,
    },
    period: period.data,
    treasuries: readable,
    vaults: vaults?.vaults ?? [],
    price,
    sessionFilter: sessions.length === 0 ? null : sessions,
    unreadable,
  });

  // Parsed before it is sent, so a shape drift fails here rather than rendering
  // NaN in somebody's browser.
  const parsed = metricsSummarySchema.safeParse(summary);
  if (!parsed.success) {
    return Response.json({ error: await serverT("api.error.metricsReadFailed") }, { status: 502 });
  }
  return Response.json(parsed.data);
}
