// M1+ register their kinds here (generate-post, ...). Nothing reachable from this file may import
// sharp: build-worker.mjs bundles with esbuild, which cannot carry a native module.
import { SITE_REBUILD_KIND, siteRebuildHandler } from "@/blog/rebuild";
import { logAudit } from "@/lib/audit";
import { env } from "@/lib/env";
import type { Handlers } from "./cycle";

export const handlers: Handlers = {
  ping: async (payload, { db }) => void (await logAudit(db, { event: "worker.ping", payload })),
  // env() is read when the job runs, not when this module loads: importing the registry must not
  // demand a full environment (tests, and the build's module evaluation).
  [SITE_REBUILD_KIND]: (payload, ctx) => {
    const e = env();
    return siteRebuildHandler({ token: e.GITHUB_DISPATCH_TOKEN, repo: e.GITHUB_DISPATCH_REPO })(
      payload,
      ctx,
    );
  },
};
