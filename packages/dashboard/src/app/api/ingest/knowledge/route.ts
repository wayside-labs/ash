import { documentsInScope, searchKnowledge } from "@/lib/server/knowledge";
import { readKnowledgeRows } from "@/lib/server/knowledge/service";
import { authenticateIngest } from "@/lib/server/ops";
import { hashToken } from "@/lib/server/ops/logic";
import { checkFixedWindow } from "@/lib/server/rate-limit";

export const dynamic = "force-dynamic";

/**
 * `search_knowledge` for an agent's knowledge MCP. The token fixes the workflow; `agent`
 * narrows to that agent's scope within it. An agent can name another agent of the same
 * workflow — the token is the trust boundary, as it is for events — but never reach
 * another workflow's documents.
 *
 * What comes back is text an operator indexed from anywhere, so the MCP labels it as
 * untrusted reference material; nothing here makes it instructions.
 */
export async function GET(req: Request) {
  const auth = await authenticateIngest(req);
  if (auth instanceof Response) return auth;
  const limited = checkFixedWindow(`knowledge:${hashToken(auth.token).slice(0, 16)}`, 60);
  if (limited) return limited;

  const params = new URL(req.url).searchParams;
  const query = params.get("q")?.trim() ?? "";
  const k = Math.min(Math.max(Number(params.get("k") ?? 5) || 5, 1), 10);
  if (!query || query.length > 500) {
    return Response.json({ error: "q is required (max 500 characters)" }, { status: 400 });
  }
  const rows = await readKnowledgeRows(auth.scope);
  const workflow = rows.workflows.find((w) => w.id === auth.workflowId);
  if (!workflow) return Response.json({ error: "workflow not found" }, { status: 404 });
  const agentName = params.get("agent")?.trim();
  const agent = agentName
    ? rows.agents.find((a) => a.workflowId === workflow.id && a.name === agentName)
    : undefined;
  const docs = documentsInScope(rows.docs, workflow, agent);
  return Response.json(await searchKnowledge(auth.scope, docs, query, k));
}
