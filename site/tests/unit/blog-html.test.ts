import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { assertSafeBody, splitBody } from "../../src/lib/blog-body";
import { ALLOWED_ATTRIBUTES, ALLOWED_TAGS, SAFE_HREF_RE, isSafeHref, parseBody } from "../../src/lib/blog-html";
import { collectMedia } from "../../src/lib/blog-media";
import { assertBuildable } from "../../src/lib/blog-views";
import { payloadOf, post } from "./blog-helpers";

// The site's allowlist is the studio's, copied. The site does not import studio code, so this
// reads the studio's two files as text: a tag or an attribute added on one side fails here.
describe("the allowlist is the studio's", () => {
  const sanitize = readFileSync("studio/src/blog/lib/sanitize.ts", "utf8");
  const href = readFileSync("studio/src/blog/lib/href.ts", "utf8");
  const strings = (text: string): string[] => [...text.matchAll(/"([^"]+)"/g)].map((m) => m[1] as string);

  it("has exactly the studio's ALLOWED_TAGS", () => {
    const block = /export const ALLOWED_TAGS[^=]*=\s*\[([\s\S]*?)\];/.exec(sanitize)?.[1];
    expect(block).toBeDefined();
    expect(strings(block as string)).toEqual([...ALLOWED_TAGS]);
  });
  it("has exactly the studio's attributes per tag", () => {
    const block = /allowedAttributes:\s*\{([\s\S]*?)\n    \},/.exec(sanitize)?.[1];
    expect(block).toBeDefined();
    const studio: Record<string, string[]> = {};
    for (const match of (block as string).matchAll(/^\s*([a-z0-9]+):\s*\[([^\]]*)\],/gm)) studio[match[1] as string] = strings(match[2] as string);
    expect(studio).toEqual(ALLOWED_ATTRIBUTES);
    // Every tag with attributes is an allowed tag.
    for (const tag of Object.keys(ALLOWED_ATTRIBUTES)) expect(ALLOWED_TAGS).toContain(tag);
  });
  it("judges a link by the studio's pattern", () => {
    const pattern = /const SAFE_HREF_RE = (\/.+\/i);/.exec(href)?.[1];
    expect(pattern).toBe(String(SAFE_HREF_RE));
    for (const ok of ["https://a.example/x", "http://a.example", "mailto:a@b.co", "#top", "/pitch/", "/media/a.webp"]) expect(isSafeHref(ok), ok).toBe(true);
    for (const bad of ["javascript:alert(1)", "JaVaScRiPt:alert(1)", "data:text/html,x", "//evil.example", "/\\evil.example", "\\\\evil.example", "/\t/evil.example", "ftp://x", "relative/path", ""]) {
      expect(isSafeHref(bad), JSON.stringify(bad)).toBe(false);
    }
  });
});

