import type { AgentStatus } from "@/lib/types";

export type FlowNodeKind = "treasury" | "agent" | "action";

export type TreasuryNodeData = {
  kind: "treasury";
  workflowId: string;
  label: string;
  balanceLabel: string;
  limitLabel: string;
  vaultHint?: string;
};

export type AgentNodeData = {
  kind: "agent";
  agentId?: string;
  name: string;
  role: string;
  status: AgentStatus;
};

export type ActionNodeData = {
  kind: "action";
  mcpId?: string;
  name: string;
  provider: string;
  enabled: boolean;
};

export type FlowNodeData = TreasuryNodeData | AgentNodeData | ActionNodeData;

export type PaletteDragPayload = {
  type: FlowNodeKind;
  data: FlowNodeData;
};
