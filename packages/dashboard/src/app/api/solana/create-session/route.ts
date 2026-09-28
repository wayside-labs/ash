import { z } from "zod";
import { addressSchema, solanaClusterSchema } from "@/lib/schema";
import { serverT } from "@/lib/server/i18n";
import { assertSameOrigin } from "@/lib/server/origin";
import { checkFixedWindow } from "@/lib/server/rate-limit";
import { buildCreateSession, SolanaRequestError } from "@/lib/server/solana";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  cluster: solanaClusterSchema,
  rpc: z.string().nullable().default(null),
  treasury: addressSchema,
  wallet: addressSchema,
  sessionKey: addressSchema,
  label: z.string().min(1),
  policy: addressSchema.nullable().optional(),
  sessionTtlHours: z.number().int().positive().default(24),
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

  const { cluster, rpc, treasury, wallet, sessionKey, label, policy, sessionTtlHours } =
    parsed.data;
  try {
    const built = await buildCreateSession(cluster, rpc, {
      treasury,
      wallet,
      sessionKey,
      label,
      policy: policy ?? null,
      sessionTtlHours,
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
            : await serverT("api.error.buildCreateSessionFailed"),
      },
      { status: 502 },
    );
  }
}
