import { describe, expect, it } from "vitest";
import {
  compileRunnerBundle,
  compileRunnerConfig,
  compileRunnerConfigForAgent,
  isAgentRailsMcp,
  runnerBundleFilename,
  runnerConfigFilename,
  skillsInScope,
} from "./mcp-config.js";
import type { StoredAgent, StoredMcp, StoredSkill, StoredWorkflow } from "./schema.js";
import { parseSkillMarkdown } from "./skill-md.js";

const workflow: StoredWorkflow = {
  id: "wf-1",
  name: "Earn hunt",
  description: "",
  icon: "⚡",
  treasuryAddress: null,
  ownerAddress: null,
  cluster: "devnet",
  demo: false,
  demoBalanceUsd: null,
  layout: { positions: {}, hidden: [] },
  createdAt: "2026-01-01T00:00:00.000Z",
};

const scout: StoredAgent = {
  id: "ag-scout",
  name: "Scout",
  role: "scout",
  workflowId: workflow.id,
  walletAddress: null,
  sessionAddress: null,
  dailyLimitUsd: 0,
  paysTo: [],
  receivesFrom: "",
  status: "active",
  demo: false,
  demoBalanceUsd: null,
  demoSpentUsd: null,
  createdAt: "2026-01-01T00:00:00.000Z",
};

const builder: StoredAgent = {
  ...scout,
  id: "ag-builder",
  name: "Builder",
  role: "builder",
};

function mcp(partial: Partial<StoredMcp> & Pick<StoredMcp, "name" | "scope">): StoredMcp {
  return {
    id: partial.id ?? partial.name,
    description: "",
    enabled: true,
    scopeName: partial.scopeName ?? null,
    command: "node",
    args: ["mcp.js"],
    env: {},
    demo: false,
    ...partial,
  };
}

describe("compileRunnerConfigForAgent", () => {
  it("does not include another agent's scoped payment MCP", () => {
    const mcps: StoredMcp[] = [
      mcp({ name: "Shared", scope: "workflow", scopeName: workflow.name }),
      mcp({
        name: "Agent Rails",
        scope: "agent",
        scopeName: builder.name,
        command: "agent-rails-mcp",
      }),
    ];

    const scoutConfig = compileRunnerConfigForAgent(scout, workflow, mcps);
    expect(Object.keys(scoutConfig.config.mcpServers)).toEqual(["shared"]);

    const builderConfig = compileRunnerConfigForAgent(builder, workflow, mcps);
    expect(Object.keys(builderConfig.config.mcpServers).sort()).toEqual(
      ["agent-rails", "shared"].sort(),
    );
  });
});

describe("compileRunnerConfig (workflow shared)", () => {
  it("omits agent-scoped MCPs", () => {
    const mcps: StoredMcp[] = [
      mcp({ name: "Global", scope: "global" }),
      mcp({
        name: "Builder pay",
        scope: "agent",
        scopeName: builder.name,
        command: "agent-rails-mcp",
      }),
    ];

    const { config } = compileRunnerConfig(workflow, mcps);
    expect(Object.keys(config.mcpServers)).toEqual(["global"]);
  });
});

describe("runnerConfigFilename", () => {
  it("suffixes agent slug when provided", () => {
    expect(runnerConfigFilename("Earn hunt", "Builder")).toBe("earn-hunt-builder.mcp.json");
  });
});

