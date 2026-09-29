import { serverT } from "@/lib/server/i18n";
import { ingestBaseUrl, opsStore, userOpsScope } from "@/lib/server/ops";
import { assertSameOrigin } from "@/lib/server/origin";
import { stateAccessResponse } from "@/lib/server/state/access";
import { readState } from "@/lib/server/store";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

async function withWorkflow(
  id: string,
  fn: (scope: Awaited<ReturnType<typeof userOpsScope>>) => Promise<Response>,
): Promise<Response> {
  try {
    const state = await readState();
    if (!state.workflows.some((row) => row.id === id)) {
      return Response.json({ error: await serverT("api.error.notFound") }, { status: 404 });
    }
    return await fn(await userOpsScope());
  } catch (error) {
    const denied = stateAccessResponse(error);
    if (denied) return denied;
    throw error;
  }
}

/** Token history for the workflow: hints and dates, never a token. */
export async function GET(req: Request, { params }: Params) {
  const { id } = await params;
  return withWorkflow(id, async (scope) =>
    Response.json({
      ingest_url: ingestBaseUrl(req),
      tokens: await opsStore().listTokens(scope, id),
    }),
  );
}

/**
 * Rotate: issue a new token and retire the live one. The new token is in this response and
 * nowhere else — re-export the runner config (or paste it) to hand it to the agent.
 */
export async function POST(req: Request, { params }: Params) {
  const denied = assertSameOrigin(req);
  if (denied) return denied;
  const { id } = await params;
  return withWorkflow(id, async (scope) => {
    const issued = await opsStore().issueToken(scope, id);
    return Response.json({ ...issued, ingest_url: ingestBaseUrl(req) }, { status: 201 });
  });
}

/** Revoke without replacing: the workflow's agents stop reporting until the next export. */
export async function DELETE(req: Request, { params }: Params) {
  const denied = assertSameOrigin(req);
  if (denied) return denied;
  const { id } = await params;
  const tokenId = new URL(req.url).searchParams.get("tokenId");
  if (!tokenId) {
    return Response.json({ error: await serverT("api.error.invalidPayload") }, { status: 400 });
  }
  return withWorkflow(id, async (scope) => {
    const revoked = await opsStore().revokeToken(scope, tokenId);
    return Response.json({ revoked }, { status: revoked ? 200 : 404 });
  });
}
