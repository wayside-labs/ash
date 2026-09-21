import { z } from "zod";
import { addressSchema, solanaClusterSchema } from "@/lib/schema";
import { serverT } from "@/lib/server/i18n";
import { buildEnableNativeAllowance, SolanaRequestError } from "@/lib/server/solana";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  cluster: solanaClusterSchema,
  rpc: z.string().nullable().default(null),
  treasury: addressSchema,
  wallet: addressSchema,
  mint: addressSchema,
  /** Base units as a decimal string — u64 does not survive JSON as a number. */
  amountCap: z.string().regex(/^\d+$/),
  /** Unix timestamp (seconds) as a decimal string. */
  expiryTs: z.string().regex(/^\d+$/),
});

export async function POST(req: Request) {
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return Response.json(
      { error: await serverT("api.error.invalidPayload"), issues: parsed.error.issues },
      { status: 422 },
    );
  }
  const { cluster, rpc, treasury, wallet, mint, amountCap, expiryTs } = parsed.data;
  try {
    const built = await buildEnableNativeAllowance(cluster, rpc, {
      treasury,
      wallet,
      mint,
      amountCap: BigInt(amountCap),
      expiryTs: BigInt(expiryTs),
    });
    return Response.json(built);
  } catch (error) {
    if (error instanceof SolanaRequestError) {
      return Response.json({ error: await serverT(error.messageKey) }, { status: 400 });
    }
    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : await serverT("api.error.buildNativeAllowanceFailed"),
      },
      { status: 502 },
    );
  }
}
