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
  /** Native SOL, in whole SOL. */
  | { kind: "chain"; usd: number | null; sol: number }
  /**
   * An SPL / Token-2022 balance in human units. `usd` is filled only for mints
   * we know are dollar-pegged; every other token stays `null` rather than
   * borrowing the SOL feed's number.
   */
  | {
      kind: "token";
      usd: number | null;
      amount: number;
      mint: string;
      symbol: string;
      decimals: number;
    }
  | { kind: "demo"; usd: number }
  | { kind: "unknown" };

/** One asset a vault holds, as the UI needs it: already in human units. */
export interface VaultAsset {
  mint: string;
  symbol: string;
  decimals: number;
  /** Base units, as a string — the amount any transaction is actually built from. */
  raw: string;
  amount: number;
  money: Money;
  vault: string;
  exists: boolean;
  fundingMode: "isolated-vault" | "native-allowance";
  configured: boolean;
}

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
  /**
   * The headline figure: the vault's stablecoin balance when the treasury has
   * one configured, otherwise its SOL. Settlement is what an operator wants to
   * read first; SOL is the fee balance and lives in `solBalance`.
   */
  balance: Money;
  /** Always the `sol_vault` balance, whatever `balance` is denominated in. */
  solBalance: Money;
  /** Every configured mint plus native SOL, in the order the treasury lists them. */
  assets: VaultAsset[];
  /** Mint `balance` is denominated in, or null for a row with no treasury. */
  primaryMint: string | null;
  agents: Agent[];
}

export interface WalletInfo {
  id: string;
  address: string | null;
  type: "treasury" | "agent" | "owner";
  balance: Money;
  /** The SOL line under a vault whose headline balance is a token. */
  secondary?: Money;
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

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
}

export type { AgentStatus as AgentStatusType, Scope as ScopeType };
