import { mediaHref } from "./blog-media";
import type { BlogLang, PublicAuthor, PublicCategory, PublicPayload, PublicPost } from "./blog-types";

// What the blog pages list and in which order. Pure: every function takes the payload (or a list
// of posts of one language) and returns new arrays.

export const PAGE_SIZE = 12;
// Where the blog is written from. A date is formatted in this zone on every machine, so the
// build server (UTC) and a laptop print the same day.
export const BLOG_TIME_ZONE = "America/Sao_Paulo";

// Newest first; the slug settles a tie so two builds of the same payload give the same pages.
const newestFirst = (a: PublicPost, b: PublicPost): number =>
  Date.parse(b.publishedAt) - Date.parse(a.publishedAt) || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0);

export function postsByLang(payload: PublicPayload, lang: BlogLang): PublicPost[] {
  return payload.posts.filter((p) => p.lang === lang).sort(newestFirst);
}

// The order of the index: featured posts on top, each group in the order it came.
export function indexPosts(posts: readonly PublicPost[]): PublicPost[] {
  return [...posts.filter((p) => p.featured), ...posts.filter((p) => !p.featured)];
}

// Never zero: an empty blog still has its first page.
export const pageCount = (total: number, size: number = PAGE_SIZE): number => Math.max(1, Math.ceil(total / size));

export interface Page<T> { items: T[]; page: number; pageCount: number; total: number }

// Throws RangeError on a page that does not exist: a route for it would be an empty page.
export function paginate<T>(items: readonly T[], page: number, size: number = PAGE_SIZE): Page<T> {
  const pages = pageCount(items.length, size);
  if (!Number.isInteger(page) || page < 1 || page > pages) throw new RangeError(`blog: page ${page} of ${pages} does not exist`);
  return { items: items.slice((page - 1) * size, page * size), page, pageCount: pages, total: items.length };
}

// Page 1 is the index itself; these are the ones that need a route (/blog/page/2/ ...).
export function extraPages(total: number, size: number = PAGE_SIZE): number[] {
  return Array.from({ length: pageCount(total, size) - 1 }, (_, i) => i + 2);
}

export const postsByCategory = (posts: readonly PublicPost[], slug: string): PublicPost[] =>
  posts.filter((p) => p.category?.slug === slug);

export const postsByAuthor = (posts: readonly PublicPost[], slug: string): PublicPost[] =>
  posts.filter((p) => p.author?.slug === slug);

// The categories these posts use, once each, by slug: the pages a language needs.
export function categoriesOf(posts: readonly PublicPost[]): PublicCategory[] {
  const found = new Map<string, PublicCategory>();
  for (const p of posts) if (p.category && !found.has(p.category.slug)) found.set(p.category.slug, p.category);
  return [...found.values()].sort((a, b) => (a.slug < b.slug ? -1 : 1));
}

export function authorSlugsOf(posts: readonly PublicPost[]): string[] {
  return [...new Set(posts.flatMap((p) => (p.author ? [p.author.slug] : [])))].sort();
}

// Posts that share a tag come first, the more tags the higher; then the ones that only share the
// category. Same language only, never the post itself, and a post that shares nothing is not
// "related": the list may come back shorter than n, or empty.
export function relatedPosts(post: PublicPost, all: readonly PublicPost[], n = 3): PublicPost[] {
  const tags = new Set(post.tags);
  const seen = new Set<string>([post.slug]);
  const scored: Array<{ p: PublicPost; shared: number }> = [];
  for (const p of all) {
    if (p.lang !== post.lang || seen.has(p.slug)) continue;
    seen.add(p.slug);
    const shared = new Set(p.tags.filter((t) => tags.has(t))).size;
    const sameCategory = post.category !== null && p.category?.slug === post.category.slug;
    if (shared > 0 || sameCategory) scored.push({ p, shared });
  }
  return scored
    .sort((a, b) => b.shared - a.shared || newestFirst(a.p, b.p))
    .slice(0, Math.max(0, n))
    .map((s) => s.p);
}

// The words the blog's own routes use, in both languages. A post with one of these as its slug
// would be built over /blog/tag/, /pt/blog/pagina/ and so on.
export const RESERVED_SLUGS: readonly string[] = ["page", "category", "tag", "author", "rss.xml", "pagina", "categoria", "autor"];

export function assertNoReservedSlugs(posts: readonly PublicPost[]): void {
  const taken = posts.filter((p) => RESERVED_SLUGS.includes(p.slug)).map((p) => `${p.lang}/${p.slug}`);
  if (taken.length > 0) {
    throw new Error(`blog: post slug collides with a blog route: ${taken.join(", ")}. Rename the post in the studio.`);
  }
}

const DATE_LOCALE: Record<BlogLang, string> = { en: "en-US", pt: "pt-BR" };

// "October 1, 2026" / "1 de outubro de 2026".
export function formatPostDate(iso: string, lang: BlogLang, timeZone: string = BLOG_TIME_ZONE): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) throw new Error("blog: not a date");
  return new Intl.DateTimeFormat(DATE_LOCALE[lang], { day: "numeric", month: "long", year: "numeric", timeZone }).format(date);
}

export const categoryName = (category: PublicCategory, lang: BlogLang): string => (lang === "pt" ? category.namePt : category.nameEn);
export const authorBio = (author: PublicAuthor, lang: BlogLang): string => (lang === "pt" ? author.bioPt : author.bioEn);

// The cover as a page uses it: the address of the copy in blog-media and an alt that is never
// empty. null when the post has no cover; what to draw then is the page's choice.
export function coverOf(post: PublicPost): { src: string; alt: string } | null {
  if (post.coverUrl === null) return null;
  return { src: mediaHref(post.coverUrl), alt: post.coverAlt?.trim() || post.title };
}
