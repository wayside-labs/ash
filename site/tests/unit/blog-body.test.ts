import { describe, it, expect } from "vitest";
import { KNOWN_SHORTCODES, splitBody } from "../../src/lib/blog-body";

describe("splitBody", () => {
  it("returns one html segment when there is no marker", () => {
    expect(splitBody("<p>one</p><p>two</p>")).toEqual([{ kind: "html", html: "<p>one</p><p>two</p>" }]);
  });
  it("returns nothing for an empty body", () => {
    expect(splitBody("")).toEqual([]);
  });
  it("cuts at block-level markers, in order", () => {
    expect(splitBody("<p>a</p>{{mapa}}<p>b</p>{{cta:pitch}}")).toEqual([
      { kind: "html", html: "<p>a</p>" },
      { kind: "shortcode", name: "mapa" },
      { kind: "html", html: "<p>b</p>" },
      { kind: "shortcode", name: "cta:pitch" },
    ]);
  });
  it("knows every shortcode of the studio's catalogue", () => {
    expect([...KNOWN_SHORTCODES]).toEqual(["cta:pitch", "cta:newsletter", "cta:contato", "mapa"]);
    const body = KNOWN_SHORTCODES.map((name) => `{{${name}}}`).join("");
    expect(splitBody(body)).toEqual(KNOWN_SHORTCODES.map((name) => ({ kind: "shortcode", name })));
  });
  it("drops the whitespace left between two markers", () => {
    expect(splitBody("{{mapa}}\n  {{cta:contato}}\n")).toEqual([
      { kind: "shortcode", name: "mapa" },
      { kind: "shortcode", name: "cta:contato" },
    ]);
  });
  it("throws on a marker it does not know, naming it", () => {
    expect(() => splitBody("<p>a</p>{{cta:gratis}}")).toThrow("{{cta:gratis}}");
    expect(() => splitBody("{{print}}")).toThrow("{{print}}");
  });
  it("throws on a known marker inside an element: cutting there would split the markup", () => {
    expect(() => splitBody("<p>see {{mapa}} here</p>")).toThrow(/\{\{mapa\}\}.*block level/);
    expect(() => splitBody("<ul><li>{{cta:pitch}}</li></ul>")).toThrow("block level");
    expect(() => splitBody("<pre><code>{{mapa}}</code></pre>")).toThrow("block level");
  });
  it("leaves alone text that only looks like a marker", () => {
    const html = "<p>{{Mapa}} {{ mapa }} {mapa} {{cta:}}</p>";
    expect(splitBody(html)).toEqual([{ kind: "html", html }]);
  });

  it("rewrites the src of images to the copy the build downloads", () => {
    const out = splitBody('<p>a</p><figure><img src="/media/posts/p1/i1.webp" alt="x" width="800" height="450" /></figure>{{mapa}}<p><img alt="y" src="/media/posts/p1/i2.webp"></p>');
    expect(out).toEqual([
      // Written back from the parsed tree: a void element has no closing slash.
      { kind: "html", html: '<p>a</p><figure><img loading="lazy" decoding="async" src="/blog-media/posts/p1/i1.webp" alt="x" width="800" height="450"></figure>' },
      { kind: "shortcode", name: "mapa" },
      { kind: "html", html: '<p><img loading="lazy" decoding="async" alt="y" src="/blog-media/posts/p1/i2.webp"></p>' },
    ]);
  });
  it("touches attributes only (an image's src, a link's href to /media/): not the text, not an alt, not a title", () => {
    const html =
      '<p>the tag is &lt;img src="/media/a.webp"&gt; and src="/media/b.webp" is text</p>' +
      '<p><a href="/media/c.webp" title="src=&quot;/media/d.webp&quot;">link</a></p>' +
      '<p><img src="/media/e.webp" alt="src=&quot;/media/f.webp&quot;" /></p>';
    const [segment] = splitBody(html);
    expect(segment).toEqual({
      kind: "html",
      html:
        '<p>the tag is &lt;img src="/media/a.webp"&gt; and src="/media/b.webp" is text</p>' +
        '<p><a href="/blog-media/c.webp" title="src=&quot;/media/d.webp&quot;">link</a></p>' +
        '<p><img loading="lazy" decoding="async" src="/blog-media/e.webp" alt="src=&quot;/media/f.webp&quot;"></p>',
    });
  });
  it("leaves every other link as it is", () => {
    const html = '<p><a href="https://example.org/media/a.webp">out</a> <a href="/pitch/">in</a> <a href="mailto:a@b.co">mail</a> <a title="/media/x.webp">no href</a></p>';
    expect(splitBody(html)).toEqual([{ kind: "html", html }]);
  });
  it("refuses an image written with a slash where a space would be: a browser reads it as an image", () => {
    expect(() => splitBody('<p><img/src="https://evil.example/pixel.gif"></p>')).toThrow("/media/");
    expect(() => splitBody("<p><img/src=//evil.example/x></p>")).toThrow("/media/");
    expect(() => splitBody('<p><img alt="a"/src="https://evil.example/x"></p>')).toThrow("/media/");
  });
  it("throws on an image that is not ours: the page would ask a third party for it", () => {
    expect(() => splitBody('<p><img src="https://evil.example/pixel.gif" /></p>')).toThrow("/media/");
    expect(() => splitBody('<p><img src="/media/../x.webp" /></p>')).toThrow("/media/");
    expect(() => splitBody('<p><img alt="no source" /></p>')).toThrow("/media/");
    expect(() => splitBody('<p><img src="/media/a.webp" src="https://evil.example/x" /></p>')).not.toThrow();
    expect(() => splitBody('<p><img src="https://evil.example/x" src="/media/a.webp" /></p>')).toThrow("/media/");
  });
  it("reads the markup the way a browser does, whatever the quoting", () => {
    expect(splitBody("<p><img src='/media/x.webp' /></p>")).toEqual([{ kind: "html", html: '<p><img loading="lazy" decoding="async" src="/blog-media/x.webp"></p>' }]);
    expect(splitBody("<p><IMG SRC=/media/x.webp ALT=y></p>")).toEqual([{ kind: "html", html: '<p><img loading="lazy" decoding="async" src="/blog-media/x.webp" alt="y"></p>' }]);
  });
  it("changes nothing else of what it is given, only its spelling", () => {
    const html = '<h2 id="one">One &amp; two</h2><p>a<br />b <strong>c</strong></p><table><tbody><tr><td align="right">1</td></tr></tbody></table>';
    expect(splitBody(html)).toEqual([{ kind: "html", html: html.replace("<br />", "<br>") }]);
    // What comes out is already in that spelling: a second pass changes nothing.
    const once = (splitBody(html)[0] as { html: string }).html;
    expect(splitBody(once)).toEqual([{ kind: "html", html: once }]);
  });
  it("keeps the text around a marker at the top level, escaped", () => {
    expect(splitBody("a &lt; b{{mapa}}c &amp; d")).toEqual([
      { kind: "html", html: "a &lt; b" },
      { kind: "shortcode", name: "mapa" },
      { kind: "html", html: "c &amp; d" },
    ]);
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
