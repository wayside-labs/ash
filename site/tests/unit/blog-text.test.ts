import { describe, it, expect } from "vitest";
import { countText, excerptPieces, importUrl, isLocalPath } from "../../src/lib/blog-search-ui";
import { bodyExcerpt, bodyText, decodeEntities, fillTemplate } from "../../src/lib/blog-text";

// The body's allowlist (what used to be checked by pattern here) is in blog-html.test.ts.

describe("bodyText and bodyExcerpt", () => {
  it("leaves the words: no tags, no markers, entities as characters", () => {
    expect(bodyText('<h2 id="a">Tom &amp; Jerry</h2><p>say &lt;hi&gt; &quot;now&quot;&nbsp;&#39;ok&#x27; &#233;</p>{{mapa}}<ul><li>one</li><li>two</li></ul>'))
      .toBe("Tom & Jerry say <hi> \"now\" 'ok' é one two");
    expect(bodyText("<p>&unknown; &#99999999; &#xD800;</p>")).toBe("&unknown;");
  });
  it("is the whole text when it is short, and null when there is none", () => {
    expect(bodyExcerpt("<p>Short body.</p>")).toBe("Short body.");
    expect(bodyExcerpt('<figure><img src="/media/a.webp" alt="x" /></figure>{{cta:pitch}}')).toBeNull();
    expect(bodyExcerpt("")).toBeNull();
  });
  it("cuts a long body at a word, near the limit, and says it was cut", () => {
    const html = `<p>${"word ".repeat(80)}</p>`;
    const out = bodyExcerpt(html) as string;
    expect(out.endsWith("word…")).toBe(true);
    expect([...out].length).toBeLessThanOrEqual(156);
    expect([...out].length).toBeGreaterThan(140);
    expect(bodyExcerpt("<p>One sentence. Another one, longer than the cut.</p>", 16)).toBe("One sentence…");
    // One word longer than the limit is cut where the limit falls.
    expect(bodyExcerpt(`<p>${"x".repeat(300)}</p>`, 10)).toBe(`${"x".repeat(10)}…`);
  });
  it("counts characters, not halves of one", () => {
    const out = bodyExcerpt(`<p>${"😀".repeat(200)}</p>`, 10) as string;
    expect([...out]).toHaveLength(11);
    expect(out).toBe(`${"😀".repeat(10)}…`);
  });
});

describe("fillTemplate", () => {
  it("puts each value where its name is, and nothing where there is none", () => {
    expect(fillTemplate("Page {page} of {total}.", { page: 2, total: 5 })).toBe("Page 2 of 5.");
    expect(fillTemplate("Posts in {name}.", { name: "<b>x</b> & y" })).toBe("Posts in <b>x</b> & y.");
    expect(fillTemplate("{missing} stays out", {})).toBe(" stays out");
  });
});

describe("search results", () => {
  const decode = decodeEntities;
  it("keeps the space on each side of a mark, and decodes without parsing", () => {
    expect(excerptPieces("Lists, <mark>menus</mark> and the footer", decode).map((p) => p.text).join("")).toBe("Lists, menus and the footer");
    expect(decodeEntities("&lt;/textarea&gt;&lt;script&gt;x&lt;/script&gt; &amp;amp; ")).toBe("</textarea><script>x</script> &amp; ");
  });
  it("cuts an excerpt at Pagefind's marks and at nothing else", () => {
    expect(excerptPieces("a <mark>budget</mark> for &lt;b&gt;agents&lt;/b&gt; &amp; <mark>more</mark>", decode)).toEqual([
      { text: "a ", mark: false },
      { text: "budget", mark: true },
      { text: " for <b>agents</b> & ", mark: false },
      { text: "more", mark: true },
    ]);
  });
  it("hands any other tag to the decoder as text, never as a piece of its own", () => {
    const seen: string[] = [];
    const pieces = excerptPieces('x <img src=x onerror=alert(1)> <mark>y</mark><script>z</script>', (html) => { seen.push(html); return html; });
    expect(pieces.map((p) => p.mark)).toEqual([false, true, false]);
    expect(seen).toEqual(["x <img src=x onerror=alert(1)> ", "y", "<script>z</script>"]);
    expect(excerptPieces("", decode)).toEqual([]);
  });
  it("only follows a result to a page of this site", () => {
    expect(isLocalPath("/blog/a-post/")).toBe(true);
    const backslash = String.fromCharCode(92);
    for (const url of ["//evil.example/x", `/${backslash}evil.example/x`, `/blog/${backslash}x`, `${backslash}${backslash}evil.example`, "https://evil.example/", "javascript:alert(1)", "", undefined, 3]) {
      expect(isLocalPath(url), String(url)).toBe(false);
    }
  });
  it("asks for a new address on each retry, and the plain one the first time", () => {
    expect(importUrl("/pagefind/pagefind.js", 0)).toBe("/pagefind/pagefind.js");
    expect(importUrl("/pagefind/pagefind.js", 1)).toBe("/pagefind/pagefind.js?retry=1");
    expect(importUrl("/pagefind/pagefind.js", 2)).not.toBe(importUrl("/pagefind/pagefind.js", 1));
  });
  it("says how many results there are, in the copy's words", () => {
    expect(countText(1, "1 result", "{count} results")).toBe("1 result");
    expect(countText(8, "1 result", "{count} results")).toBe("8 results");
    expect(countText(2, "1 resultado", "{count} resultados")).toBe("2 resultados");
  });
});
