import type { StoredAgent, StoredRagDocument, StoredWorkflow } from "@/lib/schema";
import { createAdminClient } from "@/lib/supabase/admin";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import type { OpsScope } from "../ops";
import {
  type AgentRow,
  agentFromRow,
  type RagRow,
  ragFromRow,
  type WorkflowRow,
  workflowFromRow,
} from "../state/map";
import * as json from "../store-json";

/**
 * Documents, workflows and agents read with no user session, for the bearer-authenticated
 * knowledge route. The token already fixed the org and the workflow; this only loads rows.
 */
export async function readKnowledgeRows(scope: OpsScope): Promise<{
  docs: StoredRagDocument[];
  workflows: StoredWorkflow[];
  agents: StoredAgent[];
}> {
  if (scope.kind === "json" || !isSupabaseConfigured()) {
    const state = await json.readState();
    return { docs: state.rag, workflows: state.workflows, agents: state.agents };
  }
  const db = createAdminClient();
  const [docs, workflows, agents] = await Promise.all([
    db.from("rag_documents").select("*").eq("org_id", scope.orgId),
    db.from("workflows").select("*").eq("org_id", scope.orgId),
    db.from("agents").select("*").eq("org_id", scope.orgId),
  ]);
  return {
    docs: ((docs.data ?? []) as RagRow[]).map(ragFromRow),
    workflows: ((workflows.data ?? []) as WorkflowRow[]).map(workflowFromRow),
    agents: ((agents.data ?? []) as AgentRow[]).map(agentFromRow),
  };
}
