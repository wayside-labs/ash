// The public site swaps each shortcode for a real component at build time; the body stores only
// the {{name}} marker.

export const KNOWN_SHORTCODES = ["cta:pitch", "cta:newsletter", "cta:contato", "mapa"] as const;

export type KnownShortcode = (typeof KNOWN_SHORTCODES)[number];

export type PostSegment = { type: "html"; html: string } | { type: "shortcode"; name: string };

const SHORTCODE_RE = /\{\{([a-z]+(?::[a-z0-9-]+)?)\}\}/g;

export function parseShortcodes(bodyHtml: string): PostSegment[] {
  const segments: PostSegment[] = [];
  let last = 0;

  for (const match of bodyHtml.matchAll(SHORTCODE_RE)) {
    if (match.index > last) segments.push({ type: "html", html: bodyHtml.slice(last, match.index) });
    segments.push({ type: "shortcode", name: match[1] as string });
    last = match.index + match[0].length;
  }

  if (last < bodyHtml.length) segments.push({ type: "html", html: bodyHtml.slice(last) });
  return segments;
}

// [^<>] and not [^>]: see TAG_RE in body-content.ts.
const TAG_RE = /<(\/?)([a-z][a-z0-9]*)\b[^<>]*>/gi;
const VOID_TAGS = new Set(["br", "hr", "img"]);

// Stretches of the body that sit outside every element and outside every tag. Like toc.ts, this
// expects sanitized HTML: tags are well formed and a literal "<" or ">" in text is escaped.
function topLevelRanges(html: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  let depth = 0;
  let last = 0;

  for (const match of html.matchAll(TAG_RE)) {
    if (depth === 0 && match.index > last) ranges.push([last, match.index]);
    const name = (match[2] as string).toLowerCase();
    if (match[1]) depth = Math.max(0, depth - 1);
    else if (!VOID_TAGS.has(name)) depth += 1;
    last = match.index + match[0].length;
  }

  if (depth === 0 && last < html.length) ranges.push([last, html.length]);
  return ranges;
}

// `inline` lists shortcodes that are not at block level. parseShortcodes cuts the body at each
// shortcode, so one inside a <p> (or any element, or an attribute) would split the HTML mid-tag
// and each half would be injected on its own.
export function validateShortcodes(bodyHtml: string): {
  ok: boolean;
  unknown: string[];
  inline: string[];
} {
  const unknown: string[] = [];
  const inline: string[] = [];
  const ranges = topLevelRanges(bodyHtml);
  // Ranges and matches both come in document order, so one cursor walks the ranges once instead
  // of searching all of them for every shortcode.
  let cursor = 0;

  for (const match of bodyHtml.matchAll(SHORTCODE_RE)) {
    const name = match[1] as string;
    const start = match.index;
    const end = start + match[0].length;
    if (!(KNOWN_SHORTCODES as readonly string[]).includes(name)) unknown.push(name);
    while (cursor < ranges.length && (ranges[cursor] as [number, number])[1] < end) cursor += 1;
    const range = ranges[cursor];
    if (!range || start < range[0]) inline.push(name);
  }

  return { ok: unknown.length === 0 && inline.length === 0, unknown, inline };
}
