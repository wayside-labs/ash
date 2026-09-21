"use client";

import type { Edge, Node } from "@xyflow/react";
import type { McpServer, Workflow } from "@/lib/types";
import { formatMoney, HIDDEN_AMOUNT, NATIVE_MINT, truncateAddress } from "@/lib/utils";
import type { AIGraphBlueprint, FlowNodeData, FlowNodeKind } from "./types";

/** Mint fields the canvas reads for limit labels — keep this local so we never import `@/lib/server/solana`. */
type CanvasTreasuryView = {
  mints: Array<{ mint: string; maxLifetime: string; decimals: number }>;
};

const U64_MAX = "18446744073709551615";

export function nodeId(prefix: string) {
  return `${prefix}-${crypto.randomUUID().slice(0, 8)}`;
}

function formatCompactUsd(amount: number, locale = "en-US"): string {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: "USD",
    notation: "compact",
    maximumFractionDigits: amount >= 1_000_000 ? 1 : 0,
  }).format(amount);
}

export function formatTreasuryLimitLabel(
  workflow: Workflow,
  treasuryView: CanvasTreasuryView | undefined,
  hidden: boolean,
): string {
  if (hidden) return HIDDEN_AMOUNT;

  const nativeCeiling = treasuryView?.mints.find((mint) => mint.mint === NATIVE_MINT);
  if (nativeCeiling && nativeCeiling.maxLifetime !== U64_MAX) {
    const value = Number(nativeCeiling.maxLifetime) / 10 ** nativeCeiling.decimals;
    if (Number.isFinite(value) && value > 0) {
      return `${formatCompactUsd(value)} Max`;
    }
  }

  const agentLimits = workflow.agents
    .map((agent) => agent.dailyLimitUsd)
    .filter((limit) => limit > 0);
  if (agentLimits.length > 0) {
    return `${formatCompactUsd(Math.max(...agentLimits))} Max`;
  }

  return "—";
}

export function buildInitialGraph(
  workflow: Workflow,
  mcps: McpServer[],
  hidden: boolean,
  treasuryView?: CanvasTreasuryView,
): { nodes: Node<FlowNodeData>[]; edges: Edge[] } {
  const treasuryId = `treasury-${workflow.id}`;
  const treasuryData: FlowNodeData = {
    kind: "treasury",
    workflowId: workflow.id,
    label: workflow.name,
    balanceLabel: formatMoney(workflow.balance, hidden),
    limitLabel: formatTreasuryLimitLabel(workflow, treasuryView, hidden),
    vaultHint: workflow.treasuryAddress ? truncateAddress(workflow.treasuryAddress, 6) : undefined,
  };

  const nodes: Node<FlowNodeData>[] = [
    {
      id: treasuryId,
      type: "treasury",
      position: { x: 40, y: 160 },
      data: treasuryData,
    },
  ];

  const edges: Edge[] = [];

  workflow.agents.forEach((agent, index) => {
    const id = `agent-${agent.id}`;
    nodes.push({
      id,
      type: "agent",
      position: { x: 340, y: 60 + index * 150 },
      data: {
        kind: "agent",
        agentId: agent.id,
        name: agent.name,
        role: agent.role,
        status: agent.status,
      },
    });
    edges.push({
      id: `e-${treasuryId}-${id}`,
      source: treasuryId,
      target: id,
      animated: false,
    });
  });

  const scopedMcps = mcps.filter(
    (mcp) =>
      mcp.scope === "global" || (mcp.scope === "workflow" && mcp.scopeName === workflow.name),
  );

  scopedMcps.slice(0, 4).forEach((mcp, index) => {
    const id = `action-${mcp.id}`;
    const agentAnchor = workflow.agents[index % Math.max(workflow.agents.length, 1)];
    nodes.push({
      id,
      type: "action",
      position: { x: 640, y: 80 + index * 130 },
      data: {
        kind: "action",
        mcpId: mcp.id,
        name: mcp.name,
        provider: mcp.description || "MCP",
        enabled: mcp.enabled,
      },
    });
    if (agentAnchor) {
      edges.push({
        id: `e-agent-${agentAnchor.id}-${id}`,
        source: `agent-${agentAnchor.id}`,
        target: id,
        animated: mcp.enabled,
      });
    }
  });

  return { nodes, edges };
}

export function refreshNodeEntityData(
  nodes: Node<FlowNodeData>[],
  workflow: Workflow,
  mcps: McpServer[],
  hidden: boolean,
  treasuryView?: CanvasTreasuryView,
): Node<FlowNodeData>[] {
  return nodes.map((node) => {
    if (node.type === "treasury" && node.data.kind === "treasury") {
      return {
        ...node,
        data: {
          ...node.data,
          workflowId: workflow.id,
          label: workflow.name,
          balanceLabel: formatMoney(workflow.balance, hidden),
          limitLabel: formatTreasuryLimitLabel(workflow, treasuryView, hidden),
          vaultHint: workflow.treasuryAddress
            ? truncateAddress(workflow.treasuryAddress, 6)
            : undefined,
        },
      };
    }

    if (node.data.kind === "agent" && node.data.agentId) {
      const agentId = node.data.agentId;
      const agent = workflow.agents.find((row) => row.id === agentId);
      if (!agent) return node;
      return {
        ...node,
        data: {
          ...node.data,
          name: agent.name,
          role: agent.role,
          status: agent.status,
        },
      };
    }

    if (node.data.kind === "action" && node.data.mcpId) {
      const mcpId = node.data.mcpId;
      const mcp = mcps.find((row) => row.id === mcpId);
      if (!mcp) return node;
      return {
        ...node,
        data: {
          ...node.data,
          name: mcp.name,
          provider: mcp.description || "MCP",
          enabled: mcp.enabled,
        },
      };
    }

    return node;
  });
}

