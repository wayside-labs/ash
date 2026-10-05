import { parseBody } from "./blog-html";
import { mediaHref } from "./blog-media";
import {
  assertNoReservedSlugs, categoriesOf, authorSlugsOf, extraPages, formatPostDate, indexPosts, paginate,
  postsByAuthor, postsByCategory, postsByLang, relatedPosts,
} from "./blog-model";
import {
  authorAlternate, authorPath, blogIndexPath, categoryAlternate, categoryPath, indexAlternate,
  langSwitchTarget, postAlternate, postPath, rssPath, tagPath,
} from "./blog-paths";
import { postsByTag, tagCollisions, tagIndex, type TagEntry } from "./blog-tags";
import type { BlogLang, PublicAuthor, PublicCategory, PublicPayload, PublicPost } from "./blog-types";

// What each blog page receives, built from the payload alone. Pure: the pages' getStaticPaths
// return these lists (blog-pages.ts adds the source), and a page is only markup over its view.

const LANGS: readonly BlogLang[] = ["en", "pt"];

export interface ListView {
  lang: BlogLang;
  kind: "index" | "category" | "tag" | "author";
  path: string;
  // The same page in the other language, or null: then no hreflang is emitted.
  altPath: string | null;
  // The English page of the pair, for hreflang="x-default".
  xDefaultPath: string;
  // Where the header's language switch leads.
  langHref: string;
  // Tag pages, /page/2 onwards and the index of a language with no post: out of the search
  // index and out of the sitemap.
  noindex: boolean;
  // The feed of this language, or null when the language has no post (and so no feed).
  rss: string | null;
  posts: PublicPost[];
  page: number;
  pageCount: number;
  // The categories this language has posts in, for the row of links above every list.
  categories: PublicCategory[];
  category: PublicCategory | null;
  tag: TagEntry | null;
  author: PublicAuthor | null;
}

export interface PostView {
  lang: BlogLang;
  post: PublicPost;
  path: string;
  altPath: string | null;
  xDefaultPath: string;
  langHref: string;
  rss: string;
  related: PublicPost[];
  // The whole author (bio, avatar), when the post has one.
  author: PublicAuthor | null;
}

export interface Route<P> { params: Record<string, string | undefined>; props: P }

// What must stop the build, checked for both languages whichever page asked: a post whose slug
// is one of the blog's own routes, a body with anything outside the studio's allowlist, and a
// contents entry that points at a heading the body does not have (the link would lead nowhere,
// silently). The ids are the parsed body's, so one that only appears in the text does not count.
export function assertBuildable(payload: PublicPayload): void {
  assertNoReservedSlugs(payload.posts);
  for (const post of payload.posts) {
    const where = `blog: post ${post.lang}/${post.slug}`;
    let ids: string[];
    try {
      ids = parseBody(post.html).ids;
    } catch (err) {
      throw new Error(`${where}: ${(err as Error).message}`);
    }
    const missing = post.toc.find((item) => !ids.includes(item.id));
    if (missing) throw new Error(`${where}: the contents point at #${missing.id}, which is not a heading of the body`);
  }
}

// What the build log should say and the build should survive: spellings of a tag that share one
// page (tagIndex merges them).
export function buildWarnings(payload: PublicPayload): string[] {
  return LANGS.flatMap((lang) => tagCollisions(postsByLang(payload, lang)).map(({ slug, tags }) =>
    `blog: the ${lang} tags ${tags.map((t) => JSON.stringify(t)).join(" and ")} share the page /tag/${slug}/; it is titled ${JSON.stringify(tags[0])}. Keep one spelling in the studio.`));
}

export const hasPosts = (payload: PublicPayload, lang: BlogLang): boolean => payload.posts.some((p) => p.lang === lang);

// The index of a language nobody has written in yet: built, because the language switch needs
// somewhere to land, and kept out of the sitemap.
export const emptyIndexPaths = (payload: PublicPayload): string[] =>
  LANGS.filter((lang) => !hasPosts(payload, lang)).map((lang) => blogIndexPath(lang));

const xDefault = (lang: BlogLang, path: string, altPath: string | null): string => (lang === "en" ? path : altPath ?? path);

