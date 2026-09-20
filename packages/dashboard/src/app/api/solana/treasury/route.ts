import { solanaClusterSchema } from "@/lib/schema";
import { readTreasury } from "@/lib/server/solana";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const cluster = solanaClusterSchema.safeParse(url.searchParams.get("cluster"));
  const treasury = url.searchParams.get("address");
  if (!cluster.success || !treasury) {
    return Response.json({ error: "cluster e address são obrigatórios" }, { status: 400 });
  }
  try {
    const view = await readTreasury(cluster.data, url.searchParams.get("rpc"), treasury);
    if (!view)
      return Response.json({ error: "treasury não encontrada nesta rede" }, { status: 404 });
    return Response.json(view);
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "falha ao ler a treasury" },
      { status: 502 },
    );
  }
}
