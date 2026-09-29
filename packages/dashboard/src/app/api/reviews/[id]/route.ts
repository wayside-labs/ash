import { z } from "zod";
import { serverT } from "@/lib/server/i18n";
import { actorOf, opsStore, userOpsScope } from "@/lib/server/ops";
import { assertSameOrigin } from "@/lib/server/origin";
import { stateAccessResponse } from "@/lib/server/state/access";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

const bodySchema = z.object({ decision: z.enum(["approved", "rejected"]) });

/**
 * A person's decision on one review. Approving a payment review releases exactly that
 * intent the next time the agent submits it; approving a limit request records the answer
 * and changes no limit — raising one is still `policy set` on the CLI or the Limits page.
 */
export async function POST(req: Request, { params }: Params) {
  const denied = assertSameOrigin(req);
  if (denied) return denied;
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: await serverT("api.error.invalidPayload") }, { status: 422 });
  }
  const { id } = await params;
  try {
    const scope = await userOpsScope();
    const review = await opsStore().decideReview(scope, id, parsed.data.decision, actorOf(scope));
    if (!review) {
      return Response.json({ error: "not pending, lapsed, or not found" }, { status: 409 });
    }
    return Response.json({ review });
  } catch (error) {
    const stateDenied = stateAccessResponse(error);
    if (stateDenied) return stateDenied;
    throw error;
  }
}