function listView(lang: BlogLang, payload: PublicPayload, part: Pick<ListView, "kind" | "path" | "altPath" | "posts"> & Partial<ListView>): ListView {
  return {
    lang,
    xDefaultPath: xDefault(lang, part.path, part.altPath),
    langHref: langSwitchTarget(lang, part.altPath),
    noindex: false,
    rss: hasPosts(payload, lang) ? rssPath(lang) : null,
    page: 1,
    pageCount: 1,
    categories: categoriesOf(postsByLang(payload, lang)),
    category: null,
    tag: null,
    author: null,
    ...part,
  };
}

// The author as the payload lists it; a post that names one the payload forgot still gets a page.
function fullAuthor(payload: PublicPayload, ref: { slug: string; name: string }): PublicAuthor {
  return payload.authors.find((a) => a.slug === ref.slug) ?? { slug: ref.slug, name: ref.name, bioPt: "", bioEn: "", avatarUrl: null };
}

// /blog/ and /blog/page/2/ ... from one rest route: its parameter is what follows the blog root,
// undefined for the index itself. A language with no post still gets its index (the other
// language's switch leads there), but that page is noindex and takes no part in hreflang: an
// empty page is not the translation of a full one.
export function indexRoutes(payload: PublicPayload, lang: BlogLang): Route<ListView>[] {
  const ordered = indexPosts(postsByLang(payload, lang));
  const root = blogIndexPath(lang);
  const empty = ordered.length === 0;
  return [1, ...extraPages(ordered.length)].map((n) => {
    const { items, page, pageCount } = paginate(ordered, n);
    const path = blogIndexPath(lang, n);
    // A paginated page has no alternate: page 2 of one language is not page 2 of the other.
    const altPath = n === 1 && !empty ? indexAlternate(lang, payload) : null;
    return {
      params: { page: n === 1 ? undefined : path.slice(root.length).replace(/\/$/, "") },
      props: listView(lang, payload, { kind: "index", path, altPath, posts: items, page, pageCount, noindex: n > 1 || empty }),
    };
  });
}

export function categoryRoutes(payload: PublicPayload, lang: BlogLang): Route<ListView>[] {
  const posts = postsByLang(payload, lang);
  return categoriesOf(posts).map((category) => ({
    params: { slug: category.slug },
    props: listView(lang, payload, {
      kind: "category", path: categoryPath(lang, category.slug), altPath: categoryAlternate(lang, category.slug, payload),
      posts: postsByCategory(posts, category.slug), category,
    }),
  }));
}

export function tagRoutes(payload: PublicPayload, lang: BlogLang): Route<ListView>[] {
  const posts = postsByLang(payload, lang);
  return tagIndex(posts).map((tag) => ({
    params: { tag: tag.slug },
    props: listView(lang, payload, { kind: "tag", path: tagPath(lang, tag.slug), altPath: null, posts: postsByTag(posts, tag.slug), tag, noindex: true }),
  }));
}

export function authorRoutes(payload: PublicPayload, lang: BlogLang): Route<ListView>[] {
  const posts = postsByLang(payload, lang);
  return authorSlugsOf(posts).map((slug) => {
    const mine = postsByAuthor(posts, slug);
    const ref = (mine[0] as PublicPost).author as { slug: string; name: string };
    return {
      params: { slug },
      props: listView(lang, payload, {
        kind: "author", path: authorPath(lang, slug), altPath: authorAlternate(lang, slug, payload), posts: mine, author: fullAuthor(payload, ref),
      }),
    };
  });
}

export function postRoutes(payload: PublicPayload, lang: BlogLang): Route<PostView>[] {
  const posts = postsByLang(payload, lang);
  return posts.map((post) => {
    const path = postPath(lang, post.slug);
    const altPath = postAlternate(post);
    return {
      params: { slug: post.slug },
      props: {
        lang, post, path, altPath,
        xDefaultPath: xDefault(lang, path, altPath),
        langHref: langSwitchTarget(lang, altPath),
        rss: rssPath(lang),
        related: relatedPosts(post, posts),
        author: post.author ? fullAuthor(payload, post.author) : null,
      },
    };
  });
}

// The day of the last edit, only when it is another day than the publication: a post saved twice
// in one afternoon was not "updated" as far as a reader cares.
export function updatedDay(post: PublicPost, lang: BlogLang): string | null {
  const updated = formatPostDate(post.updatedAt, lang);
  return updated === formatPostDate(post.publishedAt, lang) ? null : updated;
}

export const avatarOf = (author: PublicAuthor): string | null => (author.avatarUrl === null ? null : mediaHref(author.avatarUrl));
