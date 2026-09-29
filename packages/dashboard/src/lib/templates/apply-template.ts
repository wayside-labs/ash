import type {
  DashboardState,
  SolanaCluster,
  StoredAgent,
  StoredMcp,
  StoredWorkflow,
  StoredWorkflowTemplate,
} from "@/lib/schema";

export type ApplyTemplateInput = {
  template: StoredWorkflowTemplate;
  workflowName: string;
  cluster: SolanaCluster;
  ownerAddress: string | null;
  treasuryAddress: string | null;
  newId: (prefix: string) => string;
  now: string;
};

export type ApplyTemplateResult = {
  workflowId: string;
  agentIds: string[];
  mcpIds: string[];
};

function railsMcpEnv(mode: "readonly" | "full"): Record<string, string> {
  const tools = mode === "readonly" ? "readonly" : "full";
  return {
    AGENT_RAILS_RPC: "",
    AGENT_RAILS_SESSION: "",
    AGENT_RAILS_SIGNER: "",
    AGENT_RAILS_TOOLS: tools,
    AGENT_RAILS_SECURITY: "balanced",
  };
}

/**
 * Materializes a workflow, its agents, and per-agent rails MCP rows from a template.
 * Privileged on-chain steps (init, policy, session create) stay outside — the returned
 * workflow is workspace state the operator finishes in Treasury / Limits / CLI.
 */
export function applyTemplateToState(
  state: DashboardState,
  input: ApplyTemplateInput,
): ApplyTemplateResult {
  const workflowId = input.newId("wfl");
  const workflow: StoredWorkflow = {
    id: workflowId,
    name: input.workflowName.trim(),
    description: input.template.description,
    icon: input.template.icon,
    treasuryAddress: input.treasuryAddress,
    ownerAddress: input.ownerAddress,
    cluster: input.cluster,
    demo: false,
    demoBalanceUsd: null,
    layout: { positions: {}, hidden: [] },
    createdAt: input.now,
  };
  state.workflows.push(workflow);

  const agentIds: string[] = [];
  const mcpIds: string[] = [];

  for (const spec of input.template.agents) {
    const agentId = input.newId("agt");
    agentIds.push(agentId);
    const agent: StoredAgent = {
      id: agentId,
      name: spec.name,
      role: spec.role,
      workflowId,
      walletAddress: null,
      sessionAddress: null,
      dailyLimitUsd: spec.dailyLimitUsd,
      paysTo: spec.paysTo,
      receivesFrom: "Workflow vault",
      status: "active",
      demo: false,
      demoBalanceUsd: null,
      demoSpentUsd: null,
      createdAt: input.now,
    };
    state.agents.push(agent);

    if (spec.railsMcp === "none") continue;

    const mcpId = input.newId("mcp");
    mcpIds.push(mcpId);
    const mcp: StoredMcp = {
      id: mcpId,
      name: "Agent Rails Payments",
      description:
        spec.railsMcp === "readonly"
          ? "Read-only policy and session checks for this agent"
          : "Capped payments for this agent",
      enabled: true,
      scope: "agent",
      scopeName: spec.name,
      command: "agent-rails-mcp",
      args: [],
      env: railsMcpEnv(spec.railsMcp),
      demo: false,
    };
    state.mcps.push(mcp);
  }

  return { workflowId, agentIds, mcpIds };
}