describe("ingest injection", () => {
  it.each([
    ["agent-rails-mcp", []],
    ["npx", ["-y", "@agent-rails/mcp"]],
    ["node", ["/home/op/agent-rails/packages/mcp/dist/cli.js"]],
  ])("recognises %s %j as the rails server", (command, args) => {
    expect(isAgentRailsMcp({ command, args })).toBe(true);
  });

  it("gives the ingest URL and token to the rails server only", () => {
    const mcps: StoredMcp[] = [
      mcp({ name: "Rails", scope: "global", command: "npx", args: ["-y", "@agent-rails/mcp"] }),
      mcp({ name: "Fetch", scope: "global", command: "uvx", args: ["mcp-server-fetch"] }),
    ];
    const { config } = compileRunnerConfig(workflow, mcps, {
      ingest: { url: "https://dash.example/api/ingest", token: "art_x" },
    });
    expect(config.mcpServers.rails?.env).toEqual({
      AGENT_RAILS_INGEST_URL: "https://dash.example/api/ingest",
      AGENT_RAILS_INGEST_TOKEN: "art_x",
    });
    expect(config.mcpServers.fetch?.env).toBeUndefined();
  });

  it("gives the knowledge MCP the token and, per agent, the agent's name", () => {
    const mcps: StoredMcp[] = [
      mcp({
        name: "Knowledge",
        scope: "global",
        command: "node",
        args: ["/repo/packages/knowledge-mcp/dist/cli.js"],
      }),
    ];
    const { config } = compileRunnerConfigForAgent(builder, workflow, mcps, {
      ingest: { url: "https://dash.example/api/ingest", token: "art_x" },
    });
    expect(config.mcpServers.knowledge?.env).toEqual({
      AGENT_RAILS_INGEST_URL: "https://dash.example/api/ingest",
      AGENT_RAILS_INGEST_TOKEN: "art_x",
      AGENT_RAILS_AGENT_NAME: "Builder",
    });
  });
});

function skill(partial: Partial<StoredSkill> & Pick<StoredSkill, "name" | "scope">): StoredSkill {
  return {
    id: partial.id ?? partial.name,
    description: `${partial.name} description`,
    icon: "🧩",
    content: `Body of ${partial.name}`,
    scopeName: partial.scopeName ?? null,
    enabled: true,
    demo: false,
    ...partial,
  };
}

describe("runner bundle skills", () => {
  const skills: StoredSkill[] = [
    skill({ name: "Global", scope: "global" }),
    skill({ name: "Workflow", scope: "workflow", scopeName: workflow.name }),
    skill({ name: "Other workflow", scope: "workflow", scopeName: "Elsewhere" }),
    skill({ name: "Builder only", scope: "agent", scopeName: builder.name }),
    skill({ name: "Disabled", scope: "global", enabled: false }),
    skill({ name: "Empty", scope: "global", content: "  " }),
  ];
  const names = (list: StoredSkill[]) => list.map((s) => s.name);

  it("gives an agent global, its workflow and its own skills — never another agent's", () => {
    expect(names(skillsInScope(skills, workflow, builder))).toEqual([
      "Global",
      "Workflow",
      "Builder only",
    ]);
    expect(names(skillsInScope(skills, workflow, scout))).toEqual(["Global", "Workflow"]);
  });

  it("gives the workflow export no agent-scoped skill", () => {
    expect(names(skillsInScope(skills, workflow))).toEqual(["Global", "Workflow"]);
  });

  it("lays skills out where Claude Code finds them, with unique slugs", () => {
    const { entries, skillCount } = compileRunnerBundle({ mcpServers: {} }, [
      skill({ name: "Pay vendor", scope: "global" }),
      skill({ name: "Pay  Vendor", scope: "global", id: "dup" }),
    ]);
    expect(skillCount).toBe(2);
    const paths = entries.map((e) => e.path);
    expect(paths).toContain(".mcp.json");
    expect(paths).toContain(".claude/skills/pay-vendor/SKILL.md");
    expect(paths).toContain(".claude/skills/pay-vendor-2/SKILL.md");
    const second = entries.find((e) => e.path.includes("pay-vendor-2"));
    const parsed = parseSkillMarkdown(String(second?.data));
    expect(parsed.ok && parsed.skill.name).toBe("pay-vendor-2");
  });

  it("names the bundle after the runner config", () => {
    expect(runnerBundleFilename("Earn hunt", "Builder")).toBe("earn-hunt-builder.agent.zip");
  });
});
