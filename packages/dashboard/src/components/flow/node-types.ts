"use client";

import type { NodeTypes } from "@xyflow/react";
import { ActionNode } from "@/components/flow/action-node";
import { AgentNode } from "@/components/flow/agent-node";
import { TreasuryNode } from "@/components/flow/treasury-node";

export const flowNodeTypes: NodeTypes = {
  treasury: TreasuryNode,
  agent: AgentNode,
  action: ActionNode,
};
