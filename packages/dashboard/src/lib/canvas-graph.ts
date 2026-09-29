import type { StoredAgent, StoredMcp, StoredWorkflow, WorkflowLayout } from "@/lib/schema";

/**
 * The workflow canvas as a *view* of real rows, plus a saved layout.
 *
 * Nothing structural is stored for the canvas itself: agents come from `agents`, the money
 * edges from each agent's `paysTo`, the tool edges from MCP scope. Dragging an edge edits
 * those rows; the only canvas-owned state is where nodes sit and which ones are hidden. A
 * graph stored on the side would drift from the rows the runner export and the chain
 * actually use, and then the picture would be lying.
 */

export type GraphNodeKind = "treasury" | "agent" | "action";

export type GraphNode = {
  id: string;
  kind: GraphNodeKind;
  /** agent id or MCP id; the workflow id for the treasury. */
  refId: string;
  position: { x: number; y: number };
  /** MCPs only: global or workflow scope, attached to no single agent. */
  shared?: boolean;
};

export type GraphEdge = {
  id: string;
  source: string;
  target: string;
  kind: "funds" | "pays" | "tool";
  /** Funding edges mirror the treasury itself and cannot be removed from here. */
  deletable: boolean;
};

export const treasuryNodeId = (workflowId: string) => `treasury-${workflowId}`;
export const agentNodeId = (agentId: string) => `agent-${agentId}`;
export const actionNodeId = (mcpId: string) => `action-${mcpId}`;

export function parseNodeId(id: string): { kind: GraphNodeKind; refId: string } | null {
  for (const kind of ["treasury", "agent", "action"] as const) {
    if (id.startsWith(`${kind}-`)) return { kind, refId: id.slice(kind.length + 1) };
  }
  return null;
}

/** MCPs this workflow's canvas shows, and to which agent each is attached (if any). */
export function mcpsOnCanvas(
  workflow: Pick<StoredWorkflow, "name">,
  agents: Pick<StoredAgent, "id" | "name">[],
  mcps: StoredMcp[],
): { mcp: StoredMcp; agentId: string | null }[] {
  const byName = new Map(agents.map((agent) => [agent.name, agent.id]));
  return mcps.flatMap((mcp): { mcp: StoredMcp; agentId: string | null }[] => {
    if (mcp.scope === "global") return [{ mcp, agentId: null }];
    if (mcp.scope === "workflow")
      return mcp.scopeName === workflow.name ? [{ mcp, agentId: null }] : [];
    const agentId = mcp.scopeName ? byName.get(mcp.scopeName) : undefined;
    return agentId ? [{ mcp, agentId }] : [];
  });
}

export function buildGraph(
  workflow: Pick<StoredWorkflow, "id" | "name" | "layout">,
  agents: Pick<StoredAgent, "id" | "name" | "paysTo">[],
  mcps: StoredMcp[],
): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const layout = workflow.layout;
  const hidden = new Set(layout.hidden);
  const at = (id: string, fallback: { x: number; y: number }) => layout.positions[id] ?? fallback;

  const treasury = treasuryNodeId(workflow.id);
  const nodes: GraphNode[] = [
    {
      id: treasury,
      kind: "treasury",
      refId: workflow.id,
      position: at(treasury, { x: 40, y: 160 }),
    },
  ];
  const edges: GraphEdge[] = [];

  agents.forEach((agent, index) => {
    const id = agentNodeId(agent.id);
    if (hidden.has(id)) return;
    nodes.push({
      id,
      kind: "agent",
      refId: agent.id,
      position: at(id, { x: 340, y: 60 + index * 150 }),
    });
    edges.push({
      id: `e-${treasury}-${id}`,
      source: treasury,
      target: id,
      kind: "funds",
      deletable: false,
    });
  });

  const visibleAgents = new Map(
    agents.filter((agent) => !hidden.has(agentNodeId(agent.id))).map((a) => [a.name, a.id]),
  );
  for (const agent of agents) {
    if (hidden.has(agentNodeId(agent.id))) continue;
    for (const payee of agent.paysTo) {
      const target = visibleAgents.get(payee);
      if (!target || target === agent.id) continue;
      edges.push({
        id: `e-pays-${agent.id}-${target}`,
        source: agentNodeId(agent.id),
        target: agentNodeId(target),
        kind: "pays",
        deletable: true,
      });
    }
  }

  mcpsOnCanvas(workflow, agents, mcps).forEach(({ mcp, agentId }, index) => {
    const id = actionNodeId(mcp.id);
    if (hidden.has(id)) return;
    nodes.push({
      id,
      kind: "action",
      refId: mcp.id,
      position: at(id, { x: 660, y: 60 + index * 120 }),
      shared: agentId === null,
    });
    if (agentId && !hidden.has(agentNodeId(agentId))) {
      edges.push({
        id: `e-tool-${agentId}-${mcp.id}`,
        source: agentNodeId(agentId),
        target: id,
        kind: "tool",
        deletable: true,
      });
    }
  });

  return { nodes, edges };
}

