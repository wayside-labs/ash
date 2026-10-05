// Pure, with no import at all: the sanitizer uses it on the server and the link dialog uses it in
// the browser, where sanitize-html must never arrive (tests/client-bundle.test.ts).

// https://, http://, mailto:, an anchor, or a path from the root. The scheme list of
// sanitize-html is not enough on its own: it lets "/\evil.com" through as a relative path, and
// browsers read "/\host" (and "\\host") as "//host". It judges a decoded value, which is what
// sanitize-html hands to transformTags and what a form field holds; on raw markup
// "/&#92;evil.com" would wrongly pass.
const SAFE_HREF_RE = /^(?:https?:\/\/|mailto:|#|\/(?![/\\]))/i;

export function isSafeHref(href: string): boolean {
  for (let i = 0; i < href.length; i++) {
    const code = href.charCodeAt(i);
    // A backslash anywhere, or a control character: browsers delete tab and newline before
    // resolving, so "/<tab>/evil.com" is "//evil.com".
    if (code === 0x5c || code <= 0x1f || code === 0x7f) return false;
  }
  return SAFE_HREF_RE.test(href);
}
