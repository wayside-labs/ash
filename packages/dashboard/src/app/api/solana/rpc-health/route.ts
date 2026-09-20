import { z } from "zod";
import { solanaClusterSchema } from "@/lib/schema";
import { checkRpc, resolveRpcUrl } from "@/lib/server/solana";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  cluster: solanaClusterSchema,
  rpc: z.string().nullable().default(null),
});

export async function POST(req: Request) {
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "payload inválido" }, { status: 422 });
  }
  const url = resolveRpcUrl(parsed.data.cluster, parsed.data.rpc);
  const result = await checkRpc(url);
  // `url` is echoed so the UI can say when a rejected custom RPC fell back.
  return Response.json({ ...result, url });
}
