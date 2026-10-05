import type { PublicPost } from "./blog-types";

// A tag is free text in the studio ("orçamento por sessão") and a URL segment here. The slug is
// the only form that goes in a URL; the tag itself is only ever shown, escaped. Nothing in this
// file throws: a tag an editor typed must never be what stops a deploy.

// FNV-1a over the code points, as eight hex digits: stable across machines and builds.
function hex(text: string): string {
  let h = 0x811c9dc5;
  for (const ch of text) {
    h ^= ch.codePointAt(0) as number;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

// Accents are dropped, not the letters; everything outside a-z and 0-9 becomes a hyphen. A tag
// with no Latin letter or digit ("日本", "---") would leave nothing, so it gets "t-" and a hash of
// its own characters: not readable, but the same on every build and never an empty segment.
export function tagSlug(tag: string): string {
  const slug = tag
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || `t-${hex(tag.normalize("NFC").trim())}`;
}

export interface TagEntry { tag: string; slug: string; count: number }

// The tags of these posts (one language at a time), most used first. Two spellings with one slug
// ("sessão" and "sessao") are one tag: the page shows the first spelling in payload order and
// lists the posts of both. tagCollisions names them for the build log.
export function tagIndex(posts: readonly PublicPost[]): TagEntry[] {
  const bySlug = new Map<string, TagEntry>();
  for (const post of posts) {
    const seen = new Set<string>();
    for (const tag of post.tags) {
      const slug = tagSlug(tag);
      if (seen.has(slug)) continue;
      seen.add(slug);
      const entry = bySlug.get(slug);
      if (entry) entry.count += 1;
      else bySlug.set(slug, { tag, slug, count: 1 });
    }
  }
  return [...bySlug.values()].sort((a, b) => b.count - a.count || (a.tag < b.tag ? -1 : 1));
}

// The slugs more than one spelling maps to, with every spelling in payload order (the first is
// the one shown). Empty when every tag has its own page.
export function tagCollisions(posts: readonly PublicPost[]): Array<{ slug: string; tags: string[] }> {
  const bySlug = new Map<string, string[]>();
  for (const post of posts) {
    for (const tag of post.tags) {
      const slug = tagSlug(tag);
      const spellings = bySlug.get(slug) ?? [];
      if (!spellings.includes(tag)) spellings.push(tag);
      bySlug.set(slug, spellings);
    }
  }
  return [...bySlug].filter(([, tags]) => tags.length > 1).map(([slug, tags]) => ({ slug, tags }));
}

export const postsByTag = (posts: readonly PublicPost[], slug: string): PublicPost[] =>
  posts.filter((p) => p.tags.some((tag) => tagSlug(tag) === slug));
