import { describe, expect, it } from "vitest";
import {
  compileRunnerConfig,
  compileRunnerConfigForAgent,
  isAgentRailsMcp,
  runnerConfigFilename,
} from "./mcp-config.js";
import type { StoredAgent, StoredMcp, StoredWorkflow } from "./schema.js";

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

describe("alert webhook injection", () => {
  it.each([
    ["agent-rails-mcp", []],
    ["npx", ["-y", "@agent-rails/mcp"]],
    ["node", ["/home/op/agent-rails/packages/mcp/dist/cli.js"]],
  ])("recognises %s %j as the rails server", (command, args) => {
    expect(isAgentRailsMcp({ command, args })).toBe(true);
  });

  it("injects the webhook into the rails server only", () => {
    const mcps: StoredMcp[] = [
      mcp({ name: "Rails", scope: "global", command: "npx", args: ["-y", "@agent-rails/mcp"] }),
      mcp({ name: "Fetch", scope: "global", command: "uvx", args: ["mcp-server-fetch"] }),
    ];
    const { config } = compileRunnerConfig(workflow, mcps, {
      alertWebhookUrl: "https://hooks.example/x",
    });
    expect(config.mcpServers.rails?.env?.AGENT_RAILS_ALERT_WEBHOOK_URL).toBe(
      "https://hooks.example/x",
    );
    expect(config.mcpServers.fetch?.env).toBeUndefined();
  });
});
