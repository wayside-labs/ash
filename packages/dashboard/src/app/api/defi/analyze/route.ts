import { defiAnalyzeRequestSchema } from "@agent-rails/contract/defi-intents";
import { solanaClusterSchema } from "@/lib/schema";
import { analyzeDeFiIntent } from "@/lib/server/defi/analyze";
import { serverT } from "@/lib/server/i18n";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const parsed = defiAnalyzeRequestSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: await serverT("api.error.invalidPayload") }, { status: 422 });
  }

  const cluster = solanaClusterSchema.safeParse(parsed.data.cluster);
  if (!cluster.success) {
    return Response.json({ error: await serverT("api.error.invalidPayload") }, { status: 422 });
  }

  try {
    const result = await analyzeDeFiIntent({
      text: parsed.data.text,
      cluster: cluster.data,
      rpc: parsed.data.rpc,
      treasuryAddress: parsed.data.treasuryAddress,
    });
    return Response.json(result);
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error ? error.message : await serverT("api.error.readTreasuryFailed"),
      },
      { status: 502 },
    );
  }
}
