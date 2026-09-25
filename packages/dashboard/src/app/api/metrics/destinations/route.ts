/**
 * The allowlist roster behind §3 (docs/product/metrics-page.md §G).
 *
 * Destination contacts are not a dashboard concept: they are `AllowlistEntry`
 * PDAs, and the SDK already reads them for the CLI. This route exposes that read
 * so the browser keeps its hands off the RPC.
 *
 * Read-only. No instruction builder is reachable from here, and
 * `privileged-surface.test.ts` enforces that mechanically.
 */

import { destinationContactSchema } from "@/lib/metrics/schema";
import { isLikelyAddress, solanaClusterSchema } from "@/lib/schema";
import { serverT } from "@/lib/server/i18n";
import { readDestinations } from "@/lib/server/solana";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const cluster = solanaClusterSchema.safeParse(url.searchParams.get("cluster"));
  const policy = url.searchParams.get("policy");

  if (!cluster.success || !policy || !isLikelyAddress(policy)) {
    return Response.json(
      { error: await serverT("api.error.clusterAddressRequired") },
      { status: 400 },
    );
  }

  try {
    const entries = await readDestinations(cluster.data, url.searchParams.get("rpc"), policy);
    const contacts = entries.map((entry) =>
      destinationContactSchema.parse({
        ...entry,
        policy,
        perTxMaxOverrideRaw: entry.perTxMaxOverride,
        // Phase A knows exactly who may be paid, and nothing about what was paid
        // to them. `null` is "not known" — the UI must not render it as "never".
        paid: null,
        demo: false,
      }),
    );
    return Response.json({ contacts });
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error ? error.message : await serverT("api.error.metricsReadFailed"),
      },
      { status: 502 },
    );
  }
}
