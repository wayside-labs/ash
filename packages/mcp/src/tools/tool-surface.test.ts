import { AGENT_TOOL_NAMES, FORBIDDEN_TOOL_PATTERNS } from "@ash/contract";
import { describe, expect, it } from "vitest";
import { REGISTERED_TOOL_NAMES, TOOL_DEFINITIONS, toolsForMode } from "./index.js";

/**
 * The agent surface is enforced by convention (ADR-007). This makes it mechanical.
 *
 * "Loosening flows downhill only" holds because no tool an agent can call changes a limit,
 * a role, a session, or an allowlist. That property is invisible in a diff that adds one
 * innocuous-looking tool, so it gets asserted here instead of remembered.
 */
describe("agent tool surface", () => {
  it("registers exactly the tools named in the contract", () => {
    expect([...REGISTERED_TOOL_NAMES].sort()).toEqual([...AGENT_TOOL_NAMES].sort());
  });

  it("exposes no tool that could loosen a constraint", () => {
    for (const name of REGISTERED_TOOL_NAMES) {
      for (const forbidden of FORBIDDEN_TOOL_PATTERNS) {
        // `get_payment_status` and friends are reads; an operator verb is not.
        expect(name.includes(forbidden)).toBe(false);
      }
    }
  });

  it("registers exactly one tool that moves funds", () => {
    const writers = REGISTERED_TOOL_NAMES.filter((name) => name.endsWith("execute_payment"));
    expect(writers).toEqual(["ash_execute_payment"]);
  });

  it("gives every tool a description an agent can act on", () => {
    for (const tool of TOOL_DEFINITIONS) {
      expect(tool.description.length).toBeGreaterThan(40);
    }
  });

  it("readonly mode registers no tool that moves funds", () => {
    const names = toolsForMode("readonly").map((tool) => tool.name);
    expect(names).not.toContain("ash_execute_payment");
    expect(names).toContain("ash_check_payment");
    expect(names.every((name) => (AGENT_TOOL_NAMES as readonly string[]).includes(name))).toBe(
      true,
    );
  });

  it("full mode registers the whole contract surface", () => {
    expect(toolsForMode("full").map((tool) => tool.name)).toEqual([...REGISTERED_TOOL_NAMES]);
  });
});
