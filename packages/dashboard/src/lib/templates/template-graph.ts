import type { StoredWorkflowTemplate } from "@/lib/schema";
import { templateMcpSpecs } from "@/lib/templates/apply-template";

/**
 * A template drawn as the canvas it would become: the same treasury → agent → tool/payee
 * shape `lib/canvas-graph.ts` builds from rows, except nothing exists yet. Tools come from
 * `templateMcpSpecs`, the list apply itself uses, so the picture is what "Use template"
 * creates and nothing the preview invented.
 *
 * Payees are the names in an agent's `paysTo`. On a real canvas they only draw an edge when
 * the name is another agent; here they are shown as their own boxes, because "Builder pays
 * RPC credits, Inference, Hosting" is the point of the starter.
 */

export type TemplateNode =
  | { id: string; kind: "treasury"; position: Point; name: string; agentCount: number }
  | {
      id: string;
      kind: "agent";
      position: Point;
      name: string;
      role: string;
      railsMcp: "none" | "readonly" | "full";
      dailyLimitUsd: number;
      paysTo: string[];
    }
  | {
      id: string;
      kind: "action";
      position: Point;
      name: string;
      description: string;
      shared: boolean;
    }
  | { id: string; kind: "payee"; position: Point; name: string; paidBy: string[] };

export type TemplateEdge = {
  id: string;
  source: string;
  target: string;
  kind: "funds" | "pays" | "tool";
};

type Point = { x: number; y: number };

export const TEMPLATE_TREASURY_ID = "tpl-treasury";
export const templateAgentNodeId = (name: string) => `tpl-agent-${name}`;
const toolNodeId = (index: number) => `tpl-tool-${index}`;
const payeeNodeId = (name: string) => `tpl-payee-${name}`;

const COLUMN_X = { treasury: 0, agent: 340, right: 700 } as const;
const AGENT_STEP = 170;
const RIGHT_STEP = 120;

export function buildTemplateGraph(template: StoredWorkflowTemplate): {
  nodes: TemplateNode[];
  edges: TemplateEdge[];
} {
  const edges: TemplateEdge[] = [];
  const agentNames = new Set(template.agents.map((agent) => agent.name));

  // Right column, top to bottom: tools, then payees — each placed once however many agents use it.
  const right: Exclude<TemplateNode, { kind: "treasury" | "agent" }>[] = [];

  templateMcpSpecs(template).forEach((spec, index) => {
    const id = toolNodeId(index);
    right.push({
      id,
      kind: "action",
      position: { x: COLUMN_X.right, y: 0 },
      name: spec.name,
      description: spec.description,
      shared: spec.agentName === undefined,
    });
    if (spec.agentName !== undefined) {
      edges.push({
        id: `e-tool-${spec.agentName}-${index}`,
        source: templateAgentNodeId(spec.agentName),
        target: id,
        kind: "tool",
      });
    }
  });

  const payees = new Map<string, string[]>();
  for (const agent of template.agents) {
    for (const payee of agent.paysTo) {
      // An agent paying another agent is an agent-to-agent edge, not a destination box.
      if (agentNames.has(payee) || payee === agent.name) continue;
      payees.set(payee, [...(payees.get(payee) ?? []), agent.name]);
    }
  }
  for (const [name, paidBy] of payees) {
    right.push({
      id: payeeNodeId(name),
      kind: "payee",
      position: { x: COLUMN_X.right, y: 0 },
      name,
      paidBy,
    });
    for (const payer of paidBy) {
      edges.push({
        id: `e-pays-${payer}-${name}`,
        source: templateAgentNodeId(payer),
        target: payeeNodeId(name),
        kind: "pays",
      });
    }
  }
  for (const agent of template.agents) {
    for (const payee of agent.paysTo) {
      if (!agentNames.has(payee) || payee === agent.name) continue;
      edges.push({
        id: `e-pays-${agent.name}-${payee}`,
        source: templateAgentNodeId(agent.name),
        target: templateAgentNodeId(payee),
        kind: "pays",
      });
    }
  }

  const agentNodes: TemplateNode[] = template.agents.map((agent, index) => ({
    id: templateAgentNodeId(agent.name),
    kind: "agent",
    position: { x: COLUMN_X.agent, y: index * AGENT_STEP },
    name: agent.name,
    role: agent.role,
    railsMcp: agent.railsMcp,
    dailyLimitUsd: agent.dailyLimitUsd,
    paysTo: agent.paysTo,
  }));
  for (const agent of template.agents) {
    edges.push({
      id: `e-funds-${agent.name}`,
      source: TEMPLATE_TREASURY_ID,
      target: templateAgentNodeId(agent.name),
      kind: "funds",
    });
  }

  // Centre each column on the agents' span so a short column does not hang off the top.
  const agentSpan = Math.max(0, (agentNodes.length - 1) * AGENT_STEP);
  const rightSpan = Math.max(0, (right.length - 1) * RIGHT_STEP);
  const rightTop = (agentSpan - rightSpan) / 2;
  const rightNodes = right.map((node, index) => ({
    ...node,
    position: { x: COLUMN_X.right, y: rightTop + index * RIGHT_STEP },
  }));

  const treasury: TemplateNode = {
    id: TEMPLATE_TREASURY_ID,
    kind: "treasury",
    position: { x: COLUMN_X.treasury, y: agentSpan / 2 },
    name: template.name,
    agentCount: template.agents.length,
  };

  return { nodes: [treasury, ...agentNodes, ...rightNodes], edges };
}
