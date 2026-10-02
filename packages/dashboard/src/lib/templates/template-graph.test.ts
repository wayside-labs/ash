import { describe, expect, it } from "vitest";
import { dashboardStateSchema } from "@/lib/schema";
import { applyTemplateToState, templateMcpSpecs } from "@/lib/templates/apply-template";
import { BUILTIN_TEMPLATES, listBuiltinTemplates } from "@/lib/templates/catalog";
import {
  buildTemplateGraph,
  TEMPLATE_TREASURY_ID,
  templateAgentNodeId,
} from "@/lib/templates/template-graph";

describe("buildTemplateGraph", () => {
  it("draws treasury, agents, tools and payees for the earn bounty hunter", () => {
    const { nodes, edges } = buildTemplateGraph(BUILTIN_TEMPLATES["builtin:earn-bounty-hunter"]);

    expect(nodes.filter((n) => n.kind === "treasury")).toHaveLength(1);
    expect(nodes.filter((n) => n.kind === "agent").map((n) => n.name)).toEqual([
      "Scout",
      "Research",
      "Builder",
    ]);
    expect(nodes.filter((n) => n.kind === "payee").map((n) => n.name)).toEqual([
      "RPC credits",
      "Inference",
      "Hosting",
    ]);
    // Only the Builder has a rails MCP, so only one tool hangs off an agent.
    expect(edges.filter((e) => e.kind === "tool")).toEqual([
      expect.objectContaining({ source: templateAgentNodeId("Builder") }),
    ]);
    expect(edges.filter((e) => e.kind === "funds")).toHaveLength(3);
    expect(edges.filter((e) => e.kind === "pays").map((e) => e.source)).toEqual([
      templateAgentNodeId("Builder"),
      templateAgentNodeId("Builder"),
      templateAgentNodeId("Builder"),
    ]);
  });

  it("shows exactly the MCPs that applying the template creates", () => {
    for (const template of listBuiltinTemplates()) {
      const drawn = buildTemplateGraph(template).nodes.filter((n) => n.kind === "action");
      const state = dashboardStateSchema.parse({});
      applyTemplateToState(state, {
        template,
        workflowName: "x",
        cluster: "devnet",
        ownerAddress: null,
        treasuryAddress: null,
        newId: (p) => `${p}_${Math.random()}`,
        now: "2026-10-02T00:00:00.000Z",
      });
      expect(drawn, template.id).toHaveLength(state.mcps.length);
      expect(drawn.map((n) => n.name).sort(), template.id).toEqual(
        state.mcps.map((m) => m.name).sort(),
      );
    }
  });

  it("leaves workflow-scoped tools unattached, as the real canvas does", () => {
    const { nodes, edges } = buildTemplateGraph(BUILTIN_TEMPLATES["builtin:solana-workstation"]);
    const shared = nodes.filter((n) => n.kind === "action" && n.shared);
    expect(shared.map((n) => n.name)).toEqual(["Solana Jupiter", "SODAX cross-network"]);
    for (const node of shared) {
      expect(edges.some((e) => e.target === node.id)).toBe(false);
    }
  });

  it("is a lone treasury for a template with no agents", () => {
    const { nodes, edges } = buildTemplateGraph(BUILTIN_TEMPLATES["builtin:dca-sol"]);
    expect(nodes.map((n) => n.id)).toEqual([TEMPLATE_TREASURY_ID]);
    expect(edges).toEqual([]);
  });

  it("draws agent-to-agent payment as an edge, not a payee box", () => {
    const base = BUILTIN_TEMPLATES["builtin:defi-yield-rebalance"];
    const template = {
      ...base,
      agents: [
        { name: "A", role: "", railsMcp: "none" as const, dailyLimitUsd: 0, paysTo: ["B", "A"] },
        { name: "B", role: "", railsMcp: "none" as const, dailyLimitUsd: 0, paysTo: ["Desk"] },
      ],
    };
    const { nodes, edges } = buildTemplateGraph(template);
    expect(nodes.filter((n) => n.kind === "payee").map((n) => n.name)).toEqual(["Desk"]);
    expect(edges.filter((e) => e.kind === "pays").map((e) => `${e.source}>${e.target}`)).toEqual([
      `${templateAgentNodeId("B")}>tpl-payee-Desk`,
      `${templateAgentNodeId("A")}>${templateAgentNodeId("B")}`,
    ]);
  });

  it("gives every node a unique id and every edge real endpoints", () => {
    for (const template of listBuiltinTemplates()) {
      const { nodes, edges } = buildTemplateGraph(template);
      const ids = new Set(nodes.map((n) => n.id));
      expect(ids.size, template.id).toBe(nodes.length);
      for (const edge of edges) {
        expect(ids.has(edge.source), `${template.id} ${edge.id}`).toBe(true);
        expect(ids.has(edge.target), `${template.id} ${edge.id}`).toBe(true);
      }
    }
  });
});

describe("templateMcpSpecs", () => {
  it("emits a readonly rails MCP for readonly agents and none for 'none'", () => {
    const specs = templateMcpSpecs(BUILTIN_TEMPLATES["builtin:defi-yield-rebalance"]);
    expect(specs.map((s) => [s.agentName, s.env.AGENT_RAILS_TOOLS])).toEqual([
      ["Planner", "readonly"],
      ["Executor", "full"],
    ]);
  });
});
