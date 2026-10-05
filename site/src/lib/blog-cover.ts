// The cover of a post that has no image: three budget bars, the same drawing the money map uses
// for "spent against a limit" (mint fill, the periwinkle tick at the end is the ceiling). The
// only thing that varies from post to post is how full each bar is, and that comes from the slug,
// so a post always gets the same cover and two builds give the same pages.

export interface GeneratedCover {
  // How full each bar is, in percent of its width.
  bars: [number, number, number];
}

const MIN = 22;
const MAX = 88;

// FNV-1a over the UTF-16 code units: small, stable across machines, good enough to spread slugs.
function hash(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

export function generatedCover(slug: string): GeneratedCover {
  const fill = (salt: string): number => MIN + (hash(`${slug}:${salt}`) % (MAX - MIN + 1));
  return { bars: [fill("a"), fill("b"), fill("c")] };
}
