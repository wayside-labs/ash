import { describe, expect, it } from "vitest";
import {
  agentFromRow,
  agentToRow,
  profileFromRow,
  profileToRow,
  workflowFromRow,
  workflowToRow,
} from "./map";

const ORG = "00000000-0000-4000-8000-000000000001";
const WORKFLOW = "00000000-0000-4000-8000-000000000002";
const AGENT = "00000000-0000-4000-8000-000000000003";

describe("state row mappers", () => {
  it("round-trips workflows", () => {
    const workflow = workflowFromRow({
      id: WORKFLOW,
      org_id: ORG,
      name: "Store",
      description: "demo",
      icon: "🏪",
      treasury_address: null,
      owner_address: null,
      cluster: "devnet",
      demo: true,
      demo_balance_usd: 100,
      created_at: "2026-09-20T00:00:00.000Z",
    });
    const row = workflowToRow(workflow, ORG);
    expect(row.id).toBe(WORKFLOW);
    expect(row.demo_balance_usd).toBe(100);
    expect(workflowFromRow(row)).toEqual(workflow);
  });

  it("round-trips agents", () => {
    const agent = agentFromRow({
      id: AGENT,
      org_id: ORG,
      workflow_id: WORKFLOW,
      name: "Maria",
      role: "Finance",
      wallet_address: null,
      session_address: null,
      daily_limit_usd: 50,
      pays_to: ["OpenAI"],
      receives_from: "Vault",
      status: "active",
      demo: true,
      demo_balance_usd: 12,
      demo_spent_usd: 3,
      created_at: "2026-09-20T00:00:00.000Z",
    });
    const row = agentToRow(agent, ORG);
    expect(agentFromRow(row)).toEqual(agent);
  });

  it("defaults empty profile rows", () => {
    expect(profileFromRow(null)).toEqual({
      displayName: "",
      company: "",
      bio: "",
      email: "",
    });
    const profile = profileFromRow({
      account_id: "00000000-0000-4000-8000-000000000004",
      display_name: "Ada",
      company: "Acme",
      bio: "",
      email: "ada@example.com",
    });
    expect(profileToRow(profile, "00000000-0000-4000-8000-000000000004").display_name).toBe("Ada");
  });
});
