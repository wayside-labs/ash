import { z } from "zod";
import { solanaClusterSchema } from "@/lib/schema";
import { serverT } from "@/lib/server/i18n";
import { confirmSignature } from "@/lib/server/solana";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  cluster: solanaClusterSchema,
  rpc: z.string().nullable().default(null),
  /** Base58 ed25519 signature, 64 bytes. */
  signature: z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{86,88}$/),
});

export async function POST(req: Request) {
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return Response.json(
      { error: await serverT("api.error.invalidPayload"), issues: parsed.error.issues },
      { status: 422 },
    );
  }
  const { cluster, rpc, signature } = parsed.data;
  try {
    return Response.json(await confirmSignature(cluster, rpc, signature));
  } catch (error) {
    return Response.json(
      {
        error: error instanceof Error ? error.message : await serverT("api.error.confirmFailed"),
      },
      { status: 502 },
    );
  }
}