function isFlowNodeKind(value: unknown): value is FlowNodeKind {
  return value === "treasury" || value === "agent" || value === "action";
}

export function applyBlueprintWithMagicFix(
  currentNodes: Node<FlowNodeData>[],
  currentEdges: Edge[],
  blueprint: AIGraphBlueprint,
): CanvasSnapshot {
  const merged = appendAIBlueprint(currentNodes, currentEdges, blueprint);
  return {
    nodes: merged.nodes,
    edges: simulateMagicFix(merged.nodes, merged.edges),
  };
}

export function appendAIBlueprint(
  currentNodes: Node<FlowNodeData>[],
  currentEdges: Edge[],
  blueprint: AIGraphBlueprint,
): { nodes: Node<FlowNodeData>[]; edges: Edge[] } {
  const existingIds = new Set(currentNodes.map((node) => node.id));
  const idMap = new Map<string, string>();

  const newNodes = blueprint.nodes.map((node, index) => {
    const requestedId = typeof node.id === "string" ? node.id : undefined;
    const newId =
      requestedId && !existingIds.has(requestedId)
        ? requestedId
        : nodeId(String(node.type ?? "node"));
    if (requestedId) idMap.set(requestedId, newId);
    idMap.set(`__idx_${index}`, newId);
    existingIds.add(newId);

    const type = isFlowNodeKind(node.type) ? node.type : "action";
    return {
      ...node,
      id: newId,
      type,
      position: node.position ?? { x: 120 + index * 48, y: 120 + index * 40 },
      data: node.data as FlowNodeData,
    } satisfies Node<FlowNodeData>;
  });

  const newEdges = blueprint.edges.map((edge, index) => {
    const source = idMap.get(edge.source) ?? edge.source;
    const target = idMap.get(edge.target) ?? edge.target;
    return {
      ...edge,
      id: edge.id ?? `e-ai-${source}-${target}-${index}`,
      source,
      target,
      animated: true,
    } satisfies Edge;
  });

  return {
    nodes: [...currentNodes, ...newNodes],
    edges: [...currentEdges, ...newEdges],
  };
}

function edgeExists(edges: Edge[], source: string, target: string): boolean {
  return edges.some((edge) => edge.source === source && edge.target === target);
}

function isFloating(nodeId: string, edges: Edge[]): boolean {
  return !edges.some((edge) => edge.source === nodeId || edge.target === nodeId);
}

export function simulateMagicFix(nodes: Node<FlowNodeData>[], edges: Edge[]): Edge[] {
  const nextEdges = [...edges];
  const treasuryNodes = nodes.filter((node) => node.type === "treasury");
  const agentNodes = nodes.filter((node) => node.type === "agent");
  const actionNodes = nodes.filter((node) => node.type === "action");
  const primaryTreasury = treasuryNodes[0];

  for (const agent of agentNodes) {
    if (!isFloating(agent.id, nextEdges) || !primaryTreasury) continue;
    if (edgeExists(nextEdges, primaryTreasury.id, agent.id)) continue;
    nextEdges.push({
      id: `e-fix-${primaryTreasury.id}-${agent.id}`,
      source: primaryTreasury.id,
      target: agent.id,
      animated: true,
    });
  }

  for (const action of actionNodes) {
    if (!isFloating(action.id, nextEdges)) continue;

    const anchor =
      agentNodes.find((agent) => !isFloating(agent.id, nextEdges)) ??
      agentNodes[0] ??
      primaryTreasury;
    if (!anchor) continue;
    if (edgeExists(nextEdges, anchor.id, action.id)) continue;

    nextEdges.push({
      id: `e-fix-${anchor.id}-${action.id}`,
      source: anchor.id,
      target: action.id,
      animated: true,
    });
  }

  return nextEdges;
}

export function parseAIBlueprintInput(raw: string): AIGraphBlueprint | null {
  const trimmed = raw.trim();
  if (!trimmed.startsWith("{")) return null;
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (!parsed || typeof parsed !== "object") return null;
    const record = parsed as Record<string, unknown>;
    if (!Array.isArray(record.nodes) || !Array.isArray(record.edges)) return null;
    return { nodes: record.nodes, edges: record.edges };
  } catch {
    return null;
  }
}

export type CanvasSnapshot = {
  nodes: Node<FlowNodeData>[];
  edges: Edge[];
};

export function cloneSnapshot(snapshot: CanvasSnapshot): CanvasSnapshot {
  return {
    nodes: snapshot.nodes.map((node) => ({
      ...node,
      data: { ...node.data },
      position: { ...node.position },
    })),
    edges: snapshot.edges.map((edge) => ({ ...edge })),
  };
}
