import { extractConnectorProposals } from "@agent-rails/contract/connector-bundle";
import { describe, expect, it } from "vitest";
import { buildSystemPrompt } from "./system-prompts";

describe("buildSystemPrompt — connector builder", () => {
  for (const locale of ["en", "pt-BR"] as const) {
    it(`${locale}: teaches the fence the chat panel parses, before the security footer`, () => {
      const prompt = buildSystemPrompt(locale);
      const section = prompt.indexOf("connector-bundle");
      const footer = prompt.search(/ABSOLUTE CONSTRAINTS|RESTRIÇÕES ABSOLUTAS/);
      expect(section).toBeGreaterThan(0);
      expect(footer).toBeGreaterThan(section);
      // Recency: the footer still closes the prompt and restates the connector refusals.
      expect(prompt.slice(footer)).toMatch(/connector-bundle/);
      expect(prompt.slice(footer)).toMatch(/AGENT_RAILS_/);
    });
  }

  it("contains no fenced example the panel would offer as an Add connector card", () => {
    // A literal ```connector-bundle block in the prompt would be echoed back verbatim by
    // models that copy examples; the shape is described in prose instead.
    expect(extractConnectorProposals(buildSystemPrompt("en"))).toEqual([]);
    expect(extractConnectorProposals(buildSystemPrompt("pt-BR"))).toEqual([]);
  });
});
