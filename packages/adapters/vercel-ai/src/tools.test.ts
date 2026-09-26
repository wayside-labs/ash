import {
  AGENT_TOOL_NAMES,
  FORBIDDEN_TOOL_PATTERNS,
  mcpCheckPaymentSchema,
  mcpExecutePaymentSchema,
  mcpGetPaymentStatusSchema,
  mcpGetPolicySchema,
  mcpGetSessionSchema,
  mcpListDestinationsSchema,
} from "@agent-rails/contract";
import { describe, expect, it } from "vitest";
import { AGENT_RAILS_TOOL_METADATA } from "./metadata.js";
import { createAgentRailsTools } from "./tools.js";

describe("Vercel AI SDK adapter", () => {
  it("maps exactly the contract tool names", () => {
    const names = AGENT_RAILS_TOOL_METADATA.map((meta) => meta.name).sort();
    expect(names).toEqual([...AGENT_TOOL_NAMES].sort());
  });

  it("uses the same zod schemas as the MCP server for every tool", () => {
    const byName = new Map(AGENT_RAILS_TOOL_METADATA.map((meta) => [meta.name, meta.inputSchema]));
    const expected = new Map([
      ["agent_rails_get_session", mcpGetSessionSchema],
      ["agent_rails_get_policy", mcpGetPolicySchema],
      ["agent_rails_list_destinations", mcpListDestinationsSchema],
      ["agent_rails_get_payment_status", mcpGetPaymentStatusSchema],
      ["agent_rails_check_payment", mcpCheckPaymentSchema],
      ["agent_rails_execute_payment", mcpExecutePaymentSchema],
    ] as const);
    for (const [name, schema] of expected) {
      expect(byName.get(name)).toBe(schema);
    }
  });

  it("exposes no privileged tool names", () => {
    for (const meta of AGENT_RAILS_TOOL_METADATA) {
      for (const forbidden of FORBIDDEN_TOOL_PATTERNS) {
        expect(meta.name.includes(forbidden)).toBe(false);
      }
    }
  });

  it("registers one fund-moving tool", () => {
    const writers = AGENT_RAILS_TOOL_METADATA.filter((meta) =>
      meta.name.endsWith("execute_payment"),
    );
    expect(writers).toHaveLength(1);
    expect(writers[0]?.name).toBe("agent_rails_execute_payment");
  });

  it("builds a ToolSet and forwards handler calls", async () => {
    const tools = createAgentRailsTools({
      getSession: async () => ({ ok: "session" }),
      getPolicy: async () => ({ ok: "policy" }),
      listDestinations: async () => ({ destinations: [] }),
      getPaymentStatus: async (input) => ({ intent_id: input.intent_id, status: "settled" }),
      checkPayment: async (input) => ({ wouldAccept: true, input }),
      executePayment: async (input) => ({ outcome: "settled", input }),
    });

    expect(Object.keys(tools).sort()).toEqual([...AGENT_TOOL_NAMES].sort());

    const check = tools.agent_rails_check_payment;
    expect(check).toBeDefined();
    if (!check?.execute) {
      throw new Error("expected execute on check_payment tool");
    }

    const result = await check.execute(
      {
        destination_ref: "openai-billing",
        amount: "1.00",
        mint_ref: "USDC",
        reference: "inv-42",
      },
      { toolCallId: "tc-1", messages: [], context: {} },
    );

    expect(result).toMatchObject({
      wouldAccept: true,
      input: { reference: "inv-42" },
    });
  });
});
