import { opsStore, userOpsScope } from "@/lib/server/ops";
import { stateAccessResponse } from "@/lib/server/state/access";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const events = await opsStore().listEvents(await userOpsScope());
    return Response.json({ events });
  } catch (error) {
    const denied = stateAccessResponse(error);
    if (denied) return denied;
    throw error;
  }
}
