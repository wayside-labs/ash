import { z } from "zod";
import { solanaClusterSchema } from "@/lib/schema";
import { getVaultBalances } from "@/lib/server/solana";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  cluster: solanaClusterSchema,
  rpc: z.string().nullable().default(null),
  treasuries: z.array(z.string()).max(50),
});

export async function POST(req: Request) {
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "payload inválido" }, { status: 422 });
  }
  const { cluster, rpc, treasuries } = parsed.data;
  return Response.json({ vaults: await getVaultBalances(cluster, rpc, treasuries) });
}
