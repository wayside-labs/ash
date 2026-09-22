import { randomUUID } from "node:crypto";
import type { DashboardState } from "@/lib/schema";
import type { PostgresStateContext } from "./context";
import {
  agentFromRow,
  agentToRow,
  apiKeyFromRow,
  apiKeyToRow,
  assembleState,
  integrationFromRow,
  integrationToRow,
  mcpFromRow,
  mcpToRow,
  profileFromRow,
  profileToRow,
  ragFromRow,
  ragToRow,
  settingsFromRow,
  settingsToRow,
  skillFromRow,
  skillToRow,
  workflowFromRow,
  workflowToRow,
} from "./map";
import { seedPostgresOrg } from "./seed-postgres";

async function deleteOrphans(
  supabase: PostgresStateContext["supabase"],
  table: string,
  orgId: string,
  keepIds: string[],
): Promise<void> {
  const { data: existing, error } = await supabase.from(table).select("id").eq("org_id", orgId);
  if (error) throw error;
  const remove = (existing ?? [])
    .map((row) => row.id as string)
    .filter((id) => !keepIds.includes(id));
  if (remove.length === 0) return;
  const { error: deleteError } = await supabase.from(table).delete().in("id", remove);
  if (deleteError) throw deleteError;
}

async function deleteAccountOrphans(
  supabase: PostgresStateContext["supabase"],
  accountId: string,
  keepIds: string[],
): Promise<void> {
  const { data: existing, error } = await supabase
    .from("api_keys")
    .select("id")
    .eq("account_id", accountId);
  if (error) throw error;
  const remove = (existing ?? [])
    .map((row) => row.id as string)
    .filter((id) => !keepIds.includes(id));
  if (remove.length === 0) return;
  const { error: deleteError } = await supabase.from("api_keys").delete().in("id", remove);
  if (deleteError) throw deleteError;
}

export async function readState(ctx: PostgresStateContext): Promise<DashboardState> {
  const { supabase, orgId, accountId } = ctx;

  const [workflows, agents, mcps, rag, skills, integrations, apiKeys, profile, settings] =
    await Promise.all([
      supabase.from("workflows").select("*").eq("org_id", orgId).order("created_at"),
      supabase.from("agents").select("*").eq("org_id", orgId).order("created_at"),
      supabase.from("mcp_servers").select("*").eq("org_id", orgId).order("created_at"),
      supabase.from("rag_documents").select("*").eq("org_id", orgId).order("created_at"),
      supabase.from("skills").select("*").eq("org_id", orgId).order("created_at"),
      supabase.from("integrations").select("*").eq("org_id", orgId).order("created_at"),
      supabase
        .from("api_keys")
        .select("id, account_id, provider, created_at")
        .eq("account_id", accountId),
      supabase.from("profiles").select("*").eq("account_id", accountId).maybeSingle(),
      supabase.from("settings").select("*").eq("account_id", accountId).maybeSingle(),
    ]);

  for (const result of [
    workflows,
    agents,
    mcps,
    rag,
    skills,
    integrations,
    apiKeys,
    profile,
    settings,
  ]) {
    if (result.error) throw result.error;
  }

  return assembleState({
    workflows: (workflows.data ?? []).map((row) => workflowFromRow(row)),
    agents: (agents.data ?? []).map((row) => agentFromRow(row)),
    mcps: (mcps.data ?? []).map((row) => mcpFromRow(row)),
    rag: (rag.data ?? []).map((row) => ragFromRow(row)),
    skills: (skills.data ?? []).map((row) => skillFromRow(row)),
    integrations: (integrations.data ?? []).map((row) => integrationFromRow(row)),
    apiKeys: (apiKeys.data ?? []).map((row) => apiKeyFromRow(row)),
    profile: profileFromRow(profile.data),
    settings: settingsFromRow(settings.data),
  });
}

export async function writeState(ctx: PostgresStateContext, state: DashboardState): Promise<void> {
  const { supabase, orgId, accountId } = ctx;

  await deleteOrphans(
    supabase,
    "workflows",
    orgId,
    state.workflows.map((row) => row.id),
  );
  if (state.workflows.length > 0) {
    const { error } = await supabase
      .from("workflows")
      .upsert(state.workflows.map((row) => workflowToRow(row, orgId)));
    if (error) throw error;
  }

  await deleteOrphans(
    supabase,
    "agents",
    orgId,
    state.agents.map((row) => row.id),
  );
  if (state.agents.length > 0) {
    const { error } = await supabase
      .from("agents")
      .upsert(state.agents.map((row) => agentToRow(row, orgId)));
    if (error) throw error;
  }

  await deleteOrphans(
    supabase,
    "mcp_servers",
    orgId,
    state.mcps.map((row) => row.id),
  );
  if (state.mcps.length > 0) {
    const { error } = await supabase
      .from("mcp_servers")
      .upsert(state.mcps.map((row) => mcpToRow(row, orgId)));
    if (error) throw error;
  }

  await deleteOrphans(
    supabase,
    "rag_documents",
    orgId,
    state.rag.map((row) => row.id),
  );
  if (state.rag.length > 0) {
    const { error } = await supabase
      .from("rag_documents")
      .upsert(state.rag.map((row) => ragToRow(row, orgId)));
    if (error) throw error;
  }

  await deleteOrphans(
    supabase,
    "skills",
    orgId,
    state.skills.map((row) => row.id),
  );
  if (state.skills.length > 0) {
    const { error } = await supabase
      .from("skills")
      .upsert(state.skills.map((row) => skillToRow(row, orgId)));
    if (error) throw error;
  }

  await deleteOrphans(
    supabase,
    "integrations",
    orgId,
    state.integrations.map((row) => row.id),
  );
  if (state.integrations.length > 0) {
    const { error } = await supabase
      .from("integrations")
      .upsert(state.integrations.map((row) => integrationToRow(row, orgId)));
    if (error) throw error;
  }

  await deleteAccountOrphans(
    supabase,
    accountId,
    state.apiKeys.map((row) => row.id),
  );
  if (state.apiKeys.length > 0) {
    const { error } = await supabase.from("api_keys").upsert(
      state.apiKeys.map((row) => apiKeyToRow(row, accountId)),
      {
        onConflict: "account_id,provider",
      },
    );
    if (error) throw error;
  }

  const { error: profileError } = await supabase
    .from("profiles")
    .upsert(profileToRow(state.profile, accountId));
  if (profileError) throw profileError;

  const { error: settingsError } = await supabase
    .from("settings")
    .upsert(settingsToRow(state.settings, accountId));
  if (settingsError) throw settingsError;
}

export async function mutateState<T>(
  ctx: PostgresStateContext,
  fn: (state: DashboardState) => T | Promise<T>,
): Promise<{ state: DashboardState; result: T }> {
  const current = await readState(ctx);
  const draft = structuredClone(current);
  const result = await fn(draft);
  await writeState(ctx, draft);
  return { state: draft, result };
}

export async function resetState(ctx: PostgresStateContext): Promise<DashboardState> {
  const { supabase, orgId } = ctx;

  const tables = [
    "agents",
    "workflows",
    "mcp_servers",
    "rag_documents",
    "skills",
    "integrations",
  ] as const;
  for (const table of tables) {
    const { error } = await supabase.from(table).delete().eq("org_id", orgId);
    if (error) throw error;
  }

  await seedPostgresOrg(supabase, orgId);
  return readState(ctx);
}

export function newId(): string {
  return randomUUID();
}
