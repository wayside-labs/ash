import { z } from "zod";
import { addressSchema, solanaClusterSchema } from "@/lib/schema";
import { serverT } from "@/lib/server/i18n";
import { buildActivateSecurityPolicy, SolanaRequestError } from "@/lib/server/solana";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  cluster: solanaClusterSchema,
  rpc: z.string().nullable().default(null),
  treasury: addressSchema,
  wallet: addressSchema,
  policy: addressSchema,
  mint: addressSchema,
  fundingMode: z.enum(["isolatedVault", "nativeAllowance"]),
  amountCap: z.string().regex(/^\d+$/).optional(),
  expiryTs: z.string().regex(/^\d+$/).optional(),
  maxPerTransaction: z.string().regex(/^\d+$/),
  dailyLimit: z.string().regex(/^\d+$/),
  allowlist: z.array(addressSchema).min(1),
});

export async function POST(req: Request) {
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return Response.json(
      { error: await serverT("api.error.invalidPayload"), issues: parsed.error.issues },
      { status: 422 },
    );
  }
  const {
    cluster,
    rpc,
    treasury,
    wallet,
    policy,
    mint,
    fundingMode,
    amountCap,
    expiryTs,
    maxPerTransaction,
    dailyLimit,
    allowlist,
  } = parsed.data;

  try {
    const built = await buildActivateSecurityPolicy(cluster, rpc, {
      treasury,
      wallet,
      policy,
      mint,
      fundingMode,
      ...(amountCap ? { allowanceCap: BigInt(amountCap) } : {}),
      ...(expiryTs ? { expiryTs: BigInt(expiryTs) } : {}),
      maxPerTransaction: BigInt(maxPerTransaction),
      dailyLimit: BigInt(dailyLimit),
      allowlist,
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
            : await serverT("api.error.buildSecurityPolicyFailed"),
      },
      { status: 502 },
    );
  }
}
