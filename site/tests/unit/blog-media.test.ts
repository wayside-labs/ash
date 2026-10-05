import { describe, it, expect } from "vitest";
import { resolve, sep } from "node:path";
import { collectMedia, downloadMedia, fixtureMediaFetch, mediaHref, mediaTarget } from "../../src/lib/blog-media";
import { author, payloadOf, post } from "./blog-helpers";

// The smallest thing that passes for a WebP: the RIFF container header.
const webp = (extra = 0) => {
  const bytes = new Uint8Array(12 + extra);
  bytes.set([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);
  return bytes;
};
const ok = (body: BodyInit = webp(), headers: Record<string, string> = {}) =>
  new Response(body, { status: 200, headers: { "content-type": "image/webp", ...headers } });

function disk() {
  const files = new Map<string, Uint8Array>();
  const dirs: string[] = [];
  return {
    files, dirs,
    writeFile: async (path: string, bytes: Uint8Array) => void files.set(path, bytes),
    mkdir: async (path: string) => void dirs.push(path),
  };
}
const out = resolve("dist-test");

describe("collectMedia", () => {
  it("lists every image of bodies, covers and avatars once, sorted", () => {
    const payload = payloadOf(
      [
        post("a-post", { coverUrl: "/media/posts/a/cover.webp", html: '<p><img src="/media/posts/a/body.webp" alt="" /></p>{{mapa}}<p><img src="/media/posts/a/cover.webp" /></p>' }),
        post("b-post", { html: "<p>no image, only the text /media/posts/b/text.webp</p>" }),
      ],
      [author("lucas", { avatarUrl: "/media/autores/l/face.webp" }), author("ana")],
    );
    expect(collectMedia(payload)).toEqual(["/media/autores/l/face.webp", "/media/posts/a/body.webp", "/media/posts/a/cover.webp"]);
  });
  it("lists the /media/ files a body links to, and only those links", () => {
    const html = '<p><a href="/media/posts/a/full.webp"><img src="/media/posts/a/thumb.webp" /></a> <a href="https://example.org/media/x.webp">out</a> <a href="/pitch/">in</a></p>';
    expect(collectMedia(payloadOf([post("a-post", { html })]))).toEqual(["/media/posts/a/full.webp", "/media/posts/a/thumb.webp"]);
  });
  it("finds an image or a link however its tag is written, because it reads the parsed body", () => {
    const html =
      '<p><img alt="a < b > c" src="/media/posts/a/one.webp"><img alt=\'"\' src=\'/media/posts/a/two.webp\'><IMG SRC=/media/posts/a/three.webp>' +
      '<a title="href=&quot;/media/posts/a/not-this.webp&quot;" href="/media/posts/a/four.webp">x</a> text /media/posts/a/nor-this.webp</p>';
    expect(collectMedia(payloadOf([post("a-post", { html })]))).toEqual([
      "/media/posts/a/four.webp", "/media/posts/a/one.webp", "/media/posts/a/three.webp", "/media/posts/a/two.webp",
    ]);
  });
  it("throws on an image a browser would fetch from elsewhere, naming the post", () => {
    for (const html of ['<img/src="https://evil.example/x.gif">', '<img alt="a"/src=//evil.example/x>', '<img alt="<" src="https://evil.example/x">', '<img src="https://evil.example/x" src="/media/a.webp">']) {
      expect(() => collectMedia(payloadOf([post("a-post", { html })])), html).toThrow(/en\/a-post.*\/media\//);
    }
  });
  it("throws on an image outside /media/", () => {
    expect(() => collectMedia(payloadOf([post("a-post", { html: '<img src="https://evil.example/x.gif" />' })]))).toThrow("a-post");
    expect(() => collectMedia(payloadOf([post("a-post", { coverUrl: "/img/x.webp" })]))).toThrow("/media/");
  });
});

describe("mediaTarget and mediaHref", () => {
  it("map /media/ to blog-media/", () => {
    expect(mediaTarget("/media/posts/a/b.webp")).toBe("blog-media/posts/a/b.webp");
    expect(mediaHref("/media/posts/a/b.webp")).toBe("/blog-media/posts/a/b.webp");
  });
  it.each(["/media/../etc/passwd", "/media/a/../../b.webp", "/etc/passwd", "media/a.webp", "/media/a\\..\\b.webp", "/media/a.webp?x=1", "https://evil.example/media/a.webp", ""])(
    "refuse %s", (path) => {
      expect(() => mediaTarget(path)).toThrow("/media/");
      expect(() => mediaHref(path)).toThrow("/media/");
    });
});

describe("downloadMedia", () => {
  const base = "https://pub.example";

  it("fetches each path from the studio and writes it under outDir/blog-media", async () => {
    const d = disk();
    const asked: string[] = [];
    const written = await downloadMedia({
      paths: ["/media/posts/a/one.webp", "/media/autores/l/face.webp"], baseUrl: base, outDir: out, ...d,
      fetch: async (url) => { asked.push(url); return ok(webp(4)); },
    });
    expect(asked.sort()).toEqual(["https://pub.example/media/autores/l/face.webp", "https://pub.example/media/posts/a/one.webp"]);
    expect(written).toEqual(["blog-media/autores/l/face.webp", "blog-media/posts/a/one.webp"]);
    const target = resolve(out, "blog-media", "posts", "a", "one.webp");
    expect(d.files.get(target)).toEqual(webp(4));
    expect(d.dirs).toContain(resolve(out, "blog-media", "posts", "a"));
    for (const path of d.files.keys()) expect(path.startsWith(out + sep)).toBe(true);
  });
  it("asks for each path once, however many times it is listed", async () => {
    let calls = 0;
    await downloadMedia({ paths: ["/media/a.webp", "/media/a.webp"], baseUrl: base, outDir: out, ...disk(), fetch: async () => { calls += 1; return ok(); } });
    expect(calls).toBe(1);
  });
  it("sends no-store and follows no redirect", async () => {
    let seen: RequestInit | undefined;
    await downloadMedia({ paths: ["/media/a.webp"], baseUrl: base, outDir: out, ...disk(), fetch: async (_url, init) => { seen = init; return ok(); } });
    expect(seen).toMatchObject({ cache: "no-store", redirect: "error" });
    expect(seen?.signal).toBeInstanceOf(AbortSignal);
  });

  it.each(["/media/../../etc/passwd", "/media/a/../../../b.webp", "//evil.example/media/a.webp", "/media/a.webp?x=1", "/media/a\\..\\b.webp", "/other/a.webp"])(
    "refuses %s before any request or write", async (path) => {
      const d = disk();
      let calls = 0;
      await expect(downloadMedia({ paths: ["/media/ok.webp", path], baseUrl: base, outDir: out, ...d, fetch: async () => { calls += 1; return ok(); } })).rejects.toThrow("/media/");
      expect(calls).toBe(0);
      expect(d.files.size).toBe(0);
    });
  it("refuses a base that is not https, unless it is this machine", async () => {
    const run = (baseUrl: string) => downloadMedia({ paths: ["/media/a.webp"], baseUrl, outDir: out, ...disk(), fetch: async () => ok() });
    await expect(run("http://pub.example")).rejects.toThrow("https");
    await expect(run("ftp://pub.example")).rejects.toThrow("https");
    await expect(run("not a url")).rejects.toThrow("media base");
    await expect(run("http://127.0.0.1:3100")).resolves.toHaveLength(1);
    await expect(run("http://localhost:3100")).resolves.toHaveLength(1);
  });

  it.each<[string, () => Response | Promise<Response>, string]>([
    ["a 404", () => new Response("nope", { status: 404 }), "answered 404"],
    ["a 503", () => new Response("down", { status: 503 }), "answered 503"],
    ["another content type", () => new Response(webp(), { status: 200, headers: { "content-type": "text/html" } }), "image/webp"],
    ["bytes that are not a WebP", () => ok(new TextEncoder().encode("<html>login</html>")), "not a WebP"],
    ["an empty body", () => ok(new Uint8Array(0)), "not a WebP"],
    ["a declared length over the cap", () => ok(webp(), { "content-length": "999999999" }), "larger than"],
    ["a body over the cap", () => ok(webp(2_000)), "larger than"],
    ["a network error", () => { throw new TypeError("fetch failed"); }, "fetch failed"],
  ])("throws on %s, naming the path", async (_name, answer, message) => {
    const d = disk();
    const run = downloadMedia({ paths: ["/media/posts/a/bad.webp"], baseUrl: base, outDir: out, ...d, maxBytes: 1_000, fetch: async () => answer() });
    await expect(run).rejects.toThrow("/media/posts/a/bad.webp");
    await expect(run).rejects.toThrow(message);
    expect(d.files.size).toBe(0);
  });
  it("names the path when the studio does not answer in time", async () => {
    const hang = (_url: string, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(init.signal?.reason)));
    await expect(downloadMedia({ paths: ["/media/slow.webp"], baseUrl: base, outDir: out, ...disk(), fetch: hang, timeoutMs: 20 }))
      .rejects.toThrow(/\/media\/slow\.webp.*no answer in 20 ms/);
  });
  it("names the path when the write fails", async () => {
    const d = disk();
    const run = downloadMedia({ paths: ["/media/a.webp"], baseUrl: base, outDir: out, ...d, fetch: async () => ok(), writeFile: async () => { throw new Error("disk full"); } });
    await expect(run).rejects.toThrow(/\/media\/a\.webp.*disk full/);
  });

  it("never runs more requests at once than the limit", async () => {
    let running = 0;
    let peak = 0;
    const paths = Array.from({ length: 20 }, (_, i) => `/media/p/${i}.webp`);
    const written = await downloadMedia({
      paths, baseUrl: base, outDir: out, ...disk(), concurrency: 3,
      fetch: async () => {
        running += 1;
        peak = Math.max(peak, running);
        await new Promise((r) => setTimeout(r, 2));
        running -= 1;
        return ok();
      },
    });
    expect(written).toHaveLength(20);
    expect(peak).toBe(3);
  });
  it("stops asking after the first failure", async () => {
    let calls = 0;
    const paths = Array.from({ length: 20 }, (_, i) => `/media/p/${i}.webp`);
    await expect(downloadMedia({ paths, baseUrl: base, outDir: out, ...disk(), concurrency: 2, fetch: async () => { calls += 1; return new Response("", { status: 500 }); } })).rejects.toThrow("answered 500");
    expect(calls).toBeLessThanOrEqual(2);
  });
});

describe("fixtureMediaFetch", () => {
  it("answers from a folder on disk, so fixture mode goes through the same checks", async () => {
    const read: string[] = [];
    const fetch = fixtureMediaFetch({ dir: "tests/fixtures/blog-media", readFile: async (path) => { read.push(path); return webp(8); } });
    const d = disk();
    const written = await downloadMedia({ paths: ["/media/posts/a/one.webp"], baseUrl: "http://localhost", outDir: out, ...d, fetch });
    expect(written).toEqual(["blog-media/posts/a/one.webp"]);
    expect(read).toEqual([resolve("tests/fixtures/blog-media", "posts", "a", "one.webp")]);
  });
  it("answers 404 for a file that is not there, and the download names the path", async () => {
    const fetch = fixtureMediaFetch({ dir: "tests/fixtures/blog-media", readFile: async () => { throw Object.assign(new Error("ENOENT"), { code: "ENOENT" }); } });
    await expect(downloadMedia({ paths: ["/media/missing.webp"], baseUrl: "http://localhost", outDir: out, ...disk(), fetch }))
      .rejects.toThrow(/\/media\/missing\.webp.*answered 404/);
  });
});