/** What drawing (or erasing) an edge means for the underlying rows. */
export type EdgeChange =
  | { kind: "add-payee"; agentId: string; payee: string }
  | { kind: "remove-payee"; agentId: string; payee: string }
  | { kind: "attach-mcp"; mcpId: string; agentName: string }
  | { kind: "detach-mcp"; mcpId: string; workflowName: string }
  | { kind: "refuse"; reason: "global-mcp" | "self" | "unsupported" };

export function connectChange(
  source: string,
  target: string,
  agents: Pick<StoredAgent, "id" | "name" | "paysTo">[],
  mcps: StoredMcp[],
): EdgeChange {
  const from = parseNodeId(source);
  const to = parseNodeId(target);
  if (!from || !to || from.kind !== "agent") return { kind: "refuse", reason: "unsupported" };
  const payer = agents.find((agent) => agent.id === from.refId);
  if (!payer) return { kind: "refuse", reason: "unsupported" };

  if (to.kind === "agent") {
    if (to.refId === payer.id) return { kind: "refuse", reason: "self" };
    const payee = agents.find((agent) => agent.id === to.refId);
    if (!payee) return { kind: "refuse", reason: "unsupported" };
    return { kind: "add-payee", agentId: payer.id, payee: payee.name };
  }
  if (to.kind === "action") {
    const mcp = mcps.find((row) => row.id === to.refId);
    if (!mcp) return { kind: "refuse", reason: "unsupported" };
    // Narrowing a global MCP to one agent would silently take it away from every other
    // agent in every workflow — that is a decision for /mcps, not a drag on one canvas.
    if (mcp.scope === "global") return { kind: "refuse", reason: "global-mcp" };
    return { kind: "attach-mcp", mcpId: mcp.id, agentName: payer.name };
  }
  return { kind: "refuse", reason: "unsupported" };
}

export function removeEdgeChange(
  edge: Pick<GraphEdge, "source" | "target" | "kind">,
  workflow: Pick<StoredWorkflow, "name">,
  agents: Pick<StoredAgent, "id" | "name">[],
): EdgeChange | null {
  const from = parseNodeId(edge.source);
  const to = parseNodeId(edge.target);
  if (!from || !to) return null;
  if (edge.kind === "pays") {
    const payee = agents.find((agent) => agent.id === to.refId);
    return payee ? { kind: "remove-payee", agentId: from.refId, payee: payee.name } : null;
  }
  if (edge.kind === "tool") {
    // Detaching keeps the tool in the workflow rather than deleting or globalising it.
    return { kind: "detach-mcp", mcpId: to.refId, workflowName: workflow.name };
  }
  return null;
}

export const EMPTY_LAYOUT: WorkflowLayout = { positions: {}, hidden: [] };
