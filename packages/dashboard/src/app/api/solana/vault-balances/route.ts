import { z } from "zod";
import { solanaClusterSchema } from "@/lib/schema";
import { serverT } from "@/lib/server/i18n";
import { getVaultBalances } from "@/lib/server/solana";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  cluster: solanaClusterSchema,
  rpc: z.string().nullable().default(null),
  treasuries: z.array(z.string()).max(50),
  /** Connected wallet, when there is one: its token accounts come back too. */
  owner: z.string().nullable().default(null),
});

export async function POST(req: Request) {
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return Response.json(
      { error: await serverT("api.error.invalidPayload"), issues: parsed.error.issues },
      { status: 422 },
    );
  }
  const { cluster, rpc, treasuries, owner } = parsed.data;
  return Response.json(await getVaultBalances(cluster, rpc, treasuries, owner));
}
