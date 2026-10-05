import {
  AGENT_TOOL_NAMES,
  FORBIDDEN_TOOL_PATTERNS,
  mcpCheckPaymentSchema,
  mcpExecutePaymentSchema,
  mcpGetPaymentStatusSchema,
  mcpGetPolicySchema,
  mcpGetSessionSchema,
  mcpListDestinationsSchema,
} from "@ash/contract";
import { describe, expect, it } from "vitest";
import { ASH_TOOL_METADATA } from "./metadata.js";
import { createAshTools } from "./tools.js";

describe("Vercel AI SDK adapter", () => {
  it("maps exactly the contract tool names", () => {
    const names = ASH_TOOL_METADATA.map((meta) => meta.name).sort();
    expect(names).toEqual([...AGENT_TOOL_NAMES].sort());
  });

  it("uses the same zod schemas as the MCP server for every tool", () => {
    const byName = new Map(ASH_TOOL_METADATA.map((meta) => [meta.name, meta.inputSchema]));
    const expected = new Map([
      ["ash_get_session", mcpGetSessionSchema],
      ["ash_get_policy", mcpGetPolicySchema],
      ["ash_list_destinations", mcpListDestinationsSchema],
      ["ash_get_payment_status", mcpGetPaymentStatusSchema],
      ["ash_check_payment", mcpCheckPaymentSchema],
      ["ash_execute_payment", mcpExecutePaymentSchema],
    ] as const);
    for (const [name, schema] of expected) {
      expect(byName.get(name)).toBe(schema);
    }
  });

  it("exposes no privileged tool names", () => {
    for (const meta of ASH_TOOL_METADATA) {
      for (const forbidden of FORBIDDEN_TOOL_PATTERNS) {
        expect(meta.name.includes(forbidden)).toBe(false);
      }
    }
  });

  it("registers one fund-moving tool", () => {
    const writers = ASH_TOOL_METADATA.filter((meta) => meta.name.endsWith("execute_payment"));
    expect(writers).toHaveLength(1);
    expect(writers[0]?.name).toBe("ash_execute_payment");
  });

  it("builds a ToolSet and forwards handler calls", async () => {
    const tools = createAshTools({
      getSession: async () => ({ ok: "session" }),
      getPolicy: async () => ({ ok: "policy" }),
      listDestinations: async () => ({ destinations: [] }),
      getPaymentStatus: async (input) => ({ intent_id: input.intent_id, status: "settled" }),
      checkPayment: async (input) => ({ wouldAccept: true, input }),
      executePayment: async (input) => ({ outcome: "settled", input }),
      requestLimitIncrease: async (input) => ({ requested: false, input }),
    });

    expect(Object.keys(tools).sort()).toEqual([...AGENT_TOOL_NAMES].sort());

    const check = tools.ash_check_payment;
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
