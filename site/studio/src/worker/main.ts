import { publishDueTick } from "@/blog/publish-due";
import { requeueLostRebuild } from "@/blog/rebuild";
import { db } from "@/db/client";
import { runCycle } from "./cycle";
import { handlers } from "./handlers";

const EVERY_MS = 60_000;
let stopping = false;
for (const sig of ["SIGTERM", "SIGINT"] as const) process.on(sig, () => void (stopping = true));

// A fixed name keeps one heartbeat row across container restarts (hostname changes each time).
const worker = process.env.WORKER_NAME ?? "studio-worker";
while (!stopping) {
  try {
    const res = await runCycle(db(), handlers, {
      worker,
      shouldStop: () => stopping,
      // In this order: a post published by the first tick enqueues its own rebuild, so the second
      // one finds a job waiting and stays out of the way.
      ticks: { "publish-due": publishDueTick, "rebuild-retry": requeueLostRebuild },
    });
    if (res.processed || res.failed) console.log(JSON.stringify({ at: "cycle", ...res }));
    if (res.timedOut) {
      // The timed-out handler may still be running; exiting is what actually stops it. Docker's
      // restart policy brings the worker back.
      console.error(JSON.stringify({ at: "worker", exiting: "handler timeout" }));
      process.exit(1);
    }
  } catch (err) {
    // A cycle that cannot even reach the database must not kill the loop; the missing heartbeat
    // is what turns /api/health red.
    console.error(
      JSON.stringify({ at: "cycle", fatal: err instanceof Error ? err.message : String(err) }),
    );
  }
  const until = Date.now() + EVERY_MS;
  while (!stopping && Date.now() < until) await new Promise((r) => setTimeout(r, 1_000));
}
process.exit(0);
