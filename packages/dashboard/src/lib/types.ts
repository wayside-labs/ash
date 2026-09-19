export type SolanaCluster = "devnet" | "testnet" | "mainnet-beta";

export type OperationMode = "native" | "agent-rails";

export type AgentStatus = "active" | "paused" | "expired";

export interface Agent {
  id: string;
  name: string;
  role: string;
  workflowId: string;
  walletAddress: string;
  balanceUsd: number;
  dailyLimitUsd: number;
  dailySpentUsd: number;
  paysTo: string[];
  receivesFrom: string;
  status: AgentStatus;
}

export interface Workflow {
  id: string;
  name: string;
  description: string;
  icon: string;
  treasuryBalanceUsd: number;
  agents: Agent[];
}

export interface WalletInfo {
  id: string;
  name: string;
  address: string;
  type: "treasury" | "agent" | "owner";
  balanceUsd: number;
  workflowId: string;
  workflowName: string;
  agentId?: string;
  agentName?: string;
  dailyLimitUsd?: number;
  dailySpentUsd?: number;
}

export interface McpServer {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  scope: "global" | "workflow" | "agent";
  scopeName?: string;
}

export interface RagDocument {
  id: string;
  name: string;
  type: "pdf" | "md" | "url";
  status: "indexed" | "indexing" | "error";
  scope: "global" | "workflow" | "agent";
  scopeName: string;
}

export interface Skill {
  id: string;
  name: string;
  description: string;
  icon: string;
  scope: "global" | "workflow" | "agent";
  scopeName?: string;
  enabled: boolean;
}

export interface ApiKeyEntry {
  id: string;
  provider: string;
  keyMasked: string;
  status: "connected" | "disconnected" | "error";
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
}
