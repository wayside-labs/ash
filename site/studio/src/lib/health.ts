export type Check = { ok: boolean; detail: string };
export type Health = {
  // Everything below is fine. This is what a person, or an alert, should look at.
  ok: boolean;
  // The process answers, reaches the database and the worker beats: what a container healthcheck
  // and the deploy gate need. A dead job must show here as `ok: false`, but it must not restart
  // the app or keep the tunnel from coming up.
  live: boolean;
  version: string;
  // Whether publishing triggers a site build. "off" is a valid state (no token yet), so it is
  // shown, not judged.
  rebuild: "on" | "off";
  checks: { db: Check; worker: Check; email: Check; cycle: Check; jobs: Check };
};

const WORKER_STALE_MS = 180_000;
const MAX_ERROR_LENGTH = 200;

// This answer is readable by anything on the Docker network (see lib/hosts.ts), so the error is
// trimmed to what locates the problem: one line, capped, and without the "params:" tail that
// drizzle appends to a failed query, which holds row values.
function publicError(raw: string): string {
  const head = raw.split("\nparams:")[0] ?? "";
  const line = head.split("\n")[0] ?? "";
  return line.slice(0, MAX_ERROR_LENGTH);
}

export function evaluateHealth(i: {
  version: string;
  nodeEnv: string;
  dbOk: boolean;
  heartbeatAt: Date | null;
  now: Date;
  emailDriver: "none" | "mock" | "smtp";
  // The newest heartbeat's last_error: a failed job or tick in the worker's latest cycle.
  lastError: string | null;
  // Jobs that used up every attempt in the last 24 h. Nothing retries a dead job: without this,
  // a rebuild that died is a published post that silently never reaches the site.
  deadJobs: { kind: string; count: number }[];
  rebuild: "on" | "off";
}): Health {
  const age = i.heartbeatAt ? i.now.getTime() - i.heartbeatAt.getTime() : null;
  const dead = i.deadJobs.reduce((sum, d) => sum + d.count, 0);
  const vital = {
    db: { ok: i.dbOk, detail: i.dbOk ? "reachable" : "unreachable" },
    worker:
      age === null
        ? { ok: false, detail: "no heartbeat yet" }
        : { ok: age <= WORKER_STALE_MS, detail: `last beat ${Math.round(age / 1000)}s ago` },
    // A mock that answers ok:true in production is how boringco lost mail without noticing.
    email:
      i.emailDriver === "mock" && i.nodeEnv === "production"
        ? { ok: false, detail: "mock driver in production" }
        : { ok: true, detail: i.emailDriver === "none" ? "not wired yet" : i.emailDriver },
  };
  const checks = {
    ...vital,
    cycle:
      i.lastError === null
        ? { ok: true, detail: "no error in the last cycle" }
        : { ok: false, detail: `last cycle: ${publicError(i.lastError)}` },
    jobs:
      dead === 0
        ? { ok: true, detail: "no dead job in the last 24 h" }
        : {
            ok: false,
            detail: `${dead} dead in the last 24 h (${i.deadJobs
              .map((d) => `${d.kind}: ${d.count}`)
              .join(", ")})`,
          },
  };
  return {
    ok: Object.values(checks).every((c) => c.ok),
    live: Object.values(vital).every((c) => c.ok),
    version: i.version,
    rebuild: i.rebuild,
    checks,
  };
}
