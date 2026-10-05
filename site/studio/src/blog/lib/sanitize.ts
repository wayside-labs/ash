// Runs on save and again on serve, and neither end is enough alone. On save, so the database
// never stores the payload waiting for a screen that forgets to sanitize. On serve, because the
// allowlist can change after a row was written, and rows also arrive by psql, restore or
// migration. Node only: never import this from proxy.ts or a client component.
import sanitizeHtml from "sanitize-html";
import { MAX_BODY_HTML_LENGTH } from "./body-content";
import { isSafeHref } from "./href";
import { isMediaPath } from "./image-rules";

// An allowlist, never a denylist: a new tag is born forbidden. No h1 (the page's h1 is the post
// title). script, style, iframe, object, embed, form and input are not "blocked" anywhere; they
// were simply never allowed, which is the stronger guarantee.
export const ALLOWED_TAGS: readonly string[] = [
  "h2", "h3", "h4",
  "p", "br", "hr",
  "ul", "ol", "li",
  "strong", "em", "del", "code", "pre",
  "blockquote",
  "a",
  "img", "figure", "figcaption",
  "table", "thead", "tbody", "tr", "th", "td",
];

// Thrown, not truncated: half a post is worse than a refusal, and cutting HTML at an arbitrary
// character is how a tag gets left open.
export class BodyTooLargeError extends Error {
  constructor(readonly length: number) {
    super(`post body has ${length} characters; the cap is ${MAX_BODY_HTML_LENGTH}`);
    this.name = "BodyTooLargeError";
  }
}

// Lives in href.ts so a client component can use the same rule without importing this module;
// re-exported for the server code that already takes it from here.
export { isSafeHref };

// Over the cap, on the way in or on the way out, this throws BodyTooLargeError. The check on the
// result is what lets the serve path trust a stored row: whatever was accepted on save is under
// the cap, and sanitizing it again returns it unchanged.
export function sanitizePostHtml(html: string): string {
  if (html.length > MAX_BODY_HTML_LENGTH) throw new BodyTooLargeError(html.length);

  const clean = sanitizeHtml(html, {
    allowedTags: [...ALLOWED_TAGS],
    // No style, class or on*.
    allowedAttributes: {
      // id only on headings, and only because of the table of contents (toc.ts): without it the
      // anchors would be stripped on serve and every link in the index would lead nowhere, with
      // no error. An id chosen by the author never reaches the DOM: withToc discards whatever id
      // is there and writes its own.
      h2: ["id"],
      h3: ["id"],
      h4: ["id"],
      a: ["href", "title"],
      img: ["src", "alt", "width", "height"],
      // The only presentational attribute that survives: it carries no behavior.
      th: ["align"],
      td: ["align"],
    },
    allowedSchemes: ["http", "https", "mailto"],
    // "//evil.com" looks like a relative path and inherits the page's protocol.
    allowProtocolRelative: false,
    // A forbidden tag disappears instead of showing up as "&lt;script&gt;" in the text.
    disallowedTagsMode: "discard",
    // The link stays, without its destination: the text is the author's, the address is not ours
    // to guess.
    transformTags: {
      a: (tagName, attribs) => {
        if (attribs.href === undefined || isSafeHref(attribs.href)) return { tagName, attribs };
        const { href: _dropped, ...rest } = attribs;
        return { tagName, attribs: rest };
      },
    },
    // Images only from our own /media: one hosted elsewhere is a request to a third party on
    // every page view. The whole tag goes; an <img> without src is just a broken icon.
    exclusiveFilter: (frame) => frame.tag === "img" && !isMediaPath(frame.attribs.src ?? ""),
  });

  if (clean.length > MAX_BODY_HTML_LENGTH) throw new BodyTooLargeError(clean.length);
  return clean;
}
