import { hostedSessionDenied } from "@/lib/server/auth/session";
import {
  bootstrapBodySchema,
  planTreasuryBootstrap,
  toBootstrapRequest,
} from "@/lib/server/bootstrap";
import { serverT } from "@/lib/server/i18n";
import { assertSameOrigin } from "@/lib/server/origin";
import { checkFixedWindow } from "@/lib/server/rate-limit";
import { SolanaRequestError } from "@/lib/server/solana";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const denied = assertSameOrigin(req);
  if (denied) return denied;
  const unauthenticated = await hostedSessionDenied();
  if (unauthenticated) return unauthenticated;
  const limited = checkFixedWindow("api");
  if (limited) return limited;

  const parsed = bootstrapBodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return Response.json(
      { error: await serverT("api.error.invalidPayload"), issues: parsed.error.issues },
      { status: 422 },
    );
  }

  try {
    const { cluster, rpc } = parsed.data;
    return Response.json(
      await planTreasuryBootstrap(cluster, rpc, toBootstrapRequest(parsed.data)),
    );
  } catch (error) {
    if (error instanceof SolanaRequestError) {
      return Response.json({ error: await serverT(error.messageKey) }, { status: 400 });
    }
    return Response.json(
      {
        error:
          error instanceof Error ? error.message : await serverT("api.error.buildBootstrapFailed"),
      },
      { status: 502 },
    );
  }
}
