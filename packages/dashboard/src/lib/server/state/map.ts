import type {
  DashboardState,
  Profile,
  Settings,
  StoredAgent,
  StoredApiKey,
  StoredIntegration,
  StoredMcp,
  StoredRagDocument,
  StoredSkill,
  StoredWorkflow,
} from "@/lib/schema";

export type WorkflowRow = {
  id: string;
  org_id: string;
  name: string;
  description: string;
  icon: string;
  treasury_address: string | null;
  owner_address: string | null;
  cluster: string;
  demo: boolean;
  demo_balance_usd: number | string | null;
  created_at: string;
};

export type AgentRow = {
  id: string;
  org_id: string;
  workflow_id: string;
  name: string;
  role: string;
  wallet_address: string | null;
  session_address: string | null;
  daily_limit_usd: number | string;
  pays_to: string[];
  receives_from: string;
  status: string;
  demo: boolean;
  demo_balance_usd: number | string | null;
  demo_spent_usd: number | string | null;
  created_at: string;
};

export type McpRow = {
  id: string;
  org_id: string;
  name: string;
  description: string;
  enabled: boolean;
  scope: string;
  scope_name: string | null;
  command: string;
  args: string[];
  demo: boolean;
  created_at: string;
};

export type RagRow = {
  id: string;
  org_id: string;
  name: string;
  type: string;
  status: string;
  scope: string;
  scope_name: string;
  source: string | null;
  demo: boolean;
  created_at: string;
};

export type SkillRow = {
  id: string;
  org_id: string;
  name: string;
  description: string;
  icon: string;
  content: string;
  scope: string;
  scope_name: string | null;
  enabled: boolean;
  demo: boolean;
  created_at: string;
};

export type IntegrationRow = {
  id: string;
  org_id: string;
  name: string;
  description: string;
  icon: string;
  url: string;
  connected: boolean;
  created_at: string;
};

export type ApiKeyRow = {
  id: string;
  account_id: string;
  provider: string;
  created_at: string;
};

export type ProfileRow = {
  account_id: string;
  display_name: string;
  company: string;
  bio: string;
  email: string;
};

export type SettingsRow = {
  account_id: string;
  language: string;
  email_notifications: boolean;
  limit_alerts: boolean;
};

function num(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

export function workflowFromRow(row: WorkflowRow): StoredWorkflow {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    icon: row.icon,
    treasuryAddress: row.treasury_address,
    ownerAddress: row.owner_address,
    cluster: row.cluster as StoredWorkflow["cluster"],
    demo: row.demo,
    demoBalanceUsd: num(row.demo_balance_usd),
    createdAt: row.created_at,
  };
}

export function workflowToRow(workflow: StoredWorkflow, orgId: string): WorkflowRow {
  return {
    id: workflow.id,
    org_id: orgId,
    name: workflow.name,
    description: workflow.description,
    icon: workflow.icon,
    treasury_address: workflow.treasuryAddress,
    owner_address: workflow.ownerAddress,
    cluster: workflow.cluster,
    demo: workflow.demo,
    demo_balance_usd: workflow.demoBalanceUsd,
    created_at: workflow.createdAt,
  };
}

export function agentFromRow(row: AgentRow): StoredAgent {
  return {
    id: row.id,
    name: row.name,
    role: row.role,
    workflowId: row.workflow_id,
    walletAddress: row.wallet_address,
    sessionAddress: row.session_address,
    dailyLimitUsd: num(row.daily_limit_usd) ?? 0,
    paysTo: row.pays_to ?? [],
    receivesFrom: row.receives_from,
    status: row.status as StoredAgent["status"],
    demo: row.demo,
    demoBalanceUsd: num(row.demo_balance_usd),
    demoSpentUsd: num(row.demo_spent_usd),
    createdAt: row.created_at,
  };
}

export function agentToRow(agent: StoredAgent, orgId: string): AgentRow {
  return {
    id: agent.id,
    org_id: orgId,
    workflow_id: agent.workflowId,
    name: agent.name,
    role: agent.role,
    wallet_address: agent.walletAddress,
    session_address: agent.sessionAddress,
    daily_limit_usd: agent.dailyLimitUsd,
    pays_to: agent.paysTo,
    receives_from: agent.receivesFrom,
    status: agent.status,
    demo: agent.demo,
    demo_balance_usd: agent.demoBalanceUsd,
    demo_spent_usd: agent.demoSpentUsd,
    created_at: agent.createdAt,
  };
}

