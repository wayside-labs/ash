/**
 * `SKILL.md` in and out: the Claude Code skill format (YAML frontmatter with `name` and
 * `description`, Markdown body) mapped onto a stored skill.
 *
 * The frontmatter parser is deliberately a subset — single-line `key: value` scalars,
 * optionally quoted — because that is all a skill header carries, and a full YAML parser in
 * the browser bundle would be the largest thing on the page. Anything outside the subset is
 * refused with a message rather than half-read.
 */

export const MAX_SKILL_BYTES = 64 * 1024;

export type ParsedSkill = { name: string; description: string; content: string };

export type SkillParseResult = { ok: true; skill: ParsedSkill } | { ok: false; error: string };

/** Claude Code skill names: lowercase letters, digits and hyphens, at most 64. */
export function skillSlug(name: string): string {
  const slug = name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64)
    .replace(/-+$/, "");
  return slug || "skill";
}

function unquote(raw: string): string {
  const value = raw.trim();
  if (value.length >= 2) {
    const first = value[0];
    const last = value[value.length - 1];
    if (first === '"' && last === '"') {
      return value.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, "\\");
    }
    if (first === "'" && last === "'") return value.slice(1, -1).replace(/''/g, "'");
  }
  return value;
}

export function parseSkillMarkdown(text: string): SkillParseResult {
  if (new TextEncoder().encode(text).length > MAX_SKILL_BYTES) {
    return { ok: false, error: `larger than ${MAX_SKILL_BYTES / 1024} KB` };
  }
  const normalized = text.replace(/^﻿/, "").replace(/\r\n/g, "\n");
  const match = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(normalized);
  if (!match) return { ok: false, error: "missing --- frontmatter --- block" };

  const fields: Record<string, string> = {};
  for (const line of (match[1] ?? "").split("\n")) {
    if (!line.trim() || line.trimStart().startsWith("#")) continue;
    const kv = /^([A-Za-z][\w-]*):(.*)$/.exec(line);
    if (!kv?.[1]) return { ok: false, error: `unsupported frontmatter line: ${line.trim()}` };
    const value = (kv[2] ?? "").trim();
    if (value === "|" || value === ">" || value.startsWith("[") || value.startsWith("{")) {
      return { ok: false, error: `${kv[1]}: only single-line values are supported` };
    }
    fields[kv[1]] = unquote(value);
  }

  const name = fields.name?.trim() ?? "";
  if (!name) return { ok: false, error: "frontmatter has no name" };
  const content = (match[2] ?? "").trim();
  if (!content) return { ok: false, error: "skill body is empty" };
  return {
    ok: true,
    skill: { name, description: fields.description?.trim() ?? "", content },
  };
}

function yamlScalar(value: string): string {
  const single = value.replace(/\s*\n\s*/g, " ").trim();
  return JSON.stringify(single);
}

/** The inverse, for export. JSON strings are valid YAML double-quoted scalars. */
export function renderSkillMarkdown(skill: { name: string; description: string; content: string }) {
  return (
    `---\nname: ${skillSlug(skill.name)}\ndescription: ${yamlScalar(skill.description)}\n---\n\n` +
    `${skill.content.trim()}\n`
  );
}
