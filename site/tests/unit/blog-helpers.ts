import type { PublicAuthor, PublicCategory, PublicPayload, PublicPost } from "../../src/lib/blog-types";

// Builders for the blog suites. Not a test file: vitest collects only *.test.ts.
export const category = (slug = "payments", overrides: Partial<PublicCategory> = {}): PublicCategory => ({
  slug, namePt: "Pagamentos", nameEn: "Payments", ...overrides,
});

export const author = (slug = "lucas", overrides: Partial<PublicAuthor> = {}): PublicAuthor => ({
  slug, name: "Lucas", bioPt: "Bio em português", bioEn: "Bio in English", avatarUrl: null, ...overrides,
});

export const post = (slug: string, overrides: Partial<PublicPost> = {}): PublicPost => ({
  slug,
  lang: "en",
  title: `Post ${slug}`,
  excerpt: null,
  html: "<p>body</p>",
  toc: [],
  readingMinutes: 1,
  category: null,
  tags: [],
  author: null,
  coverUrl: null,
  coverAlt: null,
  metaTitle: null,
  metaDescription: null,
  featured: false,
  publishedAt: "2026-09-01T12:00:00.000Z",
  updatedAt: "2026-09-01T12:00:00.000Z",
  translationSlug: null,
  ...overrides,
});

// Categories and authors are derived from the posts, the way the studio builds them.
export function payloadOf(posts: PublicPost[], authors: PublicAuthor[] = []): PublicPayload {
  const categories = new Map<string, PublicCategory>();
  for (const p of posts) if (p.category) categories.set(p.category.slug, p.category);
  return { posts, categories: [...categories.values()], authors };
}

// n posts, the first the newest, one day apart.
export function series(n: number, overrides: Partial<PublicPost> = {}, prefix = "post"): PublicPost[] {
  const newest = Date.parse("2026-09-30T12:00:00.000Z");
  return Array.from({ length: n }, (_, i) => {
    const at = new Date(newest - i * 86_400_000).toISOString();
    return post(`${prefix}-${String(i + 1).padStart(2, "0")}`, { publishedAt: at, updatedAt: at, ...overrides });
  });
}
