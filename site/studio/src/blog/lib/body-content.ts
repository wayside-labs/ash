// Pure and free of Node-only imports: schemas.ts uses the cap, and a form may import schemas.ts.
import { decodeEntities } from "./entities";

// Characters, measured on the raw input and again on the sanitized output (escaping makes "&"
// five times longer). Every regex in this folder is linear, but sanitize-html itself costs
// about half a second on hostile input of this size; the cap is what keeps that bounded.
export const MAX_BODY_HTML_LENGTH = 300_000;

// [^<>] and not [^>]: with the latter, a run of "<" makes every "<" scan to the end of the
// input before failing, which is quadratic.
const TAG_RE = /<[^<>]*>/g;

export function stripTags(html: string, replacement: string): string {
  return html.replace(TAG_RE, replacement);
}

// Zero-width space, non-joiner, joiner and word joiner. Built from code points so the source
// stays ASCII; the no-break space and the BOM are already covered by trim().
const INVISIBLE = new RegExp(`[${String.fromCharCode(0x200b, 0x200c, 0x200d, 0x2060)}]`, "g");

// A draft may be saved empty; approving one may not. "Empty" cannot be a length check: the
// editor's blank document is "<p></p>", and a blank line the author left behind is markup too.
// Expects sanitized HTML, like toc.ts.
export function hasBodyContent(bodyHtml: string): boolean {
  // An image is content with no text at all. A shortcode needs no special case: {{name}} is text.
  if (/<img\b/i.test(bodyHtml)) return true;
  const text = decodeEntities(stripTags(bodyHtml, " ")).replace(INVISIBLE, "");
  return text.trim().length > 0;
}
