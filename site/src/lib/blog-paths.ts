import { postsByAuthor, postsByCategory } from "./blog-model";
import type { BlogLang, PublicPayload, PublicPost } from "./blog-types";

// Every URL of the blog, in one place. English has no prefix and Portuguese lives under /pt/ with
// its own words, like the rest of the site (/investor/ and /pt/investidor/).

const ROOT: Record<BlogLang, string> = { en: "/blog/", pt: "/pt/blog/" };
const WORDS: Record<BlogLang, { page: string; category: string; author: string }> = {
  en: { page: "page", category: "category", author: "author" },
  pt: { page: "pagina", category: "categoria", author: "autor" },
};
const other = (lang: BlogLang): BlogLang => (lang === "pt" ? "en" : "pt");

// Slugs only. The validator already holds post, category and author slugs to this alphabet and
// tagSlug produces it; checked here again because this is where a string becomes a path.
const SEGMENT = /^[a-z0-9][a-z0-9-]*$/;
function segment(value: string): string {
  if (!SEGMENT.test(value)) throw new Error(`blog path: ${JSON.stringify(value)} is not a URL segment`);
  return value;
}

export function blogIndexPath(lang: BlogLang, page = 1): string {
  if (!Number.isInteger(page) || page < 1) throw new RangeError(`blog path: page ${page} does not exist`);
  return page === 1 ? ROOT[lang] : `${ROOT[lang]}${WORDS[lang].page}/${page}/`;
}
export const postPath = (lang: BlogLang, slug: string): string => `${ROOT[lang]}${segment(slug)}/`;
export const categoryPath = (lang: BlogLang, slug: string): string => `${ROOT[lang]}${WORDS[lang].category}/${segment(slug)}/`;
// Takes the tag's slug (tagSlug), never the tag.
export const tagPath = (lang: BlogLang, slug: string): string => `${ROOT[lang]}tag/${segment(slug)}/`;
export const authorPath = (lang: BlogLang, slug: string): string => `${ROOT[lang]}${WORDS[lang].author}/${segment(slug)}/`;
export const rssPath = (lang: BlogLang): string => `${ROOT[lang]}rss.xml`;

// For the places that need a full address: canonical, og:url, JSON-LD, the feed. The site URL is
// a parameter so nothing here knows the domain.
export function absoluteUrl(siteUrl: string, path: string): string {
  let site: URL;
  try {
    site = new URL(siteUrl);
  } catch {
    throw new Error("blog: the site URL is not a URL");
  }
  if (site.protocol !== "https:" && site.protocol !== "http:") throw new Error("blog: the site URL must be http(s)");
  // "//host/x" is a path to a browser and another origin to new URL().
  if (!path.startsWith("/") || path.startsWith("//") || path.includes("\\")) throw new Error("blog: a path must start with one slash");
  return new URL(path, site.origin).href;
}

// The alternates: the same page in the other language, or null when there is none. null means
// "emit no hreflang at all": an alternate that leads to a 404 is worse than none. Tag pages and
// the paginated ones have no alternate (a tag is a word of one language).

export function postAlternate(post: PublicPost): string | null {
  return post.translationSlug === null ? null : postPath(other(post.lang), post.translationSlug);
}

const inLang = (payload: PublicPayload, lang: BlogLang): PublicPost[] => payload.posts.filter((p) => p.lang === lang);

export function indexAlternate(lang: BlogLang, payload: PublicPayload): string | null {
  return inLang(payload, other(lang)).length > 0 ? blogIndexPath(other(lang)) : null;
}

export function categoryAlternate(lang: BlogLang, slug: string, payload: PublicPayload): string | null {
  return postsByCategory(inLang(payload, other(lang)), slug).length > 0 ? categoryPath(other(lang), slug) : null;
}

export function authorAlternate(lang: BlogLang, slug: string, payload: PublicPayload): string | null {
  return postsByAuthor(inLang(payload, other(lang)), slug).length > 0 ? authorPath(other(lang), slug) : null;
}

// Where the header's language switch leads from a blog page: the alternate when there is one,
// the other language's blog otherwise.
export function langSwitchTarget(lang: BlogLang, alternate: string | null): string {
  return alternate ?? blogIndexPath(other(lang));
}
