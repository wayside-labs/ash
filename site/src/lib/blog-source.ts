import { readFile as readFileFromDisk } from "node:fs/promises";
import { resolve } from "node:path";
import type { PublicPayload } from "./blog-types";
import { parseStudioUrl, validatePayload } from "./blog-validate";

// Where the build gets the blog from, chosen by BLOG_SOURCE:
// - unset (or "off"): no blog. No page is generated and the "Blog" link does not appear. This is
//   what keeps the site building while the studio is not live.
// - "api": GET BLOG_API_URL. Anything other than a 200 with the right shape stops the build: a
//   deploy with an empty blog by mistake is worse than no deploy.
// - "fixture": tests/fixtures/blog-payload.json, for pull requests, tests and e2e.
// Nothing here prints a response body or the URL: the message lands in a public CI log.

export type BlogMode = "off" | "api" | "fixture";
export type BlogLoad = { mode: "off" } | { mode: "api" | "fixture"; payload: PublicPayload };
export type BlogEnv = Record<string, string | undefined>;

export interface BlogSourceOptions {
  // process.env at build time.
  env: BlogEnv;
  fetch?: (url: string, init?: RequestInit) => Promise<Response>;
  readFile?: (path: string) => Promise<string>;
  timeoutMs?: number;
}

// Relative to the project root, which is where astro and vitest run from.
export const FIXTURE_PATH = "tests/fixtures/blog-payload.json";

export function blogMode(env: BlogEnv): BlogMode {
  const value = (env.BLOG_SOURCE ?? "").trim();
  if (value === "" || value === "off") return "off";
  if (value === "api" || value === "fixture") return value;
  throw new Error('BLOG_SOURCE must be "api", "fixture", "off" or unset');
}

// The whole endpoint address (https://<studio>/api/public/posts). Its origin is also where the
// images are downloaded from.
export function blogApiUrl(env: BlogEnv): URL {
  const raw = (env.BLOG_API_URL ?? "").trim();
  if (!raw) throw new Error("BLOG_API_URL is required when BLOG_SOURCE=api");
  return parseStudioUrl(raw, "BLOG_API_URL");
}

function parse(text: string, what: string): PublicPayload {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    // The parser's own message quotes the text around the error: not repeated here.
    throw new Error(`${what}: the body is not JSON`);
  }
  return validatePayload(data);
}

async function fromApi(opts: BlogSourceOptions): Promise<PublicPayload> {
  const url = blogApiUrl(opts.env);
  const timeoutMs = opts.timeoutMs ?? 15_000;
  const request = opts.fetch ?? ((input, init) => fetch(input, init));
  let res: Response;
  let text: string;
  try {
    // redirect "error": a redirect is not "200 with the right shape", and following one could
    // take the build to another host.
    res = await request(url.href, { cache: "no-store", redirect: "error", headers: { accept: "application/json" }, signal: AbortSignal.timeout(timeoutMs) });
    if (res.status !== 200) {
      throw new Error(`answered ${res.status}${res.status === 503 ? " (the studio is down)" : ""}; the blog was not built`);
    }
    text = await res.text();
  } catch (err) {
    const timedOut = (err as Error)?.name === "TimeoutError";
    throw new Error(`blog api: ${timedOut ? `no answer in ${timeoutMs} ms` : (err as Error).message}`);
  }
  return parse(text, "blog api");
}

async function fromFixture(opts: BlogSourceOptions): Promise<PublicPayload> {
  const read = opts.readFile ?? ((path: string) => readFileFromDisk(path, "utf8"));
  let text: string;
  try {
    // BLOG_FIXTURE_PATH: another file of the same shape, for a test that needs a payload the
    // checked-in fixture is not (posts in one language only).
    text = await read(resolve((opts.env.BLOG_FIXTURE_PATH ?? "").trim() || FIXTURE_PATH));
  } catch (err) {
    throw new Error(`blog fixture: ${(err as Error).message}`);
  }
  return parse(text, "blog fixture");
}

// One read, no memory. Pages use loadBlog.
export async function readBlog(opts: BlogSourceOptions): Promise<BlogLoad> {
  const mode = blogMode(opts.env);
  if (mode === "off") return { mode };
  return { mode, payload: mode === "api" ? await fromApi(opts) : await fromFixture(opts) };
}

// The first call decides; every later one gets the same promise, a failed one included, so a
// studio that is down is asked once and not once per page.
export function createBlogLoader(store: { load?: Promise<BlogLoad> } = {}): (opts: BlogSourceOptions) => Promise<BlogLoad> {
  return (opts) => (store.load ??= readBlog(opts));
}

// Kept on globalThis under a registered symbol: the build may evaluate this module more than once
// (the pages' bundle and the config's integration), and both must see the same payload.
const KEY = Symbol.for("ash.blog.load");
const shared = globalThis as unknown as Record<symbol, { load?: Promise<BlogLoad> } | undefined>;

export const loadBlog = createBlogLoader((shared[KEY] ??= {}));
