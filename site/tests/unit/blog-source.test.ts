import { describe, it, expect } from "vitest";
import { resolve } from "node:path";
import { FIXTURE_PATH, blogApiUrl, blogMode, createBlogLoader, loadBlog, readBlog } from "../../src/lib/blog-source";
import { category, payloadOf, post } from "./blog-helpers";

const payload = payloadOf([post("a-post", { category: category() })]);
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const api = { BLOG_SOURCE: "api", BLOG_API_URL: "https://pub.example/api/public/posts" };
const never = async (): Promise<never> => { throw new Error("must not be called"); };

describe("blogMode", () => {
  it("is off when the variable is missing or empty: the site of today keeps building", () => {
    expect(blogMode({})).toBe("off");
    expect(blogMode({ BLOG_SOURCE: "" })).toBe("off");
    expect(blogMode({ BLOG_SOURCE: "  " })).toBe("off");
    expect(blogMode({ BLOG_SOURCE: "off" })).toBe("off");
  });
  it("knows api and fixture", () => {
    expect(blogMode({ BLOG_SOURCE: "api" })).toBe("api");
    expect(blogMode({ BLOG_SOURCE: "fixture" })).toBe("fixture");
  });
  it.each(["API", "on", "true", "fixtures", "1"])("throws on %j instead of guessing", (value) => {
    expect(() => blogMode({ BLOG_SOURCE: value })).toThrow("BLOG_SOURCE");
  });
});

describe("blogApiUrl", () => {
  it("wants https, or http on this machine", () => {
    expect(blogApiUrl(api).href).toBe("https://pub.example/api/public/posts");
    expect(blogApiUrl({ BLOG_API_URL: "http://127.0.0.1:3100/api/public/posts" }).origin).toBe("http://127.0.0.1:3100");
    expect(blogApiUrl({ BLOG_API_URL: "http://localhost:3100/api/public/posts" }).origin).toBe("http://localhost:3100");
    expect(() => blogApiUrl({})).toThrow("BLOG_API_URL");
    expect(() => blogApiUrl({ BLOG_API_URL: " " })).toThrow("BLOG_API_URL");
    expect(() => blogApiUrl({ BLOG_API_URL: "http://pub.example/api/public/posts" })).toThrow("https");
    expect(() => blogApiUrl({ BLOG_API_URL: "pub.example" })).toThrow("BLOG_API_URL");
  });
  it("never repeats the value, which could carry a credential", () => {
    expect(() => blogApiUrl({ BLOG_API_URL: "https://user:hunter2@pub.example/x" })).toThrow(/^(?!.*hunter2).*$/);
    expect(() => blogApiUrl({ BLOG_API_URL: "http://tok3n.example/x" })).toThrow(/^(?!.*tok3n).*$/);
  });
});

describe("readBlog: off", () => {
  it("touches neither the network nor the disk", async () => {
    expect(await readBlog({ env: {}, fetch: never, readFile: never })).toEqual({ mode: "off" });
  });
});

describe("readBlog: api", () => {
  it("fetches the URL with no-store and a time limit, and returns the validated payload", async () => {
    const calls: Array<[string, RequestInit | undefined]> = [];
    const out = await readBlog({ env: api, fetch: async (url, init) => { calls.push([url, init]); return json(payload); }, readFile: never });
    expect(out).toEqual({ mode: "api", payload });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.[0]).toBe("https://pub.example/api/public/posts");
    expect(calls[0]?.[1]).toMatchObject({ cache: "no-store", redirect: "error" });
    expect(calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal);
  });
  it("accepts a studio with nothing published yet", async () => {
    const empty = { posts: [], categories: [], authors: [] };
    expect(await readBlog({ env: api, fetch: async () => json(empty) })).toEqual({ mode: "api", payload: empty });
  });
  it("throws before fetching when the URL is missing or not allowed", async () => {
    await expect(readBlog({ env: { BLOG_SOURCE: "api" }, fetch: never })).rejects.toThrow("BLOG_API_URL");
    await expect(readBlog({ env: { BLOG_SOURCE: "api", BLOG_API_URL: "http://pub.example/x" }, fetch: never })).rejects.toThrow("https");
  });
  it.each([503, 500, 404, 304, 204, 201])("throws on a %s, saying so and never printing the body", async (status) => {
    const body = status === 204 || status === 304 ? null : "SECRET-BODY";
    const run = readBlog({ env: api, fetch: async () => new Response(body, { status }) });
    await expect(run).rejects.toThrow(`answered ${status}`);
    await expect(run).rejects.toThrow(/^(?!.*SECRET-BODY)[\s\S]*$/);
  });
  it("says the studio is down on a 503", async () => {
    await expect(readBlog({ env: api, fetch: async () => new Response("x", { status: 503 }) })).rejects.toThrow("studio is down");
  });
  it("throws on a body that is not JSON, without printing it", async () => {
    const run = readBlog({ env: api, fetch: async () => new Response("<html>SECRET-BODY</html>", { status: 200 }) });
    await expect(run).rejects.toThrow("not JSON");
    await expect(run).rejects.toThrow(/^(?!.*SECRET-BODY)[\s\S]*$/);
  });
  it("throws on the wrong shape, naming the field and not its value", async () => {
    const bad = JSON.parse(JSON.stringify(payload));
    bad.posts[0].coverUrl = "https://evil.example/SECRET-VALUE.webp";
    const run = readBlog({ env: api, fetch: async () => json(bad) });
    await expect(run).rejects.toThrow("posts[0].coverUrl");
    await expect(run).rejects.toThrow(/^(?!.*SECRET-VALUE)[\s\S]*$/);
    await expect(readBlog({ env: api, fetch: async () => json({ error: "unavailable" }) })).rejects.toThrow("blog payload: posts");
  });
  it("throws when the studio cannot be reached", async () => {
    await expect(readBlog({ env: api, fetch: async () => { throw new TypeError("fetch failed"); } })).rejects.toThrow(/blog api: .*fetch failed/);
  });
  it("throws when the studio does not answer in time", async () => {
    const hang = (_url: string, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(init.signal?.reason)));
    await expect(readBlog({ env: api, fetch: hang, timeoutMs: 20 })).rejects.toThrow("no answer in 20 ms");
  });
});

