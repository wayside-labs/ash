import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { seedState } from "@/lib/server/seed";
import { agentToRow, mcpToRow, skillToRow, workflowToRow } from "./map";

/**
 * Inserts the same first-run demo rows as `seedState()`, with UUID primary keys
 * and remapped workflow/agent foreign keys.
 */
export async function seedPostgresOrg(supabase: SupabaseClient, orgId: string): Promise<void> {
  const seed = seedState();
  const workflowIds = new Map<string, string>();

  for (const workflow of seed.workflows) {
    workflowIds.set(workflow.id, randomUUID());
  }

  const workflows = seed.workflows.map((workflow) =>
    workflowToRow(
      {
        ...workflow,
        id: workflowIds.get(workflow.id) ?? randomUUID(),
        createdAt: workflow.createdAt,
      },
      orgId,
    ),
  );

  const agents = seed.agents.map((agent) =>
    agentToRow(
      {
        ...agent,
        id: randomUUID(),
        workflowId: workflowIds.get(agent.workflowId) ?? agent.workflowId,
        createdAt: agent.createdAt,
      },
      orgId,
    ),
  );

  const mcps = seed.mcps.map((mcp) =>
    mcpToRow(
      {
        ...mcp,
        id: randomUUID(),
        env: {},
      },
      orgId,
    ),
  );

  const skills = seed.skills.map((skill) =>
    skillToRow(
      {
        ...skill,
        id: randomUUID(),
      },
      orgId,
    ),
  );

  const { error: workflowError } = await supabase.from("workflows").insert(workflows);
  if (workflowError) throw workflowError;

  const { error: agentError } = await supabase.from("agents").insert(agents);
  if (agentError) throw agentError;

  if (mcps.length > 0) {
    const { error: mcpError } = await supabase.from("mcp_servers").insert(mcps);
    if (mcpError) throw mcpError;
  }

  if (skills.length > 0) {
    const { error: skillError } = await supabase.from("skills").insert(skills);
    if (skillError) throw skillError;
  }
}
