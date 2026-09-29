import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseSkillMarkdown } from "@/lib/skill-md";
import { BUILTIN_SKILLS } from "./builtin-skills";

const EXAMPLES = join(__dirname, "../../../../../examples/skills");

describe("builtin skills", () => {
  it.each(BUILTIN_SKILLS.map((s) => [s.name, s] as const))(
    "%s matches examples/skills (run: pnpm --filter @agent-rails/dashboard skills:sync)",
    (name, skill) => {
      const parsed = parseSkillMarkdown(readFileSync(join(EXAMPLES, name, "SKILL.md"), "utf8"));
      expect(parsed.ok).toBe(true);
      if (!parsed.ok) return;
      expect(skill.description).toBe(parsed.skill.description);
      expect(skill.content).toBe(parsed.skill.content);
    },
  );
});
