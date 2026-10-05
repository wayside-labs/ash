import { mediaTarget } from "./blog-media";
import type { PublicPayload } from "./blog-types";

// og:image for a post with a cover. The studio serves WebP, which several link previews still do
// not draw, so the build writes a JPEG beside each cover (the integration in
// src/integrations/blog-media.ts) and the post points there. A post with no cover keeps the
// site's og.png.

export const OG_WIDTH = 1200;
export const OG_HEIGHT = 630;

// Relative to the build output: "/media/posts/a/b.webp" -> "blog-media/posts/a/b.webp.og.jpg".
// The suffix is appended, never swapped, so two covers can never share a name.
export const ogImageTarget = (coverUrl: string): string => `${mediaTarget(coverUrl)}.og.jpg`;
export const ogImageHref = (coverUrl: string): string => `/${ogImageTarget(coverUrl)}`;

// One job per cover, however many posts share it. Sorted, so two builds do the same work.
export function ogJobs(payload: PublicPayload): Array<{ source: string; target: string }> {
  const covers = new Set(payload.posts.flatMap((p) => (p.coverUrl === null ? [] : [p.coverUrl])));
  return [...covers].sort().map((cover) => ({ source: mediaTarget(cover), target: ogImageTarget(cover) }));
}
