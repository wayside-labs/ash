import { and, eq, lte, ne, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { jobs } from "@/db/schema";

export type Job = {
  id: string;
  kind: string;
  payload: Record<string, unknown>;
  attempts: number;
  maxAttempts: number;
};

// Thrown when a worker finishes a job whose lease it no longer holds (reaped and possibly claimed
// again): the attempt number fences stale workers out of the newer attempt's row.
export class LostLeaseError extends Error {
  constructor(jobId: string, attempt: number) {
    super(`lost lease on job ${jobId} (attempt ${attempt})`);
    this.name = "LostLeaseError";
  }
}

// postgres-js cannot bind a raw Date inside a sql`` template (typed drizzle columns can), so the
// raw statements pass ISO strings and cast them.
const iso = (d: Date) => d.toISOString();

export const backoffMs = (attempt: number) => Math.min(30_000 * 2 ** (attempt - 1), 3_600_000);

export async function enqueue(
  db: Db,
  job: {
    kind: string;
    payload?: Record<string, unknown>;
    runAfter?: Date;
    dedupeKey?: string;
    maxAttempts?: number;
  },
): Promise<string | null> {
  const rows = await db
    .insert(jobs)
    .values({
      kind: job.kind,
      payload: job.payload ?? {},
      runAfter: job.runAfter ?? new Date(),
      dedupeKey: job.dedupeKey ?? null,
      maxAttempts: job.maxAttempts ?? 3,
    })
    .onConflictDoNothing({
      target: jobs.dedupeKey,
      where: sql`status in ('queued','running')`,
    })
    .returning({ id: jobs.id });
  return rows[0]?.id ?? null;
}

// For kinds whose jobs all ask for the same thing ("build the site as it is now"): the job that
// just did the work marks as done every other queued job of its kind that was already due. One
// run then answers a whole backlog, instead of one run per job after an outage.
//
// Only jobs with run_after <= now: a job due later may stand for a change that came after the
// work was done. The status condition is re-checked under the row lock, so a job another worker
// claimed in the meantime is left alone.
export async function absorbDue(
  db: Db,
  opts: { kind: string; except: string; now: Date },
): Promise<number> {
  const rows = await db
    .update(jobs)
    .set({ status: "done", updatedAt: opts.now })
    .where(
      and(
        eq(jobs.kind, opts.kind),
        eq(jobs.status, "queued"),
        lte(jobs.runAfter, opts.now),
        ne(jobs.id, opts.except),
      ),
    )
    .returning({ id: jobs.id });
  return rows.length;
}

// SKIP LOCKED is what boringco's dispatcher lacked: two overlapping runs could send twice.
export async function claimNext(db: Db, now: Date, leaseMs = 5 * 60_000): Promise<Job | null> {
  const rows = await db.execute<{
    id: string;
    kind: string;
    payload: Record<string, unknown>;
    attempts: number;
    max_attempts: number;
  }>(sql`
    update jobs set status = 'running', attempts = attempts + 1,
      locked_until = ${iso(new Date(now.getTime() + leaseMs))}::timestamptz,
      updated_at = ${iso(now)}::timestamptz
    where id = (
      select id from jobs
      where status = 'queued' and run_after <= ${iso(now)}::timestamptz
      order by run_after, created_at
      limit 1
      for update skip locked
    )
    returning id, kind, payload, attempts, max_attempts`);
  const r = rows[0];
  return r
    ? {
        id: r.id,
        kind: r.kind,
        payload: r.payload,
        attempts: r.attempts,
        maxAttempts: r.max_attempts,
      }
    : null;
}

export async function complete(db: Db, job: Job, now: Date): Promise<void> {
  const rows = await db
    .update(jobs)
    .set({ status: "done", lockedUntil: null, updatedAt: now })
    .where(and(eq(jobs.id, job.id), eq(jobs.status, "running"), eq(jobs.attempts, job.attempts)))
    .returning({ id: jobs.id });
  if (rows.length !== 1) throw new LostLeaseError(job.id, job.attempts);
}

export async function fail(db: Db, job: Job, error: string, now: Date): Promise<void> {
  const dead = job.attempts >= job.maxAttempts;
  const rows = await db
    .update(jobs)
    .set({
      status: dead ? "dead" : "queued",
      lastError: error.slice(0, 2000),
      lockedUntil: null,
      runAfter: dead ? now : new Date(now.getTime() + backoffMs(job.attempts)),
      updatedAt: now,
    })
    .where(and(eq(jobs.id, job.id), eq(jobs.status, "running"), eq(jobs.attempts, job.attempts)))
    .returning({ id: jobs.id });
  if (rows.length !== 1) throw new LostLeaseError(job.id, job.attempts);
}

// A worker that died mid-job leaves a lease behind; the job goes back to the queue, or dies if it
// already used every attempt (a job that crashes the worker must not loop forever).
// The SQL backoff below (least(30000 * 2^(attempts-1), 3600000) ms) must mirror backoffMs above;
// change them together.
export async function reapExpired(db: Db, now: Date): Promise<void> {
  await db.execute(sql`
    update jobs set
      status = case when attempts >= max_attempts then 'dead' else 'queued' end,
      last_error = 'lease expired (attempt ' || attempts || ')',
      run_after = case when attempts >= max_attempts then run_after
        else ${iso(now)}::timestamptz
          + least(30000 * power(2, attempts - 1), 3600000) * interval '1 millisecond' end,
      locked_until = null, updated_at = ${iso(now)}::timestamptz
    where status = 'running' and locked_until < ${iso(now)}::timestamptz`);
}
