import { describe, it, expect, beforeAll } from "vitest";
import { readFile } from "node:fs/promises";
import sax from "sax";
import { KNOWN_SHORTCODES, splitBody } from "../../src/lib/blog-body";
import { blogPostingLd, serializeJsonLd } from "../../src/lib/blog-jsonld";
import { collectMedia, downloadMedia, fixtureMediaFetch } from "../../src/lib/blog-media";
import { assertNoReservedSlugs, extraPages, indexPosts, postsByLang, relatedPosts } from "../../src/lib/blog-model";
import { categoryAlternate, postAlternate, postPath } from "../../src/lib/blog-paths";
import { rssXml } from "../../src/lib/blog-rss";
import { readBlog } from "../../src/lib/blog-source";
import { tagIndex } from "../../src/lib/blog-tags";
import type { PublicPayload, PublicPost } from "../../src/lib/blog-types";

// What Lote 2's pages and e2e rely on being in the fixture, and the whole pipeline run over it.
let payload: PublicPayload;
let en: PublicPost[];
let pt: PublicPost[];

beforeAll(async () => {
  const load = await readBlog({ env: { BLOG_SOURCE: "fixture" } });
  if (load.mode !== "fixture") throw new Error("fixture mode expected");
  payload = load.payload;
  en = postsByLang(payload, "en");
  pt = postsByLang(payload, "pt");
});

const HOSTILE = /<script>|<\/script>|"><|<b>|<em>/;

describe("the blog fixture", () => {
  it("has a second page in English and a single one in Portuguese", () => {
    expect(en.length).toBeGreaterThanOrEqual(14);
    expect(pt.length).toBeGreaterThanOrEqual(3);
    expect(extraPages(en.length)).toEqual([2]);
    expect(extraPages(pt.length)).toEqual([]);
  });
  it("has a translated pair and an untranslated post in each language", () => {
    const pair = en.find((p) => p.translationSlug !== null) as PublicPost;
    expect(postAlternate(pair)).toBe(postPath("pt", pair.translationSlug as string));
    expect(en.some((p) => p.translationSlug === null)).toBe(true);
    expect(pt.some((p) => p.translationSlug === null)).toBe(true);
  });
  it("has posts with a cover and without, and a featured one that is not the newest", () => {
    for (const posts of [en, pt]) {
      expect(posts.some((p) => p.coverUrl !== null)).toBe(true);
      expect(posts.some((p) => p.coverUrl === null)).toBe(true);
    }
    expect(en.filter((p) => p.featured)).toHaveLength(1);
    expect(en[0]?.featured).toBe(false);
    expect(indexPosts(en)[0]?.featured).toBe(true);
  });
  it("has tags with accents and spaces, and no two tags fighting for a URL", () => {
    const tags = tagIndex(pt);
    expect(tags.filter((t) => /[^\x20-\x7e]/.test(t.tag) && t.tag.includes(" ")).length).toBeGreaterThanOrEqual(2);
    expect(tags.map((t) => t.slug)).toContain("guia-de-redacao");
    expect(tagIndex(en).length).toBeGreaterThan(3);
  });
  it("has one post that uses every special block, and a table of contents somewhere", () => {
    const names = (p: PublicPost) => splitBody(p.html).flatMap((s) => (s.kind === "shortcode" ? [s.name] : []));
    expect(en.some((p) => KNOWN_SHORTCODES.every((name) => names(p).includes(name)))).toBe(true);
    expect(en.some((p) => p.toc.some((t) => t.level === 2) && p.toc.some((t) => t.level === 3))).toBe(true);
    for (const p of payload.posts) for (const item of p.toc) expect(p.html, `${p.slug}#${item.id}`).toContain(` id="${item.id}"`);
  });
  it("has an author with a photo and one without, and a category used in one language only", () => {
    expect(payload.authors.some((a) => a.avatarUrl !== null)).toBe(true);
    expect(payload.authors.some((a) => a.avatarUrl === null)).toBe(true);
    expect(payload.categories.some((c) => categoryAlternate("en", c.slug, payload) === null && en.some((p) => p.category?.slug === c.slug))).toBe(true);
    expect(payload.categories.some((c) => categoryAlternate("en", c.slug, payload) !== null)).toBe(true);
    expect(payload.posts.some((p) => p.category === null)).toBe(true);
  });
  it("carries hostile text in every plain-text field, in both languages", () => {
    for (const posts of [en, pt]) {
      for (const field of ["title", "excerpt", "metaTitle", "metaDescription"] as const) {
        expect(posts.some((p) => HOSTILE.test(p[field] ?? "")), field).toBe(true);
      }
      expect(posts.some((p) => p.tags.some((t) => HOSTILE.test(t)))).toBe(true);
      expect(posts.some((p) => p.toc.some((t) => HOSTILE.test(t.text)))).toBe(true);
      expect(posts.some((p) => p.category !== null && HOSTILE.test(p.category.namePt) && HOSTILE.test(p.category.nameEn))).toBe(true);
      expect(posts.some((p) => p.author !== null && HOSTILE.test(p.author.name))).toBe(true);
    }
    expect(en.some((p) => p.coverUrl !== null && HOSTILE.test(p.coverAlt ?? ""))).toBe(true);
    expect(payload.authors.some((a) => HOSTILE.test(a.name) && HOSTILE.test(a.bioPt) && HOSTILE.test(a.bioEn))).toBe(true);
  });
  it("says it is sample content, and stays inside the site's rules", () => {
    for (const p of payload.posts) {
      expect(`${p.title} ${p.html}`, p.slug).toMatch(/sample|exemplo/i);
      const text = `${p.title} ${p.excerpt} ${p.html}`;
      expect(text, p.slug).not.toMatch(/\$\s?\d|R\$\s?\d|non-custodial|não custodial/i);
      // Case-sensitive: "Todo campo" is Portuguese, not a marker.
      expect(text, p.slug).not.toMatch(/\bTODO\b/);
    }
  });
});

