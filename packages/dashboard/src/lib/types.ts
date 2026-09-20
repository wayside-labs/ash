export type {
  AgentStatus,
  DashboardState,
  OperationMode,
  Profile,
  Scope,
  Settings,
  SolanaCluster,
  StoredAgent,
  StoredApiKey,
  StoredIntegration,
  StoredMcp,
  StoredRagDocument,
  StoredSkill,
  StoredWorkflow,
} from "./schema";

import type {
  AgentStatus,
  Scope,
  StoredAgent,
  StoredIntegration,
  StoredMcp,
  StoredRagDocument,
  StoredSkill,
  StoredWorkflow,
} from "./schema";

/** Balance the UI shows: resolved from chain, or a demo figure, or unknown. */
export type Money =
  | { kind: "chain"; usd: number | null; sol: number }
  | { kind: "demo"; usd: number }
  | { kind: "unknown" };

export interface Agent extends StoredAgent {
  balance: Money;
  spentUsd: number | null;
  workflowName: string;
}

export interface Workflow extends StoredWorkflow {
  balance: Money;
  agents: Agent[];
}

export interface WalletInfo {
  id: string;
  name: string;
  address: string | null;
  type: "treasury" | "agent" | "owner";
  balance: Money;
  workflowId: string;
  workflowName: string;
  agentId?: string;
  agentName?: string;
  dailyLimitUsd?: number;
  dailySpentUsd?: number | null;
}

export type McpServer = StoredMcp;
export type RagDocument = StoredRagDocument;
export type Skill = StoredSkill;
export type Integration = StoredIntegration;

export interface ApiKeyEntry {
  id: string;
  provider: string;
  keyMasked: string;
  status: "connected" | "disconnected";
  createdAt: string;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
}

export type { AgentStatus as AgentStatusType, Scope as ScopeType };
