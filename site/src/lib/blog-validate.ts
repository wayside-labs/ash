import type { PublicAuthor, PublicCategory, PublicPayload, PublicPost, TocItem } from "./blog-types";

// The build's only check on what the studio sent. A wrong shape stops the build with the path of
// the field, never its value: the message ends up in a public CI log. Every object is rebuilt
// field by field, so a key the studio adds later is tolerated and does not reach a page by
// accident.

export class BlogPayloadError extends Error {
  constructor(readonly path: string, reason: string) {
    super(`blog payload: ${path}: ${reason}`);
    this.name = "BlogPayloadError";
  }
}

// The same patterns as the studio's blog_posts_slug_chk and blog_{categories,authors}_slug_chk.
const POST_SLUG = /^[a-z0-9][a-z0-9-]{0,118}[a-z0-9]$/;
const SHORT_SLUG = /^[a-z0-9][a-z0-9-]{0,58}[a-z0-9]$/;
// The studio's isMediaPath. Segments start with a letter or digit, which rules out ".", ".." and
// empty ones; "%", "?", "#" and "\" are not in the alphabet.
const MEDIA_PATH = /^\/media(?:\/[A-Za-z0-9][A-Za-z0-9._-]*)+$/;
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

export function isMediaPath(value: string): boolean {
  return MEDIA_PATH.test(value) && !value.includes("..");
}

// Where the build may fetch from: the studio over https, or a studio on this machine. Anything
// else is a typo or someone pointing the build at a host that is not ours. The message never
// repeats the value: a URL may carry a credential.
export function parseStudioUrl(raw: string, what: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`${what}: not a URL`);
  }
  const local = url.hostname === "127.0.0.1" || url.hostname === "localhost";
  if (url.protocol !== "https:" && !(url.protocol === "http:" && local)) {
    throw new Error(`${what}: must be https (http only for localhost and 127.0.0.1)`);
  }
  if (url.username || url.password) throw new Error(`${what}: must not carry a user or a password`);
  return url;
}

type Obj = Record<string, unknown>;
const fail = (path: string, reason: string): never => { throw new BlogPayloadError(path, reason); };

function obj(value: unknown, path: string): Obj {
  if (value === null || typeof value !== "object" || Array.isArray(value)) fail(path, "must be an object");
  return value as Obj;
}
function list(o: Obj, key: string, at: string): unknown[] {
  const value = o[key];
  if (!Array.isArray(value)) fail(`${at}${key}`, "must be a list");
  return value as unknown[];
}
function text(o: Obj, key: string, at: string): string {
  const value = o[key];
  if (typeof value !== "string") fail(`${at}${key}`, "must be text");
  return value as string;
}
function filled(o: Obj, key: string, at: string): string {
  const value = text(o, key, at);
  if (!value.trim()) fail(`${at}${key}`, "must not be empty");
  return value;
}
function textOrNull(o: Obj, key: string, at: string): string | null {
  if (!(key in o)) fail(`${at}${key}`, "is missing (null is the empty value)");
  return o[key] === null ? null : text(o, key, at);
}
// For the optional texts a page falls back on (excerpt, alt, meta title and description): the
// studio sends "" for a field someone cleared, and "" is not null to `??`. One that is empty or
// only spaces becomes null here, so every fallback downstream is written once.
function optionalText(o: Obj, key: string, at: string): string | null {
  const value = textOrNull(o, key, at);
  return value === null || !value.trim() ? null : value;
}
function slug(o: Obj, key: string, at: string, pattern: RegExp): string {
  const value = text(o, key, at);
  if (!pattern.test(value)) fail(`${at}${key}`, "is not a slug");
  return value;
}
function mediaOrNull(o: Obj, key: string, at: string): string | null {
  const value = textOrNull(o, key, at);
  if (value !== null && !isMediaPath(value)) fail(`${at}${key}`, "must be null or a /media/ path");
  return value;
}
function instant(o: Obj, key: string, at: string): string {
  const value = text(o, key, at);
  if (!INSTANT.test(value) || Number.isNaN(Date.parse(value))) fail(`${at}${key}`, "must be an ISO instant");
  return value;
}

function category(value: unknown, path: string): PublicCategory {
  const o = obj(value, path);
  const at = `${path}.`;
  return { slug: slug(o, "slug", at, SHORT_SLUG), namePt: filled(o, "namePt", at), nameEn: filled(o, "nameEn", at) };
}

function author(value: unknown, path: string): PublicAuthor {
  const o = obj(value, path);
  const at = `${path}.`;
  return {
    slug: slug(o, "slug", at, SHORT_SLUG), name: filled(o, "name", at),
    bioPt: text(o, "bioPt", at), bioEn: text(o, "bioEn", at), avatarUrl: mediaOrNull(o, "avatarUrl", at),
  };
}

