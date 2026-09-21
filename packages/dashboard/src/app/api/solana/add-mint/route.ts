import { z } from "zod";
import { addressSchema, solanaClusterSchema } from "@/lib/schema";
import { serverT } from "@/lib/server/i18n";
import { buildAddMint, SolanaRequestError } from "@/lib/server/solana";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  cluster: solanaClusterSchema,
  rpc: z.string().nullable().default(null),
  treasury: addressSchema,
  wallet: addressSchema,
  mint: addressSchema,
});

export async function POST(req: Request) {
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return Response.json(
      { error: await serverT("api.error.invalidPayload"), issues: parsed.error.issues },
      { status: 422 },
    );
  }
  const { cluster, rpc, treasury, wallet, mint } = parsed.data;
  try {
    const built = await buildAddMint(cluster, rpc, { treasury, wallet, mint });
    return Response.json(built);
  } catch (error) {
    if (error instanceof SolanaRequestError) {
      return Response.json({ error: await serverT(error.messageKey) }, { status: 400 });
    }
    return Response.json(
      {
        error:
          error instanceof Error ? error.message : await serverT("api.error.buildAddMintFailed"),
      },
      { status: 502 },
    );
  }
}
