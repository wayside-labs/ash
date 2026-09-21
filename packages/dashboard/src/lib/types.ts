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
  /** Resolved signing key — stored wallet or on-chain session_key when matched. */
  signingKey: string | null;
  /** Session PDA from store or on-chain match. */
  resolvedSessionAddress: string | null;
  /** True when signingKey came from chain but walletAddress is still empty. */
  signingKeyFromChain: boolean;
}

export interface Workflow extends StoredWorkflow {
  balance: Money;
  agents: Agent[];
}

export interface WalletInfo {
  id: string;
  address: string | null;
  type: "treasury" | "agent" | "owner";
  balance: Money;
  workflowId: string;
  workflowName: string;
  agentId?: string;
  agentName?: string;
  agentRole?: string;
  ownerWalletName?: string | null;
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

export type ChatToolInvocation = {
  id: string;
  name: "draft_canvas_blueprint";
  input: {
    title: string;
    workflowId: string;
    nodes: Record<string, unknown>[];
    edges: Record<string, unknown>[];
  };
};

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  toolInvocations?: ChatToolInvocation[];
  timestamp: Date;
}

export type { AgentStatus as AgentStatusType, Scope as ScopeType };