describe("parseBody", () => {
  it("accepts everything the studio's sanitizer writes, and reports its media and ids", () => {
    const html =
      '<h2 id="a">A &lt;script&gt; in text</h2><h3 id="b">B</h3><h4 id="c">C</h4><p>style= and onclick= are words, <a href="https://example.org/?style=x&amp;onload=1" title="one = two">a link</a>, <strong>s</strong> <em>e</em> <del>d</del> <code>c</code><br /></p>' +
      '<figure><a href="/media/full.webp"><img src="/media/a.webp" alt="on = off &lt; &gt;" width="8" height="8" /></a><figcaption>c</figcaption></figure>' +
      '<ul><li>one<ol><li>two</li></ol></li></ul><blockquote><p>q</p></blockquote>' +
      '<table><thead><tr><th align="left">h</th></tr></thead><tbody><tr><td align="right">1</td></tr></tbody></table><pre><code>x</code></pre><hr />{{mapa}}';
    const parsed = parseBody(html);
    expect(parsed.media).toEqual(["/media/full.webp", "/media/a.webp"]);
    expect(parsed.ids).toEqual(["a", "b", "c"]);
    expect(() => splitBody(html)).not.toThrow();
  });

  // Every case the pattern-based check let through and a browser would run or fetch.
  it.each([
    ['<details title=">" open ontoggle="alert(1)">x</details>', "<details>"],
    ['<p title=">" onclick="alert(1)">x</p>', '"title"'],
    ['<p title="a"onclick="alert(1)">x</p>', '"title"'],
    ['<p onclick="alert(1)">x</p>', '"onclick"'],
    ['<a href="javascript:alert(1)">x</a>', "href"],
    ['<a href="java&#115;cript:alert(1)">x</a>', "href"],
    ['<a href="&#106;avascript&colon;alert(1)">x</a>', "href"],
    ['<a href="//evil.example/x">x</a>', "href"],
    ['<a href="/&#92;evil.example">x</a>', "href"],
    ['<img alt="<" src="https://evil.example/x.gif">', "/media/"],
    ["<style>p{color:red}</style>", "<style>"],
    ['<svg><image href="https://evil.example/x"></image></svg>', "<svg>"],
    ['<table background="https://evil.example/x"><tbody><tr><td>1</td></tr></tbody></table>', '"background"'],
    ['<input type="image" src="https://evil.example/x">', "<input>"],
    ['<a href="/pitch/" ping="https://evil.example/p">x</a>', '"ping"'],
    ["<textarea><p>x</p>", "<textarea>"],
    ["<plaintext>x", "<plaintext>"],
    ["<p>a</p><!-- {{mapa}} --><p>b</p>", "comment"],
    ['<img src="/media/a.webp" srcset="https://evil.example/x 2x">', '"srcset"'],
    ['<p style="position:fixed">x</p>', '"style"'],
    ['<img/src="https://evil.example/x.gif">', "/media/"],
    ['<img src="/media/a.webp"/onerror=alert(1)>', '"onerror"'],
    ['<h2 id="a" class="x">t</h2>', '"class"'],
    ['<p id="a">t</p>', '"id"'],
    ['<a href="/x" target="_blank">t</a>', '"target"'],
    ["<h1>title</h1>", "<h1>"],
    ["<div>x</div>", "<div>"],
    ["<math><mi>x</mi></math>", "<math>"],
    ['<p>x</p><base href="https://evil.example/">', "<base>"],
    ['<form action="/x"><p>x</p></form>', "<form>"],
    ["<p><span>x</span></p>", "<span>"],
    ["<script>alert(1)</script>", "<script>"],
    ['<iframe src="https://evil.example"></iframe>', "<iframe>"],
  ])("refuses %s", (html, named) => {
    expect(() => parseBody(html)).toThrow("blog body:");
    expect(() => parseBody(html)).toThrow(named);
    expect(() => assertSafeBody(html)).toThrow();
    expect(() => splitBody(html)).toThrow();
    expect(() => collectMedia(payloadOf([post("a-post", { html })]))).toThrow("en/a-post");
    expect(() => assertBuildable(payloadOf([post("a-post", { html })]))).toThrow("en/a-post");
  });

  it("drops what a browser would never turn into an element here, instead of passing it on", () => {
    // An unclosed tag at the very end is not an element to this parser. Passed on as text it
    // would swallow the markup that follows it on the page and become an image there.
    expect(splitBody('<p>end</p><img src="https://evil.example/x.gif"')).toEqual([{ kind: "html", html: "<p>end</p>" }]);
    expect(splitBody("<!doctype html><p>a</p>")).toEqual([{ kind: "html", html: "<p>a</p>" }]);
  });
  it("never repeats a value in the message: it lands in a public log", () => {
    for (const html of ['<a href="javascript:secret-token-123">x</a>', '<p data-x="secret-token-123">y</p>', '<img src="https://secret-token-123.example/x">']) {
      let message = "";
      try { parseBody(html); } catch (err) { message = (err as Error).message; }
      expect(message).toContain("blog body:");
      expect(message).not.toContain("secret-token-123");
    }
  });
  it("writes back what a browser would build, not what was sent", () => {
    // An image whose alt has a "<" is an image: found, rewritten, and still there.
    const [segment] = splitBody('<p><img alt="a < b" src="/media/a.webp"></p>');
    expect(segment).toEqual({ kind: "html", html: '<p><img loading="lazy" decoding="async" alt="a < b" src="/blog-media/a.webp"></p>' });
    expect(collectMedia(payloadOf([post("a-post", { html: '<p><img alt="<" src="/media/posts/a/b.webp"></p>' })]))).toEqual(["/media/posts/a/b.webp"]);
    // Unclosed elements are closed; text is escaped again.
    expect(splitBody("<p>a &lt;b&gt; &amp; c<ul><li>x")).toEqual([{ kind: "html", html: "<p>a &lt;b&gt; &amp; c</p><ul><li>x</li></ul>" }]);
  });
  it("stays fast on a hostile body", () => {
    const start = performance.now();
    try {
      splitBody("{{".repeat(50_000) + "<img ".repeat(20_000) + "<p>".repeat(20_000));
    } catch {
      // Refusing it is fine; taking seconds to decide is not.
    }
    expect(performance.now() - start).toBeLessThan(3_000);
  });
});
