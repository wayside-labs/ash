import { describe, expect, it } from "vitest";
import { dashboardStateSchema } from "@/lib/schema";
import { applyTemplateToState } from "@/lib/templates/apply-template";
import { BUILTIN_TEMPLATES } from "@/lib/templates/catalog";

describe("applyTemplateToState", () => {
  it("creates workflow, agents, and scoped MCPs for earn bounty hunter", () => {
    const state = dashboardStateSchema.parse({});
    const result = applyTemplateToState(state, {
      template: BUILTIN_TEMPLATES["builtin:earn-bounty-hunter"],
      workflowName: "Earn run",
      cluster: "devnet",
      ownerAddress: null,
      treasuryAddress: null,
      newId: (p) => `${p}_1`,
      now: "2026-09-29T00:00:00.000Z",
    });

    expect(result.workflowId).toBe("wfl_1");
    expect(state.workflows).toHaveLength(1);
    expect(state.agents).toHaveLength(3);
    expect(state.mcps).toHaveLength(1);
    expect(state.mcps[0]?.scope).toBe("agent");
    expect(state.mcps[0]?.env.AGENT_RAILS_TOOLS).toBe("full");
  });

  it("creates an empty workflow for DCA (no agents)", () => {
    const state = dashboardStateSchema.parse({});
    applyTemplateToState(state, {
      template: BUILTIN_TEMPLATES["builtin:dca-sol"],
      workflowName: "Weekly DCA",
      cluster: "devnet",
      ownerAddress: null,
      treasuryAddress: null,
      newId: (p) => `${p}_x`,
      now: "2026-09-29T00:00:00.000Z",
    });
    expect(state.agents).toHaveLength(0);
    expect(state.workflows[0]?.name).toBe("Weekly DCA");
  });

  it("adds the Jupiter and SODAX integration MCPs for solana workstation", () => {
    const state = dashboardStateSchema.parse({});
    applyTemplateToState(state, {
      template: BUILTIN_TEMPLATES["builtin:solana-workstation"],
      workflowName: "DeFi desk",
      cluster: "devnet",
      ownerAddress: null,
      treasuryAddress: null,
      newId: (p) => `${p}_ws`,
      now: "2026-09-29T00:00:00.000Z",
    });
    expect(state.agents).toHaveLength(3);
    const connector = (name: string) =>
      state.mcps.find((m) => m.command === "agent-rails-integrations" && m.args[1] === name);
    const jupiter = connector("jupiter");
    expect(jupiter?.scope).toBe("workflow");
    expect(jupiter?.scopeName).toBe("DeFi desk");
    const sodax = connector("sodax");
    expect(sodax?.scopeName).toBe("DeFi desk");
    expect(sodax?.env.SODAX_ALLOWED_DESTINATIONS).toBe("");
  });
});