describe("readBlog: fixture", () => {
  const env = { BLOG_SOURCE: "fixture" };
  it("reads the fixture file from the project root and validates it the same way", async () => {
    const read: string[] = [];
    const out = await readBlog({ env, fetch: never, readFile: async (path) => { read.push(path); return JSON.stringify(payload); } });
    expect(out).toEqual({ mode: "fixture", payload });
    expect(FIXTURE_PATH).toBe("tests/fixtures/blog-payload.json");
    expect(read).toEqual([resolve(FIXTURE_PATH)]);
  });
  it("reads another file when BLOG_FIXTURE_PATH names one, and the checked-in one when it is blank", async () => {
    const read: string[] = [];
    const readFile = async (path: string) => { read.push(path); return JSON.stringify(payload); };
    await readBlog({ env: { ...env, BLOG_FIXTURE_PATH: "test-results/en-only.json" }, readFile });
    await readBlog({ env: { ...env, BLOG_FIXTURE_PATH: "  " }, readFile });
    expect(read).toEqual([resolve("test-results/en-only.json"), resolve(FIXTURE_PATH)]);
    // Only fixture mode looks at it.
    expect(await readBlog({ env: { BLOG_FIXTURE_PATH: "x.json" }, readFile })).toEqual({ mode: "off" });
  });
  it("throws on a fixture that is not valid", async () => {
    await expect(readBlog({ env, readFile: async () => "{not json" })).rejects.toThrow("not JSON");
    await expect(readBlog({ env, readFile: async () => JSON.stringify({ posts: [{}], categories: [], authors: [] }) })).rejects.toThrow("posts[0]");
    await expect(readBlog({ env, readFile: async () => { throw new Error("ENOENT"); } })).rejects.toThrow(/blog fixture: .*ENOENT/);
  });
  it("reads the real file when nothing is injected", async () => {
    const out = await readBlog({ env });
    expect(out.mode).toBe("fixture");
    if (out.mode === "fixture") expect(out.payload.posts.length).toBeGreaterThanOrEqual(17);
  });
});

describe("one load per process", () => {
  it("every caller shares the first load", async () => {
    let calls = 0;
    const load = createBlogLoader();
    const fetch = async () => { calls += 1; return json(payload); };
    const [a, b] = await Promise.all([load({ env: api, fetch }), load({ env: api, fetch })]);
    const c = await load({ env: api, fetch });
    expect(calls).toBe(1);
    expect(a).toBe(b);
    expect(c).toBe(a);
  });
  it("a failure is shared too: the build fails once, not once per page", async () => {
    let calls = 0;
    const load = createBlogLoader();
    const fetch = async () => { calls += 1; return new Response("x", { status: 503 }); };
    await expect(load({ env: api, fetch })).rejects.toThrow("answered 503");
    await expect(load({ env: api, fetch })).rejects.toThrow("answered 503");
    expect(calls).toBe(1);
  });
  it("loadBlog keeps its load on the process, so two copies of this module still share it", async () => {
    let reads = 0;
    const readFile = async () => { reads += 1; return JSON.stringify(payload); };
    const first = await loadBlog({ env: { BLOG_SOURCE: "fixture" }, readFile });
    const second = await loadBlog({ env: { BLOG_SOURCE: "fixture" }, readFile });
    expect(reads).toBe(1);
    expect(second).toBe(first);
    expect(Object.getOwnPropertySymbols(globalThis).map(String)).toContain("Symbol(ash.blog.load)");
  });
});
