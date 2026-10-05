import type { Db } from "@/db/client";
import { type Job, LostLeaseError, complete, fail } from "@/jobs/queue";

// Handler contract:
// - A handler MUST honour `signal`: it aborts shortly before the lease expires, and the cycle
//   cannot cancel a promise, only stop waiting for it. After a timeout the worker process exits
//   (the restart policy brings it back), which is what really ends a handler that ignored it.
// - External side effects (mail, API calls, publishing) MUST be idempotent, keyed by `jobId`: a
//   job can run again after a timeout, a lost lease or a crash.
export type HandlerCtx = {
  db: Db;
  now: Date;
  signal: AbortSignal;
  jobId: string;
  attempt: number;
};
export type Handler = (payload: Record<string, unknown>, ctx: HandlerCtx) => Promise<void>;
export type Handlers = Record<string, Handler>;

export type JobOutcome = {
  result: "processed" | "failed" | "lost" | "timeout";
  // What went wrong, for the heartbeat: the handler's message when it failed or timed out, or
  // the bookkeeping's (complete/fail) when that is what broke. null when the job was processed
  // or its lease was lost.
  error: string | null;
};

class HandlerTimeoutError extends Error {}

const log = (fields: Record<string, unknown>) =>
  console.error(JSON.stringify({ at: "worker", ...fields }));
const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

export async function runJob(
  db: Db,
  job: Job,
  handlers: Handlers,
  opts: { leaseMs: number; now: () => Date },
): Promise<JobOutcome> {
  // The handler must be cut off before the lease runs out, or a slow handler would race the reaper.
  const margin = Math.min(15_000, opts.leaseMs / 2);
  const deadlineMs = opts.leaseMs - margin;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), deadlineMs);

  let handlerError: unknown;
  let handlerFailed = false;
  try {
    const handler = handlers[job.kind];
    if (!handler) throw new Error(`no handler for kind "${job.kind}"`);
    const timedOut = new Promise<never>((_, reject) => {
      controller.signal.addEventListener("abort", () =>
        reject(
          new HandlerTimeoutError(`handler timed out after ${Math.round(deadlineMs / 1000)}s`),
        ),
      );
    });
    await Promise.race([
      handler(job.payload, {
        db,
        now: opts.now(),
        signal: controller.signal,
        jobId: job.id,
        attempt: job.attempts,
      }),
      timedOut,
    ]);
  } catch (err) {
    handlerFailed = true;
    handlerError = err;
  } finally {
    clearTimeout(timer);
  }

  // complete/fail get their own try so a bookkeeping error is never mistaken for a handler error
  // (which would call fail on a job that already succeeded).
  if (!handlerFailed) {
    try {
      await complete(db, job, opts.now());
      return { result: "processed", error: null };
    } catch (err) {
      if (err instanceof LostLeaseError) {
        log({ job: job.id, lost_lease: true });
        return { result: "lost", error: null };
      }
      log({ job: job.id, kind: job.kind, error: message(err) });
      return { result: "failed", error: message(err) };
    }
  }

  const handlerMessage = message(handlerError);
  const timedOut = handlerError instanceof HandlerTimeoutError;
  log({ job: job.id, kind: job.kind, error: handlerMessage });
  try {
    await fail(db, job, handlerMessage, opts.now());
    return { result: timedOut ? "timeout" : "failed", error: handlerMessage };
  } catch (err) {
    if (err instanceof LostLeaseError) {
      log({ job: job.id, lost_lease: true });
      return { result: timedOut ? "timeout" : "lost", error: null };
    }
    log({ job: job.id, kind: job.kind, error: message(err) });
    return { result: timedOut ? "timeout" : "failed", error: message(err) };
  }
}
