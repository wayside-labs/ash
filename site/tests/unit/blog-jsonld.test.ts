import { describe, it, expect } from "vitest";
import { blogPostingLd, breadcrumbLd, serializeJsonLd } from "../../src/lib/blog-jsonld";

// Built from char codes on purpose: an escape sequence typed here could be decoded by an editor
// or a tool on the way to disk, and the test would then compare the wrong thing without failing.
const BACKSLASH = String.fromCharCode(92);
const LINE_SEP = String.fromCharCode(0x2028);
const PARA_SEP = String.fromCharCode(0x2029);
const escaped = (hex: string) => `${BACKSLASH}u${hex}`;

const site = { siteUrl: "https://ash.app.br", inLanguage: "en", publisherName: "Ash" };

describe("blogPostingLd", () => {
  it("describes a full post with absolute URLs", () => {
    expect(blogPostingLd({
      ...site,
      headline: "A budget, never the keys",
      description: "What a budget is.",
      path: "/blog/a-budget-never-the-keys/",
      datePublished: "2026-09-28T13:00:00.000Z",
      dateModified: "2026-09-29T09:00:00.000Z",
      authorName: "Lucas",
      authorPath: "/blog/author/lucas/",
      imagePath: "/blog-media/posts/a/cover.webp",
      articleSection: "Payments",
      keywords: ["solana", "session keys"],
    })).toEqual({
      "@context": "https://schema.org",
      "@type": "BlogPosting",
      headline: "A budget, never the keys",
      description: "What a budget is.",
      url: "https://ash.app.br/blog/a-budget-never-the-keys/",
      mainEntityOfPage: { "@type": "WebPage", "@id": "https://ash.app.br/blog/a-budget-never-the-keys/" },
      datePublished: "2026-09-28T13:00:00.000Z",
      dateModified: "2026-09-29T09:00:00.000Z",
      image: ["https://ash.app.br/blog-media/posts/a/cover.webp"],
      articleSection: "Payments",
      keywords: "solana, session keys",
      inLanguage: "en",
      author: { "@type": "Person", name: "Lucas", url: "https://ash.app.br/blog/author/lucas/" },
      publisher: { "@type": "Organization", name: "Ash", url: "https://ash.app.br/" },
    });
  });
  it("leaves out what the post does not have, and signs as the publisher when there is no author", () => {
    const ld = blogPostingLd({
      siteUrl: "https://ash.app.br/", inLanguage: "pt-BR", publisherName: "Ash",
      headline: "Um post", path: "/pt/blog/um-post/", datePublished: "2026-09-28T13:00:00.000Z",
      description: null, authorName: null, imagePath: null, articleSection: null, keywords: [],
    });
    expect(ld).toEqual({
      "@context": "https://schema.org",
      "@type": "BlogPosting",
      headline: "Um post",
      url: "https://ash.app.br/pt/blog/um-post/",
      mainEntityOfPage: { "@type": "WebPage", "@id": "https://ash.app.br/pt/blog/um-post/" },
      datePublished: "2026-09-28T13:00:00.000Z",
      inLanguage: "pt-BR",
      author: { "@type": "Organization", name: "Ash", url: "https://ash.app.br/" },
      publisher: { "@type": "Organization", name: "Ash", url: "https://ash.app.br/" },
    });
  });
  it("carries no trace of another brand or a hard-coded language", () => {
    const text = JSON.stringify(blogPostingLd({ ...site, headline: "x", path: "/blog/x/", datePublished: "2026-09-28T13:00:00.000Z" }));
    expect(text).not.toMatch(/secret|pt-BR/i);
  });
});

describe("breadcrumbLd", () => {
  it("numbers the trail from one, with absolute URLs", () => {
    expect(breadcrumbLd([{ name: "Blog", path: "/blog/" }, { name: "Payments", path: "/blog/category/payments/" }], "https://ash.app.br")).toEqual({
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Blog", item: "https://ash.app.br/blog/" },
        { "@type": "ListItem", position: 2, name: "Payments", item: "https://ash.app.br/blog/category/payments/" },
      ],
    });
  });
});

describe("serializeJsonLd", () => {
  const hostile = [
    '</script><script>alert("title")</script>',
    "<!-- a comment that never closes",
    "</SCRIPT >",
    "Tom & Jerry &lt;b&gt; &amp;",
    `line${LINE_SEP}separator and paragraph${PARA_SEP}separator`,
    `quotes " ' and a backslash ${BACKSLASH} too`,
    "]]> and --> and <![CDATA[",
  ];

  it.each(hostile)("a title of %j cannot close the script element, and reads back unchanged", (title) => {
    const ld = blogPostingLd({ ...site, headline: title, description: title, path: "/blog/x/", datePublished: "2026-09-28T13:00:00.000Z", authorName: title, keywords: [title] });
    const out = serializeJsonLd(ld);
    for (const raw of ["<", ">", "&", LINE_SEP, PARA_SEP]) expect(out.includes(raw), JSON.stringify(raw)).toBe(false);
    expect(JSON.parse(out)).toEqual(ld);
    const page = `<script type="application/ld+json">${out}</script>`;
    expect(page.toLowerCase().split("</script").length - 1).toBe(1);
    expect(page.includes("<!--")).toBe(false);
  });

  // The escape has to be in the output as six literal characters: backslash, u, 0, 0, 3, c.
  it("writes each dangerous character as a literal six-character escape", () => {
    const out = serializeJsonLd({ a: "<", b: ">", c: "&", d: LINE_SEP, e: PARA_SEP });
    expect(out).toBe(`{"a":"${escaped("003c")}","b":"${escaped("003e")}","c":"${escaped("0026")}","d":"${escaped("2028")}","e":"${escaped("2029")}"}`);
    const lt = out.indexOf(escaped("003c"));
    expect([...out.slice(lt, lt + 6)].map((ch) => ch.charCodeAt(0))).toEqual([92, 117, 48, 48, 51, 99]);
    expect(out.length).toBe('{"a":"","b":"","c":"","d":"","e":""}'.length + 5 * 6);
  });
  it("escapes keys too", () => {
    const out = serializeJsonLd({ "</script>": 1 });
    expect(out.includes("<")).toBe(false);
    expect(JSON.parse(out)).toEqual({ "</script>": 1 });
  });
  it("serialises a list of blocks", () => {
    expect(JSON.parse(serializeJsonLd([{ a: 1 }, { b: "<" }]))).toEqual([{ a: 1 }, { b: "<" }]);
  });
});
