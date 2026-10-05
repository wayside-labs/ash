import { describe, expect, it } from "vitest";
import { validateProposal } from "./canvas-proposal";
import { mcpServerSchema, skillSchema } from "./schema";

const existing = {
  agents: [{ name: "Scout" }],
  mcps: [
    mcpServerSchema.parse({ id: "rails", name: "ash", scope: "workflow" }),
    mcpServerSchema.parse({ id: "fetch", name: "fetch", scope: "global" }),
  ],
  skills: [skillSchema.parse({ id: "s1", name: "vendor-checkout" })],
};

describe("validateProposal", () => {
  it("keeps what refers to real rows and reuses existing agents", () => {
    const result = validateProposal(
      {
        summary: "scout finds, buyer pays",
        agents: [
          { name: "Scout", role: "dup" },
          { name: "Buyer", role: "pays vendors" },
        ],
        payees: [{ from: "Scout", to: "Buyer" }],
        tools: [{ mcpId: "rails", agent: "Buyer" }],
        skills: [{ skillId: "s1", agent: "Buyer" }],
      },
      existing,
    );
    expect(result.newAgents).toEqual([{ name: "Buyer", role: "pays vendors" }]);
    expect(result.tools).toEqual([{ mcpId: "rails", mcpName: "ash", agent: "Buyer" }]);
    expect(result.skills).toHaveLength(1);
    expect(result.warnings).toEqual([]);
  });

  it("drops invented ids, unknown agents, self-pay and global narrowing — with warnings", () => {
    const result = validateProposal(
      {
        payees: [
          { from: "Scout", to: "Ghost" },
          { from: "Scout", to: "Scout" },
        ],
        tools: [
          { mcpId: "nope", agent: "Scout" },
          { mcpId: "fetch", agent: "Scout" },
        ],
        skills: [{ skillId: "zzz", agent: "Scout" }],
      },
      existing,
    );
    expect(result.payees).toEqual([]);
    expect(result.tools).toEqual([]);
    expect(result.skills).toEqual([]);
    expect(result.warnings).toHaveLength(4);
  });

  it("has no field for limits, sessions or keys, and ignores any the model adds", () => {
    const result = validateProposal(
      { agents: [{ name: "Buyer", role: "r", dailyLimitUsd: 1_000_000, sessionKey: "x" }] },
      existing,
    );
    expect(result.newAgents).toEqual([{ name: "Buyer", role: "r" }]);
    expect(JSON.stringify(result)).not.toMatch(/dailyLimit|session/);
  });

  it("keeps a valid connector for known agents and refuses a governance one", () => {
    const weather = {
      name: "weather",
      env: { WEATHER_API_KEY: "" },
      tools: [
        {
          name: "weather_now",
          url: "https://api.weather.example/now",
          headers: { Authorization: "Bearer {{ENV:WEATHER_API_KEY}}" },
        },
      ],
    };
    const result = validateProposal(
      {
        connectors: [
          { agents: ["Scout", "Ghost"], bundle: weather },
          {
            agents: ["Scout"],
            bundle: { name: "bad", tools: [{ name: "sign_tx", url: "https://x.example" }] },
          },
          { agents: ["Scout"], bundle: { ...weather, name: "fetch" } },
        ],
      },
      existing,
    );
    expect(result.connectors).toHaveLength(1);
    expect(result.connectors[0]?.agents).toEqual(["Scout"]);
    expect(result.connectors[0]?.bundle.tools[0]?.name).toBe("weather_now");
    expect(result.warnings.join("\n")).toMatch(/Ghost/);
    expect(result.warnings.join("\n")).toMatch(/sign/);
    expect(result.warnings.join("\n")).toMatch(/"fetch" already exists/);
  });
});