describe("the pipeline over the fixture", () => {
  it("no post takes a reserved name", () => {
    expect(() => assertNoReservedSlugs(payload.posts)).not.toThrow();
  });
  it("every body splits, and no image points at the studio any more", () => {
    for (const p of payload.posts) {
      const html = splitBody(p.html).flatMap((s) => (s.kind === "html" ? [s.html] : [])).join("");
      expect(html, p.slug).not.toContain('src="/media/');
      expect(html, p.slug).not.toContain("{{");
    }
    expect(en.some((p) => splitBody(p.html).some((s) => s.kind === "html" && s.html.includes('src="/blog-media/')))).toBe(true);
  });
  it("every image it refers to is a real WebP in tests/fixtures/blog-media", async () => {
    const paths = collectMedia(payload);
    expect(paths.length).toBeGreaterThanOrEqual(5);
    const written = new Map<string, Uint8Array>();
    const files = await downloadMedia({
      paths, baseUrl: "http://localhost", outDir: "dist-fixture-test",
      fetch: fixtureMediaFetch({ dir: "tests/fixtures/blog-media", readFile: (path) => readFile(path) }),
      writeFile: async (path, bytes) => void written.set(path, bytes),
      mkdir: async () => {},
    });
    expect(files).toHaveLength(paths.length);
    expect(written.size).toBe(paths.length);
    for (const bytes of written.values()) expect(bytes.length).toBeGreaterThan(100);
  });
  it("related posts come from the same language and never include the post", () => {
    for (const p of payload.posts) {
      for (const r of relatedPosts(p, payload.posts)) {
        expect(r.lang).toBe(p.lang);
        expect(r.slug).not.toBe(p.slug);
      }
    }
    expect(relatedPosts(en.find((p) => p.featured) as PublicPost, payload.posts).length).toBeGreaterThan(0);
  });
  it("the hostile titles survive the feed and the JSON-LD as text", () => {
    for (const [lang, posts] of [["en", en], ["pt", pt]] as const) {
      const titles: string[] = [];
      const parser = sax.parser(true);
      let inItemTitle = false;
      let depth = 0;
      parser.onerror = (err) => { throw err; };
      parser.onopentag = (tag) => { depth += 1; inItemTitle = tag.name === "title" && depth === 4; if (inItemTitle) titles.push(""); };
      parser.onclosetag = () => { depth -= 1; inItemTitle = false; };
      parser.ontext = (text) => { if (inItemTitle) titles[titles.length - 1] += text; };
      parser.write(rssXml({ lang, posts, siteUrl: "https://ash.app.br", title: "Ash", description: "Ash" })).close();
      expect(titles).toEqual(posts.map((p) => p.title));

      for (const p of posts) {
        const out = serializeJsonLd(blogPostingLd({ siteUrl: "https://ash.app.br", inLanguage: lang, publisherName: "Ash", headline: p.title, path: postPath(lang, p.slug), datePublished: p.publishedAt, authorName: p.author?.name ?? null, keywords: p.tags }));
        expect(out.includes("<"), p.slug).toBe(false);
        expect(JSON.parse(out).headline).toBe(p.title);
      }
    }
  });
});
