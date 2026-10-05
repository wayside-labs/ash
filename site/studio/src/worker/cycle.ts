import { lte } from "drizzle-orm";
import type { Db } from "@/db/client";
import { workerHeartbeat } from "@/db/schema";
import { claimNext, reapExpired } from "@/jobs/queue";
import { type Handlers, runJob } from "./run-job";

export type { Handler, HandlerCtx, Handlers } from "./run-job";

async function beat(
  db: Db,
  worker: string,
  now: Date,
  startedMs: number,
  lastError: string | null,
) {
  const row = { beatAt: now, lastCycleMs: Date.now() - startedMs, lastError };
  await db
    .insert(workerHeartbeat)
    .values({ worker, ...row })
    // An older beat (e.g. a slow interval tick) must never overwrite a newer one.
    .onConflictDoUpdate({
      target: workerHeartbeat.worker,
      set: row,
      setWhere: lte(workerHeartbeat.beatAt, row.beatAt),
    });
}

export type Tick = (db: Db, now: Date) => Promise<unknown>;

function warningOf(result: unknown): string | null {
  if (typeof result !== "object" || result === null || !("warning" in result)) return null;
  return typeof result.warning === "string" ? result.warning : null;
}

const messageOf = (err: unknown) => (err instanceof Error ? err.message : String(err));

export async function runCycle(
  db: Db,
  handlers: Handlers,
  opts: {
    worker: string;
    maxJobs?: number;
    now?: () => Date;
    leaseMs?: number;
    shouldStop?: () => boolean;
    // How often to beat while a handler runs; a long job must not look like a dead worker.
    heartbeatMs?: number;
    // Steps that run once per cycle, before the queue (e.g. publishing what is due). Unlike a
    // job, a tick has no row to retry from: it simply runs again next cycle.
    ticks?: Record<string, Tick>;
  },
): Promise<{ processed: number; failed: number; timedOut: boolean }> {
  const now = opts.now ?? (() => new Date());
  const leaseMs = opts.leaseMs ?? 5 * 60_000;
  const started = Date.now();
  let processed = 0;
  let failed = 0;
  let timedOut = false;
  let lastError: string | null = null;
  let bodyError: unknown;
  let threw = false;
  // Everything that went wrong in this cycle, in order, not just the last thing: a job failing
  // after a tick warned must not erase the warning. Capped: it is one column of one row.
  const report = (message: string) => {
    lastError = (lastError === null ? message : `${lastError}; ${message}`).slice(0, 2000);
  };

  try {
    await reapExpired(db, now());
    for (const [name, tick] of Object.entries(opts.ticks ?? {})) {
      if (opts.shouldStop?.()) break;
      try {
        // A tick that did its work but found something a person must look at says so with
        // { warning }: same destination as an error, without being one.
        const warning = warningOf(await tick(db, now()));
        if (warning !== null) {
          report(`tick ${name}: ${warning}`);
          console.error(JSON.stringify({ at: "worker", tick: name, warning }));
        }
      } catch (err) {
        // A broken tick must not hold the queue hostage. It is logged and lands in the
        // heartbeat's last_error, which is where a cycle's failures are already looked for.
        report(`tick ${name}: ${messageOf(err)}`);
        console.error(JSON.stringify({ at: "worker", tick: name, error: messageOf(err) }));
      }
    }
    for (let i = 0; i < (opts.maxJobs ?? 20); i++) {
      // Checked before each claim so SIGTERM never starts a job it cannot finish.
      if (opts.shouldStop?.()) break;
      await beat(db, opts.worker, now(), started, lastError);
      const job = await claimNext(db, now(), leaseMs);
      if (!job) break;
      const ticker = setInterval(() => {
        beat(db, opts.worker, now(), started, lastError).catch((err) =>
          console.error(JSON.stringify({ at: "worker", heartbeat: messageOf(err) })),
        );
      }, Math.max(50, opts.heartbeatMs ?? 30_000));
      let out: Awaited<ReturnType<typeof runJob>>;
      try {
        out = await runJob(db, job, handlers, { leaseMs, now });
      } finally {
        clearInterval(ticker);
      }
      if (out.result === "processed") processed++;
      if (out.result === "failed" || out.result === "timeout") failed++;
      if (out.error) report(out.error);
      if (out.result === "timeout") {
        // The handler may still be running; keep claiming and two jobs could overlap. The worker
        // process exits after this cycle (main.ts).
        timedOut = true;
        break;
      }
    }
  } catch (err) {
    threw = true;
    bodyError = err;
    report(messageOf(err));
  }

  try {
    await beat(db, opts.worker, now(), started, lastError);
  } catch (err) {
    // When the body failed or a handler timed out, that outcome is what the caller must see (the
    // timeout makes main.ts exit); a beat error must not replace it.
    if (!threw && !timedOut) throw err;
    console.error(JSON.stringify({ at: "worker", heartbeat: messageOf(err) }));
  }
  if (threw) throw bodyError;
  return { processed, failed, timedOut };
}
