import { describe, expect, it } from "vitest";
import {
  actionNodeId,
  agentNodeId,
  buildGraph,
  connectChange,
  removeEdgeChange,
  treasuryNodeId,
} from "./canvas-graph";
import { mcpServerSchema, type StoredMcp } from "./schema";

const workflow = { id: "wf", name: "Earn", layout: { positions: {}, hidden: [] as string[] } };
const agents = [
  { id: "a1", name: "Scout", paysTo: ["Builder", "External vendor"] },
  { id: "a2", name: "Builder", paysTo: [] as string[] },
];
const mcp = (partial: Partial<StoredMcp>): StoredMcp =>
  mcpServerSchema.parse({ id: partial.name, name: "x", ...partial });
const mcps = [
  mcp({ id: "g", name: "Global", scope: "global" }),
  mcp({ id: "w", name: "Workflow", scope: "workflow", scopeName: "Earn" }),
  mcp({ id: "o", name: "Other workflow", scope: "workflow", scopeName: "Elsewhere" }),
  mcp({ id: "b", name: "Builder rails", scope: "agent", scopeName: "Builder" }),
  mcp({ id: "x", name: "Stranger", scope: "agent", scopeName: "Nobody" }),
];

describe("buildGraph", () => {
  it("derives nodes and edges from the rows", () => {
    const { nodes, edges } = buildGraph(workflow, agents, mcps);
    expect(nodes.map((n) => n.id)).toEqual([
      treasuryNodeId("wf"),
      agentNodeId("a1"),
      agentNodeId("a2"),
      actionNodeId("g"),
      actionNodeId("w"),
      actionNodeId("b"),
    ]);
    expect(nodes.find((n) => n.id === actionNodeId("b"))?.shared).toBe(false);
    expect(nodes.find((n) => n.id === actionNodeId("g"))?.shared).toBe(true);
    expect(edges.map((e) => [e.kind, e.source, e.target])).toEqual([
      ["funds", treasuryNodeId("wf"), agentNodeId("a1")],
      ["funds", treasuryNodeId("wf"), agentNodeId("a2")],
      // "External vendor" is not an agent here, so it draws no edge.
      ["pays", agentNodeId("a1"), agentNodeId("a2")],
      ["tool", agentNodeId("a2"), actionNodeId("b")],
    ]);
    expect(edges.filter((e) => e.kind === "funds").every((e) => !e.deletable)).toBe(true);
  });

  it("honours saved positions and hidden nodes", () => {
    const { nodes, edges } = buildGraph(
      {
        ...workflow,
        layout: { positions: { [agentNodeId("a1")]: { x: 1, y: 2 } }, hidden: [agentNodeId("a2")] },
      },
      agents,
      mcps,
    );
    expect(nodes.find((n) => n.id === agentNodeId("a1"))?.position).toEqual({ x: 1, y: 2 });
    expect(nodes.some((n) => n.id === agentNodeId("a2"))).toBe(false);
    expect(
      edges.some((e) => e.target === agentNodeId("a2") || e.source === agentNodeId("a2")),
    ).toBe(false);
  });
});

describe("edge changes", () => {
  it("turns agent → agent into a payee and agent → tool into a scope", () => {
    expect(connectChange(agentNodeId("a2"), agentNodeId("a1"), agents, mcps)).toEqual({
      kind: "add-payee",
      agentId: "a2",
      payee: "Scout",
    });
    expect(connectChange(agentNodeId("a1"), actionNodeId("w"), agents, mcps)).toEqual({
      kind: "attach-mcp",
      mcpId: "w",
      agentName: "Scout",
    });
  });

  it("refuses to narrow a global MCP, to self-pay, or to wire from a tool", () => {
    expect(connectChange(agentNodeId("a1"), actionNodeId("g"), agents, mcps)).toMatchObject({
      reason: "global-mcp",
    });
    expect(connectChange(agentNodeId("a1"), agentNodeId("a1"), agents, mcps)).toMatchObject({
      reason: "self",
    });
    expect(connectChange(actionNodeId("w"), agentNodeId("a1"), agents, mcps)).toMatchObject({
      reason: "unsupported",
    });
  });

  it("reverses pays and tool edges, never the funding edge", () => {
    expect(
      removeEdgeChange(
        { source: agentNodeId("a1"), target: agentNodeId("a2"), kind: "pays" },
        workflow,
        agents,
      ),
    ).toEqual({ kind: "remove-payee", agentId: "a1", payee: "Builder" });
    expect(
      removeEdgeChange(
        { source: agentNodeId("a2"), target: actionNodeId("b"), kind: "tool" },
        workflow,
        agents,
      ),
    ).toEqual({ kind: "detach-mcp", mcpId: "b", workflowName: "Earn" });
    expect(
      removeEdgeChange(
        { source: treasuryNodeId("wf"), target: agentNodeId("a1"), kind: "funds" },
        workflow,
        agents,
      ),
    ).toBeNull();
  });
});
