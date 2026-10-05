// The input is always the output of sanitizePostHtml, never the raw body. What follows is not an
// HTML parser and does not need to be: what reaches it already went through an allowlist, so
// tags are balanced and a literal "<" in text is escaped. Running it before sanitizing would be
// trusting a scanner to understand hostile HTML.
import { stripTags } from "./body-content";
import { decodeEntities } from "./entities";
import { slugify } from "./post-slug";

// `text` is plain text with entities decoded ("Tom & Jerry"), not HTML: render it escaped.
export type TocItem = { id: string; text: string; level: 2 | 3 };

const HEADING_TAG_RE = /<(\/?)(h[23])\b([^<>]*)>/gi;
// One whitespace, not \s*, in front of "id": a leading \s* rescans a run of spaces from every
// position in it. It also keeps the match off attributes that merely end in "id".
const ID_ATTR_RE = /\sid\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi;

function headingText(content: string): string {
  return decodeEntities(stripTags(content, "")).replace(/\s+/g, " ").trim();
}

// One pass for both jobs on purpose: the list comes from the very id that was injected, so the
// anchor and the link that points at it cannot drift apart. And one walk over the heading tags
// instead of a lazy regex per heading, which was quadratic on the nested headings the sanitizer
// makes out of unclosed ones.
export function withToc(html: string): { html: string; items: TocItem[] } {
  const items: TocItem[] = [];
  const used = new Set<string>();
  // Next suffix to try per base, so a thousand headings with one title do not each count from 2.
  const nextSuffix = new Map<string, number>();

  let out = "";
  let copied = 0;
  let open: { tag: string; name: string; attributes: string; start: number; inner: number } | null =
    null;

  for (const match of html.matchAll(HEADING_TAG_RE)) {
    const tag = match[2] as string;
    const name = tag.toLowerCase();

    if (!open) {
      if (!match[1]) {
        open = {
          tag,
          name,
          attributes: match[3] as string,
          start: match.index,
          inner: match.index + match[0].length,
        };
      }
      continue;
    }
    // A heading inside a heading is part of the outer one's content: no id, no entry of its own.
    if (!match[1] || name !== open.name) continue;

    const content = html.slice(open.inner, match.index);
    const text = headingText(content);
    const heading = open;
    open = null;
    // An empty heading is the destination of nothing.
    if (!text) continue;

    // A heading of symbols, or of one character, leaves no usable slug.
    const slug = slugify(text);
    const base = slug.length < 2 ? "secao" : slug;
    let id = base;
    let n = nextSuffix.get(base) ?? 2;
    while (used.has(id)) id = `${base}-${n++}`;
    nextSuffix.set(base, n);
    used.add(id);

    items.push({ id, text, level: heading.name === "h2" ? 2 : 3 });

    // Any id already there is discarded, not added to: with two ids the browser uses the first,
    // which would be the author's. This is what makes it safe for the sanitizer to accept id on
    // headings.
    const rest = heading.attributes.replace(ID_ATTR_RE, "");
    out += `${html.slice(copied, heading.start)}<${heading.tag}${rest} id="${id}">${content}</${heading.tag}>`;
    copied = match.index + match[0].length;
  }

  // A heading that never closes (not something the sanitizer emits) is left as it is, along with
  // everything after it.
  return { html: out + html.slice(copied), items };
}
