// Not a full HTML entity table: only what sanitize-html writes into text (&amp; &lt; &gt; &quot;),
// the two an author's HTML commonly carries (&nbsp; &apos;) and the numeric forms. Anything else
// is left as it is. The result is plain text, not HTML: whoever renders it must escape it.

const NAMED: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: String.fromCharCode(160),
};

// Every quantifier is bounded, so a run of "&#" cannot make this backtrack.
const ENTITY_RE = /&(?:#(\d{1,7})|#x([0-9a-f]{1,6})|(amp|lt|gt|quot|apos|nbsp));/gi;

function fromCodePoint(code: number, original: string): string {
  const valid = code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff);
  return valid ? String.fromCodePoint(code) : original;
}

// One pass, so text that was escaped twice comes out escaped once, never executed.
export function decodeEntities(text: string): string {
  return text.replace(ENTITY_RE, (whole, decimal?: string, hex?: string, name?: string) => {
    if (decimal) return fromCodePoint(Number.parseInt(decimal, 10), whole);
    if (hex) return fromCodePoint(Number.parseInt(hex, 16), whole);
    return NAMED[(name as string).toLowerCase()] ?? whole;
  });
}
