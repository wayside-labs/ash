import { describe, expect, it } from "vitest";
import { legalVars } from "./legal-vars";
import { PRIVACY } from "./privacy";
import { TERMS } from "./terms";
import { fillLegalVars, type LegalDoc } from "./types";

const text = (doc: LegalDoc) =>
  [
    doc.intro,
    ...doc.sections.flatMap((s) => [s.heading, ...s.paragraphs, ...(s.items ?? [])]),
  ].join("\n");

describe.each([
  ["terms", TERMS],
  ["privacy", PRIVACY],
] as const)("%s", (_name, docs) => {
  it("says the same things in both languages", () => {
    const shape = (d: LegalDoc) =>
      d.sections.map((s) => [s.id, s.paragraphs.length, s.items?.length]);
    expect(shape(docs["pt-BR"])).toEqual(shape(docs.en));
  });

  it("uses only placeholders it can fill", () => {
    for (const doc of Object.values(docs)) {
      const filled = fillLegalVars(text(doc), { entity: "E", email: "M", law: "L" });
      expect(filled).not.toMatch(/\{[a-z]+\}/);
    }
  });
});

// What OpenRouter's §5.2 flow-down and §7 and Anthropic's terms require us to tell customers.
// A reworded clause that drops one of these should fail here, not in a vendor review.
describe("required third-party provisions", () => {
  const en = text(TERMS.en);
  const pt = text(TERMS["pt-BR"]);

  it.each([
    [
      "Anthropic’s Commercial Terms",
      /Anthropic’s Commercial Terms/,
      /Termos Comerciais .* da Anthropic/,
    ],
    [
      "Anthropic usage policy",
      /Usage Policy \(Acceptable Use Policy\)/,
      /Política de Uso \(Acceptable Use Policy\)/,
    ],
    ["OpenRouter terms", /OpenRouter’s Terms of Service/, /Termos de Serviço da OpenRouter/],
    ["no competing models", /competing AI model/, /modelo de IA concorrente/],
    ["no reselling", /resell/, /revender/],
    ["no scraping", /scrape/, /scraping/],
    [
      "inputs go to providers",
      /sends your messages[\s\S]*OpenRouter[\s\S]*Anthropic/,
      /envia suas mensagens[\s\S]*OpenRouter[\s\S]*Anthropic/,
    ],
  ])("terms carry: %s", (_label, inEn, inPt) => {
    expect(en).toMatch(inEn);
    expect(pt).toMatch(inPt);
  });

  it("privacy names both processors of the assistant's inputs and outputs", () => {
    for (const doc of Object.values(PRIVACY)) {
      expect(text(doc)).toMatch(/OpenRouter/);
      expect(text(doc)).toMatch(/Anthropic/);
    }
  });
});

describe("legalVars", () => {
  it("shows a visible gap, not an empty string, when the operator has not set a value", () => {
    const vars = legalVars();
    expect(vars.entity).toContain("LEGAL_ENTITY_NAME");
    expect(vars.email).toContain("LEGAL_CONTACT_EMAIL");
    expect(vars.law).toContain("LEGAL_GOVERNING_LAW");
  });
});
