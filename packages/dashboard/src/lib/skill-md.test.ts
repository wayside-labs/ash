import { describe, expect, it } from "vitest";
import { parseSkillMarkdown, renderSkillMarkdown, skillSlug } from "./skill-md";

describe("SKILL.md", () => {
  it("parses a Claude Code skill", () => {
    const parsed = parseSkillMarkdown(
      '---\nname: vendor-checkout\ndescription: "Use when: buying"\n---\n\n# Body\n',
    );
    expect(parsed).toEqual({
      ok: true,
      skill: { name: "vendor-checkout", description: "Use when: buying", content: "# Body" },
    });
  });

  it("accepts CRLF, a BOM and single quotes", () => {
    const parsed = parseSkillMarkdown("﻿---\r\nname: 'a'\r\ndescription: 'it''s'\r\n---\r\nx");
    expect(parsed.ok && parsed.skill).toEqual({ name: "a", description: "it's", content: "x" });
  });

  it.each([
    ["no frontmatter", "# just markdown"],
    ["no name", "---\ndescription: d\n---\nbody"],
    ["empty body", "---\nname: a\n---\n"],
    ["block scalar", "---\nname: a\ndescription: >\n  folded\n---\nbody"],
    ["list", "---\nname: a\ntools: [Bash]\n---\nbody"],
  ])("refuses %s", (_label, text) => {
    expect(parseSkillMarkdown(text).ok).toBe(false);
  });

  it("refuses oversize files", () => {
    expect(parseSkillMarkdown(`---\nname: a\n---\n${"x".repeat(70_000)}`).ok).toBe(false);
  });

  it("round-trips through render", () => {
    const skill = {
      name: "Pagar Fornecedor ✨",
      description: 'Use "always"\nnow',
      content: "Body",
    };
    const parsed = parseSkillMarkdown(renderSkillMarkdown(skill));
    expect(parsed.ok && parsed.skill).toEqual({
      name: "pagar-fornecedor",
      description: 'Use "always" now',
      content: "Body",
    });
  });

  it("slugs to Claude Code's name rules", () => {
    expect(skillSlug("Análise de Pool!")).toBe("analise-de-pool");
    expect(skillSlug("***")).toBe("skill");
    expect(skillSlug("a".repeat(80))).toHaveLength(64);
  });
});
