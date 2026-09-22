import { z } from "zod";
import { solanaClusterSchema } from "@/lib/schema";
import { serverT } from "@/lib/server/i18n";
import { assertSameOrigin } from "@/lib/server/origin";
import { checkFixedWindow } from "@/lib/server/rate-limit";
import { getVaultBalances } from "@/lib/server/solana";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  cluster: solanaClusterSchema,
  rpc: z.string().nullable().default(null),
  treasuries: z.array(z.string()).max(50),
});

export async function POST(req: Request) {
  const denied = assertSameOrigin(req);
  if (denied) return denied;
  const limited = checkFixedWindow("api");
  if (limited) return limited;

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return Response.json(
      { error: await serverT("api.error.invalidPayload"), issues: parsed.error.issues },
      { status: 422 },
    );
  }
  const { cluster, rpc, treasuries } = parsed.data;
  return Response.json(await getVaultBalances(cluster, rpc, treasuries));
}
