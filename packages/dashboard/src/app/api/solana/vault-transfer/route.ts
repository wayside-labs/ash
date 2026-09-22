import { z } from "zod";
import { addressSchema, solanaClusterSchema } from "@/lib/schema";
import { serverT } from "@/lib/server/i18n";
import { assertSameOrigin } from "@/lib/server/origin";
import { checkFixedWindow } from "@/lib/server/rate-limit";
import { buildVaultTransfer, SolanaRequestError } from "@/lib/server/solana";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  cluster: solanaClusterSchema,
  rpc: z.string().nullable().default(null),
  kind: z.enum(["deposit", "withdraw"]),
  treasury: addressSchema,
  wallet: addressSchema,
  /** Lamports as a decimal string — a u64 does not survive JSON as a number. */
  lamports: z.string().regex(/^\d+$/),
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
  const { cluster, rpc, kind, treasury, wallet, lamports } = parsed.data;
  try {
    const built = await buildVaultTransfer(cluster, rpc, {
      kind,
      treasury,
      wallet,
      lamports: BigInt(lamports),
    });
    return Response.json(built);
  } catch (error) {
    if (error instanceof SolanaRequestError) {
      return Response.json({ error: await serverT(error.messageKey) }, { status: 400 });
    }
    return Response.json(
      {
        error:
          error instanceof Error ? error.message : await serverT("api.error.buildTransferFailed"),
      },
      { status: 502 },
    );
  }
}
