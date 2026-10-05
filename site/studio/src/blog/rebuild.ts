// Reached by the worker bundle (esbuild): nothing imported here may pull in sharp or
// sanitize-html.
import { sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { absorbDue, enqueue } from "@/jobs/queue";
import { logAudit } from "@/lib/audit";
import type { Handler } from "@/worker/run-job";

export const SITE_REBUILD_KIND = "site-rebuild";
const KIND = SITE_REBUILD_KIND;
// What .github/workflows of the site listens for (repository_dispatch types).
const EVENT_TYPE = "studio-publish";
const TIMEOUT_MS = 15_000;
// Lets a burst of publishes and edits finish before the site builds.
const DELAY_MS = 60_000;
const BUCKET_MS = 60_000;
// The queue's default of 3 gives up after 90 s (30 s + 60 s), and a dead rebuild is a published
// post that never reaches the site. With 10, the nine waits between attempts (30 s doubling up to
// the 1 h cap of backoffMs: 30 s, 1, 2, 4, 8, 16, 32 min, 1 h, 1 h) add up to about 3 h 03 min
// of GitHub being down before the job dies. A dead job shows in /api/health.
const MAX_ATTEMPTS = 10;

// Pass the transaction of the write that changed what the site shows: the job then exists if and
// only if the change was committed.
//
// The dedupe key carries the minute of runAfter, not just the kind. The queue's dedupe index
// covers running jobs too, so with one fixed key a change committed while a rebuild was running
// would enqueue nothing and never be built. With the bucket: a job only runs once its runAfter
// has passed, so a request arriving at or after that moment gets a runAfter at least one delay
// later, which is a later bucket, and is enqueued. The cost is that two requests on either side
// of a minute boundary become two builds.
export async function enqueueSiteRebuild(db: Db, now: Date = new Date()): Promise<string | null> {
  const runAfter = new Date(now.getTime() + DELAY_MS);
  return enqueue(db, {
    kind: KIND,
    dedupeKey: `${KIND}:${Math.floor(runAfter.getTime() / BUCKET_MS)}`,
    runAfter,
    maxAttempts: MAX_ATTEMPTS,
  });
}

// Runs inside the transaction that records the outcome. Every queued rebuild that was already
// due asked for what was just done (or just skipped), so it leaves the queue with this one.
async function settle(
  ctx: { db: Db; jobId: string; now: Date },
  event: string,
  payload: Record<string, unknown>,
): Promise<void> {
  await ctx.db.transaction(async (tx) => {
    const absorbed = await absorbDue(tx, { kind: KIND, except: ctx.jobId, now: ctx.now });
    await logAudit(tx, { event, payload: { jobId: ctx.jobId, ...payload, absorbed } });
  });
}

// A step of every worker cycle. A rebuild job that used up its attempts is a change the site
// never received, and nothing retries a dead job: /api/health shows it for 24 h and then forgets,
// while the site stays stale until the next publish. This asks again.
//
// "Lost" is read from what already exists: a site-rebuild job died after the last time the
// handler recorded a dispatch or a skip (the audit rows it writes), and no rebuild is waiting or
// running now. The dead job is the marker of the change, rather than the newest updated_at of a
// published post, because an unpublish, or a category rename, also needs the build and leaves no
// published row behind to show it.
//
// One query per cycle, on indexed columns. It cannot flood: the new job goes through the same
// bucket dedupe, and while it is queued or running this finds nothing to do. If that job dies
// too, about three hours later, the next cycle asks once more.
//
// The two clocks compared are the worker's (jobs.updated_at) and the database's
// (audit_log.created_at); they are on the same host, and the gap between a death and a success
// is minutes at least.
export async function requeueLostRebuild(db: Db, now: Date = new Date()): Promise<string | null> {
  const rows = await db.execute<{ lost: boolean }>(sql`
    select (
      exists (
        select 1 from jobs j
        where j.kind = ${KIND} and j.status = 'dead'
          and j.updated_at > coalesce(
            (select max(a.created_at) from audit_log a
             where a.event in ('site.rebuild_dispatched', 'site.rebuild_skipped')),
            '-infinity'::timestamptz)
      )
      and not exists (
        select 1 from jobs j where j.kind = ${KIND} and j.status in ('queued', 'running')
      )
    ) as lost`);
  if (rows[0]?.lost !== true) return null;
  return db.transaction(async (tx) => {
    const jobId = await enqueueSiteRebuild(tx, now);
    // null is the dedupe saying a job for this minute already exists (it slipped in between the
    // query above and here): nothing was requeued, so the audit must not say it was.
    if (jobId === null) return null;
    await logAudit(tx, { event: "site.rebuild_requeued", payload: { jobId } });
    return jobId;
  });
}

const messageOf = (err: unknown) => (err instanceof Error ? err.message : String(err));

// The handler asks GitHub to build the site (repository_dispatch); the site's workflow does the
// rest. Dependencies come in as arguments so the tests never touch the network.
//
// Without a token the job is a recorded no-op: the rebuild stays off until the token exists, and
// the audit log says so instead of the queue filling with dead jobs.
//
// A throw sends the job back to the queue with backoff. The token is in exactly one place, the
// Authorization header: the error carries the HTTP status and never the response body, and a
// network error has the token struck out of its message before it is rethrown, because that
// message ends up in jobs.last_error, in the heartbeat and in the logs.
//
// repository_dispatch has no idempotency key. A job that runs twice (lost lease, timeout) builds
// the site twice, which costs a build and changes nothing.
export function siteRebuildHandler(deps: {
  token: string | undefined;
  repo: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}): Handler {
  return async (_payload, ctx) => {
    const { token, repo } = deps;
    if (!token) {
      await settle(ctx, "site.rebuild_skipped", { reason: "GITHUB_DISPATCH_TOKEN is not set" });
      return;
    }

    const send = deps.fetch ?? fetch;
    let response: Response;
    try {
      response = await send(`https://api.github.com/repos/${repo}/dispatches`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          accept: "application/vnd.github+json",
          "x-github-api-version": "2022-11-28",
          "content-type": "application/json",
          // GitHub refuses requests without one.
          "user-agent": "ash-studio",
        },
        body: JSON.stringify({ event_type: EVENT_TYPE, client_payload: { jobId: ctx.jobId } }),
        signal: AbortSignal.any([ctx.signal, AbortSignal.timeout(deps.timeoutMs ?? TIMEOUT_MS)]),
        // A redirect would resend the Authorization header to wherever it points.
        redirect: "error",
      });
    } catch (err) {
      // A new Error on purpose, without `cause`: the original may carry the request.
      throw new Error(`github dispatch failed: ${messageOf(err).replaceAll(token, "[token]")}`);
    }
    // Never read: nothing in it is needed, and an error page must not end up in a message. The
    // cancel frees the connection.
    await response.body?.cancel().catch(() => {});
    // Anything that is not 2xx, a stray 3xx included.
    if (!response.ok) throw new Error(`github dispatch failed: HTTP ${response.status}`);

    await settle(ctx, "site.rebuild_dispatched", { repo, eventType: EVENT_TYPE });
  };
}