export function mcpFromRow(row: McpRow): StoredMcp {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    enabled: row.enabled,
    scope: row.scope as StoredMcp["scope"],
    scopeName: row.scope_name,
    command: row.command,
    args: row.args ?? [],
    // Hosted mode: secrets are not persisted until passkey encryption ships (ADR-017).
    env: {},
    demo: row.demo,
  };
}

export function mcpToRow(mcp: StoredMcp, orgId: string): McpRow {
  return {
    id: mcp.id,
    org_id: orgId,
    name: mcp.name,
    description: mcp.description,
    enabled: mcp.enabled,
    scope: mcp.scope,
    scope_name: mcp.scopeName,
    command: mcp.command,
    args: mcp.args,
    demo: mcp.demo,
    created_at: new Date().toISOString(),
  };
}

export function ragFromRow(row: RagRow): StoredRagDocument {
  return {
    id: row.id,
    name: row.name,
    type: row.type as StoredRagDocument["type"],
    status: row.status as StoredRagDocument["status"],
    scope: row.scope as StoredRagDocument["scope"],
    scopeName: row.scope_name,
    source: row.source,
    demo: row.demo,
  };
}

export function ragToRow(doc: StoredRagDocument, orgId: string): RagRow {
  return {
    id: doc.id,
    org_id: orgId,
    name: doc.name,
    type: doc.type,
    status: doc.status,
    scope: doc.scope,
    scope_name: doc.scopeName,
    source: doc.source,
    demo: doc.demo,
    created_at: new Date().toISOString(),
  };
}

export function skillFromRow(row: SkillRow): StoredSkill {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    icon: row.icon,
    content: row.content,
    scope: row.scope as StoredSkill["scope"],
    scopeName: row.scope_name,
    enabled: row.enabled,
    demo: row.demo,
  };
}

export function skillToRow(skill: StoredSkill, orgId: string): SkillRow {
  return {
    id: skill.id,
    org_id: orgId,
    name: skill.name,
    description: skill.description,
    icon: skill.icon,
    content: skill.content,
    scope: skill.scope,
    scope_name: skill.scopeName,
    enabled: skill.enabled,
    demo: skill.demo,
    created_at: new Date().toISOString(),
  };
}

export function integrationFromRow(row: IntegrationRow): StoredIntegration {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    icon: row.icon,
    url: row.url,
    connected: row.connected,
  };
}

export function integrationToRow(row: StoredIntegration, orgId: string): IntegrationRow {
  return {
    id: row.id,
    org_id: orgId,
    name: row.name,
    description: row.description,
    icon: row.icon,
    url: row.url,
    connected: row.connected,
    created_at: new Date().toISOString(),
  };
}

export function apiKeyFromRow(row: ApiKeyRow): StoredApiKey {
  return {
    id: row.id,
    provider: row.provider,
    secret: "",
    createdAt: row.created_at,
  };
}

export function apiKeyToRow(key: StoredApiKey, accountId: string): ApiKeyRow {
  return {
    id: key.id,
    account_id: accountId,
    provider: key.provider,
    created_at: key.createdAt,
  };
}

export function profileFromRow(row: ProfileRow | null): Profile {
  if (!row) return { displayName: "", company: "", bio: "", email: "" };
  return {
    displayName: row.display_name,
    company: row.company,
    bio: row.bio,
    email: row.email,
  };
}

export function profileToRow(profile: Profile, accountId: string): ProfileRow {
  return {
    account_id: accountId,
    display_name: profile.displayName,
    company: profile.company,
    bio: profile.bio,
    email: profile.email,
  };
}

export function settingsFromRow(row: SettingsRow | null): Settings {
  if (!row) {
    return { language: "en", emailNotifications: false, limitAlerts: true };
  }
  return {
    language: row.language as Settings["language"],
    emailNotifications: row.email_notifications,
    limitAlerts: row.limit_alerts,
  };
}

export function settingsToRow(settings: Settings, accountId: string): SettingsRow {
  return {
    account_id: accountId,
    language: settings.language,
    email_notifications: settings.emailNotifications,
    limit_alerts: settings.limitAlerts,
  };
}

export function assembleState(parts: {
  workflows: StoredWorkflow[];
  agents: StoredAgent[];
  mcps: StoredMcp[];
  rag: StoredRagDocument[];
  skills: StoredSkill[];
  apiKeys: StoredApiKey[];
  integrations: StoredIntegration[];
  profile: Profile;
  settings: Settings;
}): DashboardState {
  return {
    version: 1,
    ...parts,
  };
}
