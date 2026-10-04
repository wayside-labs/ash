import { extractConnectorProposals } from "@agent-rails/contract/connector-bundle";
import { extractTemplateRunProposals } from "@agent-rails/contract/template-run";
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

describe("buildSystemPrompt — template runs", () => {
  for (const locale of ["en", "pt-BR"] as const) {
    it(`${locale}: teaches the template-run fence before the security footer, and the footer restates the refusal`, () => {
      const prompt = buildSystemPrompt(locale);
      const section = prompt.indexOf("template-run");
      const footer = prompt.search(/ABSOLUTE CONSTRAINTS|RESTRIÇÕES ABSOLUTAS/);
      expect(section).toBeGreaterThan(0);
      expect(footer).toBeGreaterThan(section);
      expect(prompt.slice(footer)).toMatch(/template-run/);
    });

    it(`${locale}: says the model only drafts and that mainnet moves real funds`, () => {
      const prompt = buildSystemPrompt(locale);
      expect(prompt).toMatch(/mainnet/i);
      expect(prompt).toContain("builtin:cloak-private-payout");
      expect(prompt).toContain("agent-rails.template-run/v1");
    });
  }

  // Found by asking the real model: it refused because the dashboard showed demo workflows, asked
  // whether "0.02 SOL in ZEC" meant 0.02 SOL or 0.02 ZEC, and wrote labels with parentheses that the
  // schema refuses. Each of those is a sentence in the prompt now, in both languages.
  it.each([
    [
      "en",
      /no parentheses/,
      /do not ask whether X is SOL or ZEC/,
      /never refuse it because of what/,
    ],
    [
      "pt-BR",
      /sem parênteses/,
      /não pergunte se X é SOL ou ZEC/,
      /nunca o recuse por causa do que/,
    ],
  ] as const)(
    "%s: closes the three gaps the real model fell into",
    (locale, label, zec, context) => {
      const prompt = buildSystemPrompt(locale);
      expect(prompt).toMatch(label);
      expect(prompt).toMatch(zec);
      expect(prompt).toMatch(context);
    },
  );

  it("states the label alphabet the schema enforces, and nothing the schema would refuse", async () => {
    const { cloakPayoutProposalSchema } = await import("@agent-rails/contract/template-run");
    const probe = (label: string) =>
      cloakPayoutProposalSchema.safeParse({
        template: "builtin:cloak-private-payout",
        payees: [
          {
            label,
            address: "7v5FqEj8DaCbvJPEqpUtZXKyLBtrHuxhG2tWayTaJd4C",
            deliver: "SOL",
            amountSol: "0.02",
          },
        ],
      }).success;
    for (const ok of ["Supplier A", "Contributor B", "Fornecedor Ação-1", "a.b_c-d 9"]) {
      expect(probe(ok), ok).toBe(true);
    }
    for (const bad of ["Payee 1 (SOL)", "A/B", "Supplier: A", "A, B", "A+B"]) {
      expect(probe(bad), bad).toBe(false);
    }
  });

  it("contains no fenced example the panel would offer as a payout card", () => {
    // The shape is in prose: a literal block would be echoed back by models that copy examples,
    // and the card it produced would be a payout nobody asked for.
    expect(extractTemplateRunProposals(buildSystemPrompt("en"))).toEqual([]);
    expect(extractTemplateRunProposals(buildSystemPrompt("pt-BR"))).toEqual([]);
  });

  it("keeps the caps it states equal to the contract's", async () => {
    const { CLOAK_PAYOUT_LIMITS } = await import("@agent-rails/contract/template-run");
    const prompt = buildSystemPrompt("en");
    expect(CLOAK_PAYOUT_LIMITS.minPayeeLamports).toBe(10_000_000n);
    expect(CLOAK_PAYOUT_LIMITS.maxPayeeLamports).toBe(50_000_000n);
    expect(CLOAK_PAYOUT_LIMITS.maxRunLamports).toBe(100_000_000n);
    expect(CLOAK_PAYOUT_LIMITS.maxPayees).toBe(4);
    expect(prompt).toContain("at least 0.01");
    expect(prompt).toContain("at most 0.05 per payee");
    expect(prompt).toContain("at most 0.10");
    expect(prompt).toContain("1 to 4 payees");
  });
});
