import { z } from "zod";
import { solanaClusterSchema } from "@/lib/schema";
import { getBalances } from "@/lib/server/solana";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  cluster: solanaClusterSchema,
  rpc: z.string().nullable().default(null),
  addresses: z.array(z.string()).max(100),
});

export async function POST(req: Request) {
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return Response.json(
      { error: "payload inválido", issues: parsed.error.issues },
      { status: 422 },
    );
  }
  const { cluster, rpc, addresses } = parsed.data;
  return Response.json({ balances: await getBalances(cluster, rpc, addresses) });
}
