import { documentsInScope, searchKnowledge } from "@/lib/server/knowledge";
import { userOpsScope } from "@/lib/server/ops";
import { stateAccessResponse } from "@/lib/server/state/access";
import { readState } from "@/lib/server/store";

export const dynamic = "force-dynamic";

/** The operator's own test search, with the same scoping an agent would get. */
export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  const query = params.get("q")?.trim() ?? "";
  if (!query) return Response.json({ hits: [], mode: "empty" });
  try {
    const state = await readState();
    const workflow = state.workflows.find((w) => w.id === params.get("workflowId"));
    const agent = state.agents.find((a) => a.id === params.get("agentId"));
    const docs = documentsInScope(state.rag, workflow, agent);
    return Response.json(await searchKnowledge(await userOpsScope(), docs, query, 8));
  } catch (error) {
    const denied = stateAccessResponse(error);
    if (denied) return denied;
    throw error;
  }
}