function tocItem(value: unknown, path: string): TocItem {
  const o = obj(value, path);
  const at = `${path}.`;
  if (o.level !== 2 && o.level !== 3) fail(`${at}level`, "must be 2 or 3");
  return { id: filled(o, "id", at), text: text(o, "text", at), level: o.level as 2 | 3 };
}

function tag(value: unknown, path: string): string {
  if (typeof value !== "string") fail(path, "must be text");
  if (!(value as string).trim()) fail(path, "must not be empty");
  return value as string;
}

function post(value: unknown, path: string): PublicPost {
  const o = obj(value, path);
  const at = `${path}.`;
  if (o.lang !== "pt" && o.lang !== "en") fail(`${at}lang`, 'must be "pt" or "en"');
  if (typeof o.readingMinutes !== "number" || !Number.isInteger(o.readingMinutes) || o.readingMinutes < 1) {
    fail(`${at}readingMinutes`, "must be a whole number of minutes, 1 or more");
  }
  if (typeof o.featured !== "boolean") fail(`${at}featured`, "must be true or false");
  if (!("category" in o)) fail(`${at}category`, "is missing (null is the empty value)");
  if (!("author" in o)) fail(`${at}author`, "is missing (null is the empty value)");

  let by: PublicPost["author"] = null;
  if (o.author !== null) {
    const a = obj(o.author, `${at}author`);
    by = { slug: slug(a, "slug", `${at}author.`, SHORT_SLUG), name: filled(a, "name", `${at}author.`) };
  }
  const translation = textOrNull(o, "translationSlug", at);
  if (translation !== null && !POST_SLUG.test(translation)) fail(`${at}translationSlug`, "is not a slug");

  return {
    slug: slug(o, "slug", at, POST_SLUG),
    lang: o.lang as PublicPost["lang"],
    title: filled(o, "title", at),
    excerpt: optionalText(o, "excerpt", at),
    html: text(o, "html", at),
    toc: list(o, "toc", at).map((item, i) => tocItem(item, `${at}toc[${i}]`)),
    readingMinutes: o.readingMinutes as number,
    category: o.category === null ? null : category(o.category, `${at}category`),
    tags: list(o, "tags", at).map((item, i) => tag(item, `${at}tags[${i}]`)),
    author: by,
    coverUrl: mediaOrNull(o, "coverUrl", at),
    coverAlt: optionalText(o, "coverAlt", at),
    metaTitle: optionalText(o, "metaTitle", at),
    metaDescription: optionalText(o, "metaDescription", at),
    featured: o.featured as boolean,
    publishedAt: instant(o, "publishedAt", at),
    updatedAt: instant(o, "updatedAt", at),
    translationSlug: translation,
  };
}

function unique(keys: string[], name: string): Set<string> {
  const seen = new Set<string>();
  keys.forEach((key, i) => {
    if (seen.has(key)) fail(`${name}[${i}].slug`, "appears twice");
    seen.add(key);
  });
  return seen;
}

// Throws BlogPayloadError on the first field that is missing or wrong.
export function validatePayload(input: unknown): PublicPayload {
  const root = obj(input, "payload");
  const posts = list(root, "posts", "").map((p, i) => post(p, `posts[${i}]`));
  const categories = list(root, "categories", "").map((c, i) => category(c, `categories[${i}]`));
  const authors = list(root, "authors", "").map((a, i) => author(a, `authors[${i}]`));

  const postKeys = unique(posts.map((p) => `${p.lang}/${p.slug}`), "posts");
  const categorySlugs = unique(categories.map((c) => c.slug), "categories");
  const authorSlugs = unique(authors.map((a) => a.slug), "authors");

  posts.forEach((p, i) => {
    if (p.category && !categorySlugs.has(p.category.slug)) fail(`posts[${i}].category.slug`, "is not in categories");
    if (p.author && !authorSlugs.has(p.author.slug)) fail(`posts[${i}].author.slug`, "is not in authors");
    if (p.translationSlug === null) return;
    const other = p.lang === "pt" ? "en" : "pt";
    if (!postKeys.has(`${other}/${p.translationSlug}`)) fail(`posts[${i}].translationSlug`, `no ${other} post has this slug`);
    // hreflang is only valid in pairs: a one-way link is an error at the source, not a detail.
    const back = posts.find((q) => q.lang === other && q.slug === p.translationSlug);
    if (back?.translationSlug !== p.slug) fail(`posts[${i}].translationSlug`, "the translation does not point back");
  });

  return { posts, categories, authors };
}
