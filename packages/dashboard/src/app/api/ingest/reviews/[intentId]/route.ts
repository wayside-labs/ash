import { authenticateIngest, opsStore } from "@/lib/server/ops";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ intentId: string }> };

/**
 * The MCP asks, before holding a payment again, whether a person decided about it. Scoped to
 * the token's workflow: a token cannot read another workflow's approvals.
 */
export async function GET(req: Request, { params }: Params) {
  const auth = await authenticateIngest(req);
  if (auth instanceof Response) return auth;
  const { intentId } = await params;
  if (!/^[0-9a-f]{32}$/.test(intentId)) {
    return Response.json({ error: "intent id must be 32 lowercase hex" }, { status: 400 });
  }
  const review = await opsStore().reviewForIntent(auth.scope, auth.workflowId, intentId);
  if (!review) return Response.json({ error: "no live review" }, { status: 404 });
  return Response.json({
    status: review.status,
    decided_at: review.decidedAt,
    expires_at: review.expiresAt,
  });
}
