import { opsStore, type ReviewStatus, userOpsScope } from "@/lib/server/ops";
import { stateAccessResponse } from "@/lib/server/state/access";

export const dynamic = "force-dynamic";

const STATUSES = new Set<ReviewStatus>(["pending", "approved", "rejected"]);

export async function GET(req: Request) {
  const raw = new URL(req.url).searchParams.get("status");
  const status = raw && STATUSES.has(raw as ReviewStatus) ? (raw as ReviewStatus) : undefined;
  try {
    const reviews = await opsStore().listReviews(await userOpsScope(), status);
    return Response.json({ reviews, now: new Date().toISOString() });
  } catch (error) {
    const denied = stateAccessResponse(error);
    if (denied) return denied;
    throw error;
  }
}
