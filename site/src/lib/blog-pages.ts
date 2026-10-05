import { postsByLang } from "./blog-model";
import { blogIndexPath } from "./blog-paths";
import { rssXml } from "./blog-rss";
import { loadBlog } from "./blog-source";
import type { BlogLang, PublicPayload } from "./blog-types";
import {
  assertBuildable, authorRoutes, buildWarnings, categoryRoutes, hasPosts, indexRoutes, postRoutes, tagRoutes,
  type ListView, type PostView, type Route,
} from "./blog-views";

// The one place where the blog's pages meet the build's environment. Every route asks here, so
// "off" means the same thing everywhere: no page, no feed, no link.

export const SITE_URL = "https://ash.app.br";

// Said once per build, whatever number of routes asks. On globalThis because the build may
// evaluate this module more than once.
const ONCE = Symbol.for("ash.blog.said");
const said = ((globalThis as unknown as Record<symbol, Set<string> | undefined>)[ONCE] ??= new Set<string>());

// A line for the build log that does not stop the build. The same line is printed once.
export function warnOnce(message: string): void {
  if (said.has(message)) return;
  said.add(message);
  console.warn(`[blog] ${message}`);
}

// The payload, or null when the blog is off. What must stop the build stops it on the first
// route that asks, before any page is written; what only deserves a line in the log gets one.
export async function blogPayload(): Promise<PublicPayload | null> {
  const load = await loadBlog({ env: process.env });
  if (load.mode === "off") return null;
  assertBuildable(load.payload);
  for (const warning of buildWarnings(load.payload)) warnOnce(warning);
  return load.payload;
}

// For the header and the footer: the blog of this language, or null when there is nothing to
// link to (the blog is off, or nobody has published in this language yet).
export async function blogLink(lang: BlogLang): Promise<string | null> {
  const payload = await blogPayload();
  return payload !== null && hasPosts(payload, lang) ? blogIndexPath(lang) : null;
}

const routes = <P>(build: (payload: PublicPayload, lang: BlogLang) => Route<P>[]) =>
  async (lang: BlogLang): Promise<Route<P>[]> => {
    const payload = await blogPayload();
    return payload === null ? [] : build(payload, lang);
  };

// What each page's getStaticPaths returns. An empty list is "this route does not exist".
export const indexPaths: (lang: BlogLang) => Promise<Route<ListView>[]> = routes(indexRoutes);
export const postPaths: (lang: BlogLang) => Promise<Route<PostView>[]> = routes(postRoutes);
export const categoryPaths: (lang: BlogLang) => Promise<Route<ListView>[]> = routes(categoryRoutes);
export const tagPaths: (lang: BlogLang) => Promise<Route<ListView>[]> = routes(tagRoutes);
export const authorPaths: (lang: BlogLang) => Promise<Route<ListView>[]> = routes(authorRoutes);

// The feed is a route with one parameter that only ever has one value: a plain rss.xml.ts would
// be written in "off" mode too. A language with no post has no feed: an empty one would be a
// file to subscribe to that says nothing.
export async function feedPaths(lang: BlogLang): Promise<Array<{ params: { feed: string } }>> {
  const payload = await blogPayload();
  return payload !== null && hasPosts(payload, lang) ? [{ params: { feed: "rss" } }] : [];
}

export async function feedResponse(lang: BlogLang, channel: { title: string; description: string }): Promise<Response> {
  const payload = await blogPayload();
  if (payload === null) return new Response(null, { status: 404 });
  const xml = rssXml({ lang, posts: postsByLang(payload, lang), siteUrl: SITE_URL, ...channel });
  return new Response(xml, { headers: { "content-type": "application/rss+xml; charset=utf-8" } });
}
