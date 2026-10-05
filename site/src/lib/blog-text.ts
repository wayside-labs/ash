// The words of a post's body, for the places that need text and not markup: the meta description
// of a post nobody wrote an excerpt for. What comes out is plain text and is escaped again by
// whatever prints it.

const NAMED: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

function decode(entity: string, name: string): string {
  const lower = name.toLowerCase();
  if (lower in NAMED) return NAMED[lower] as string;
  if (!lower.startsWith("#")) return entity;
  const code = lower.startsWith("#x") ? Number.parseInt(lower.slice(2), 16) : Number.parseInt(lower.slice(1), 10);
  // Not a character at all (too large, a surrogate): drop it instead of throwing.
  if (!Number.isInteger(code) || code < 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return "";
  return String.fromCodePoint(code);
}

// "Posts in {name}" with { name: "Product" }. A placeholder with no value stays out.
export function fillTemplate(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{([a-z]+)\}/g, (_, key: string) => String(values[key] ?? ""));
}

// "&lt;b&gt; &amp; &#233;" -> "<b> & é". The result is text: whoever prints it escapes it again.
export const decodeEntities = (text: string): string => text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, decode);

// Markers and tags out, entities back to characters, runs of space to one space.
export function bodyText(html: string): string {
  return decodeEntities(html
    .replace(/\{\{[a-z]+(?::[a-z0-9-]+)?\}\}/g, " ")
    .replace(/<[^<>]*>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

// The first `max` characters or so, cut at a word and marked as cut. null for a body with no
// words (only an image, only a block).
export function bodyExcerpt(html: string, max = 155): string | null {
  const text = bodyText(html);
  if (!text) return null;
  const chars = [...text];
  if (chars.length <= max) return text;
  const head = chars.slice(0, max).join("");
  const space = head.lastIndexOf(" ");
  // A first word longer than the limit is cut where the limit falls.
  return `${(space > max / 2 ? head.slice(0, space) : head).replace(/[\s.,;:!?—-]+$/, "")}…`;
}
