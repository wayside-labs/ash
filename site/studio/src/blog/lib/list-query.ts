// The query string of /blog. Anything the page does not recognise falls back to the default: a
// hand-edited or stale link shows the list, never an error page.
import { POST_LANGS } from "../schemas";
import { POST_STATUSES, type PostLang, type PostStatus } from "./post-status";

export const BLOG_VIEWS = ["posts", "revisao", "agendados"] as const;
export type BlogView = (typeof BLOG_VIEWS)[number];

export type BlogQuery = { view: BlogView; lang: PostLang | null; status: PostStatus | null };

type RawQuery = Record<string, string | string[] | undefined>;

// includes() on the list, never a lookup in an object: "constructor" is not a view.
function pick<T extends string>(allowed: readonly T[], value: unknown): T | null {
  return typeof value === "string" && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : null;
}

export function parseBlogQuery(raw: RawQuery): BlogQuery {
  const view = pick(BLOG_VIEWS, raw.view) ?? "posts";
  // The review and schedule tabs are a state in themselves; only the posts tab is filtered.
  if (view !== "posts") return { view, lang: null, status: null };
  return { view, lang: pick(POST_LANGS, raw.lang), status: pick(POST_STATUSES, raw.status) };
}

export function blogHref(query: Partial<BlogQuery>): string {
  const params = new URLSearchParams();
  const view = query.view ?? "posts";
  if (view !== "posts") params.set("view", view);
  else {
    if (query.lang) params.set("lang", query.lang);
    if (query.status) params.set("status", query.status);
  }
  const search = params.toString();
  return search ? `/blog?${search}` : "/blog";
}
