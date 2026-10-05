import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import { env, siteRebuild } from "@/lib/env";
import { evaluateHealth } from "@/lib/health";

export const dynamic = "force-dynamic";

const DAY_MS = 24 * 3_600_000;

// Two questions, one body. Plain GET answers "is anything wrong?" and is 503 while a check is
// red; the body always names the check and why. `?probe=live` answers "is the process up?" and
// is what the container healthcheck and the deploy gate ask: a job that died yesterday must be
// visible, but must not restart the app or keep the tunnel from starting.
export async function GET(request: Request) {
  const e = env();
  const now = new Date();
  let dbOk = false;
  let heartbeatAt: Date | null = null;
  let lastError: string | null = null;
  let deadJobs: { kind: string; count: number }[] = [];
  try {
    const beats = await db().execute<{ beat_at: string; last_error: string | null }>(
      sql`select beat_at, last_error from worker_heartbeat order by beat_at desc limit 1`,
    );
    dbOk = true;
    heartbeatAt = beats[0] ? new Date(beats[0].beat_at) : null;
    lastError = beats[0]?.last_error ?? null;
    // updated_at is when the job died: fail() and the reaper both set it with the status.
    const dead = await db().execute<{ kind: string; count: number }>(sql`
      select kind, count(*)::int as count from jobs
      where status = 'dead' and updated_at > ${new Date(now.getTime() - DAY_MS).toISOString()}::timestamptz
      group by kind order by count(*) desc, kind`);
    deadJobs = dead.map((d) => ({ kind: d.kind, count: Number(d.count) }));
  } catch (err) {
    dbOk = false;
    console.error(
      JSON.stringify({ at: "health", db: err instanceof Error ? err.message : String(err) }),
    );
  }
  const h = evaluateHealth({
    version: e.APP_VERSION,
    nodeEnv: e.NODE_ENV,
    dbOk,
    heartbeatAt,
    now,
    emailDriver: e.EMAIL_DRIVER,
    lastError,
    deadJobs,
    rebuild: siteRebuild(e),
  });
  const live = new URL(request.url).searchParams.get("probe") === "live";
  return Response.json(h, {
    status: (live ? h.live : h.ok) ? 200 : 503,
    headers: { "cache-control": "no-store" },
  });
}
