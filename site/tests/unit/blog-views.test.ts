import { describe, it, expect } from "vitest";
import { readBlog } from "../../src/lib/blog-source";
import {
  assertBuildable, authorRoutes, avatarOf, buildWarnings, categoryRoutes, emptyIndexPaths, hasPosts, indexRoutes, postRoutes, tagRoutes, updatedDay,
} from "../../src/lib/blog-views";
import { author, category, payloadOf, post, series } from "./blog-helpers";

const product = category("product", { nameEn: "Product", namePt: "Produto" });

describe("indexRoutes", () => {
  it("gives the index and one route per extra page, with the rest parameter the route file expects", () => {
    const payload = payloadOf(series(14));
    const routes = indexRoutes(payload, "en");
    expect(routes.map((r) => r.params.page)).toEqual([undefined, "page/2"]);
    expect(routes.map((r) => r.props.path)).toEqual(["/blog/", "/blog/page/2/"]);
    expect(routes.map((r) => r.props.posts.length)).toEqual([12, 2]);
    expect(routes.map((r) => r.props.noindex)).toEqual([false, true]);
    expect(routes[1]?.props).toMatchObject({ page: 2, pageCount: 2, kind: "index" });
  });
  it("uses the Portuguese word in the Portuguese parameter", () => {
    const routes = indexRoutes(payloadOf(series(13, { lang: "pt" })), "pt");
    expect(routes.map((r) => r.params.page)).toEqual([undefined, "pagina/2"]);
  });
  it("puts the featured post first", () => {
    const posts = series(3);
    (posts[2] as (typeof posts)[number]).featured = true;
    expect(indexRoutes(payloadOf(posts), "en")[0]?.props.posts[0]?.slug).toBe("post-03");
  });
  it("still builds the index of a language with no post, as a landing place and nothing more", () => {
    const payload = payloadOf(series(2));
    const routes = indexRoutes(payload, "pt");
    expect(routes).toHaveLength(1);
    // noindex, no hreflang, no feed; the switch still leads back to the blog that has posts.
    expect(routes[0]?.props).toMatchObject({ path: "/pt/blog/", posts: [], noindex: true, altPath: null, rss: null, langHref: "/blog/" });
    // And the populated index does not advertise the empty one.
    expect(indexRoutes(payload, "en")[0]?.props).toMatchObject({ noindex: false, altPath: null, rss: "/blog/rss.xml", langHref: "/pt/blog/" });
    expect(emptyIndexPaths(payload)).toEqual(["/pt/blog/"]);
    expect(emptyIndexPaths(payloadOf([...series(1), post("um", { lang: "pt" })]))).toEqual([]);
    expect(emptyIndexPaths(payloadOf([]))).toEqual(["/blog/", "/pt/blog/"]);
    expect(hasPosts(payload, "en")).toBe(true);
    expect(hasPosts(payload, "pt")).toBe(false);
  });
  it("gives every list and every post the feed of its language", () => {
    const payload = payloadOf([post("a", { tags: ["x"] }), post("um", { lang: "pt" })]);
    expect(tagRoutes(payload, "en")[0]?.props.rss).toBe("/blog/rss.xml");
    expect(postRoutes(payload, "pt")[0]?.props.rss).toBe("/pt/blog/rss.xml");
  });
  it("has an alternate only on page 1 and only when the other language has posts", () => {
    const both = payloadOf([...series(14), post("um", { lang: "pt" })]);
    const [first, second] = indexRoutes(both, "en");
    expect(first?.props).toMatchObject({ altPath: "/pt/blog/", xDefaultPath: "/blog/", langHref: "/pt/blog/" });
    expect(second?.props).toMatchObject({ altPath: null, langHref: "/pt/blog/" });
    expect(indexRoutes(payloadOf(series(1)), "en")[0]?.props.altPath).toBeNull();
    expect(indexRoutes(both, "pt")[0]?.props.xDefaultPath).toBe("/blog/");
  });
});

describe("postRoutes", () => {
  it("links a translated pair both ways and points x-default at the English post", () => {
    const payload = payloadOf([
      post("rules", { translationSlug: "regras" }),
      post("regras", { lang: "pt", translationSlug: "rules" }),
    ]);
    expect(postRoutes(payload, "en")[0]?.props).toMatchObject({ path: "/blog/rules/", altPath: "/pt/blog/regras/", xDefaultPath: "/blog/rules/", langHref: "/pt/blog/regras/" });
    expect(postRoutes(payload, "pt")[0]?.props).toMatchObject({ path: "/pt/blog/regras/", altPath: "/blog/rules/", xDefaultPath: "/blog/rules/", langHref: "/blog/rules/" });
  });
  it("gives an untranslated post no alternate and sends the language switch to the other blog", () => {
    const route = postRoutes(payloadOf([post("alone")]), "en")[0];
    expect(route?.props).toMatchObject({ altPath: null, langHref: "/pt/blog/" });
    expect(route?.params).toEqual({ slug: "alone" });
  });
  it("carries the whole author and the related posts of the same language", () => {
    const lucas = author("lucas", { bioEn: "Builds Ash" });
    const payload = payloadOf(
      [
        post("a", { tags: ["x"], author: { slug: "lucas", name: "Lucas" } }),
        post("b", { tags: ["x"] }),
        post("c", { tags: ["x"], lang: "pt" }),
        post("d", { author: { slug: "ghost", name: "Ghost" } }),
      ],
      [lucas],
    );
    const routes = postRoutes(payload, "en");
    const a = routes.find((r) => r.params.slug === "a");
    expect(a?.props.author).toEqual(lucas);
    expect(a?.props.related.map((p) => p.slug)).toEqual(["b"]);
    // An author the payload did not list still gets a name.
    expect(routes.find((r) => r.params.slug === "d")?.props.author).toMatchObject({ slug: "ghost", name: "Ghost", avatarUrl: null });
    expect(routes.find((r) => r.params.slug === "b")?.props.author).toBeNull();
  });
});

describe("category, tag and author routes", () => {
  const payload = payloadOf(
    [
      post("a", { category: product, tags: ["Orçamento por sessão"], author: { slug: "lucas", name: "Lucas" } }),
      post("b", { category: product, tags: ["solana"] }),
      post("c", { lang: "pt", category: product, tags: ["solana"], author: { slug: "lucas", name: "Lucas" } }),
    ],
    [author("lucas")],
  );
  it("lists a category in each language it has posts in, alternating between them", () => {
    const [en] = categoryRoutes(payload, "en");
    expect(en?.params).toEqual({ slug: "product" });
    expect(en?.props).toMatchObject({ kind: "category", path: "/blog/category/product/", altPath: "/pt/blog/categoria/product/", noindex: false });
    expect(en?.props.posts.map((p) => p.slug).sort()).toEqual(["a", "b"]);
    expect(en?.props.categories).toEqual([product]);
  });
  it("gives a tag page the tag's slug, no alternate and noindex", () => {
    const routes = tagRoutes(payload, "en");
    expect(routes.map((r) => r.params.tag).sort()).toEqual(["orcamento-por-sessao", "solana"]);
    const accented = routes.find((r) => r.params.tag === "orcamento-por-sessao");
    expect(accented?.props).toMatchObject({ kind: "tag", altPath: null, noindex: true, langHref: "/pt/blog/", path: "/blog/tag/orcamento-por-sessao/" });
    expect(accented?.props.tag?.tag).toBe("Orçamento por sessão");
  });
  it("gives an author page the whole author and the pair in the other language", () => {
    const [en] = authorRoutes(payload, "en");
    expect(en?.props).toMatchObject({ kind: "author", path: "/blog/author/lucas/", altPath: "/pt/blog/autor/lucas/" });
    expect(en?.props.author?.bioEn).toBe("Bio in English");
    expect(en?.props.posts.map((p) => p.slug)).toEqual(["a"]);
  });
});

describe("assertBuildable", () => {
  it("stops on a post whose slug is a blog route, in either language", () => {
    expect(() => assertBuildable(payloadOf([post("ok"), post("pagina", { lang: "pt" })]))).toThrow(/pt\/pagina/);
  });
  it("does not stop on two tags that become one URL: one page, and a line for the build log", () => {
    const payload = payloadOf([post("a"), post("b", { lang: "pt", tags: ["Solana!"] }), post("c", { lang: "pt", tags: ["solana"] })]);
    expect(() => assertBuildable(payload)).not.toThrow();
    const routes = tagRoutes(payload, "pt");
    expect(routes).toHaveLength(1);
    expect(routes[0]?.props.tag).toEqual({ tag: "Solana!", slug: "solana", count: 2 });
    expect(routes[0]?.props.posts.map((p) => p.slug).sort()).toEqual(["b", "c"]);
    const warnings = buildWarnings(payload);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('"Solana!" and "solana"');
    expect(warnings[0]).toContain("/tag/solana/");
    expect(buildWarnings(payloadOf([post("a", { tags: ["x"] })]))).toEqual([]);
  });
  it("does not stop on a tag no URL can carry", () => {
    const payload = payloadOf([post("a", { tags: ["日本"] })]);
    expect(() => assertBuildable(payload)).not.toThrow();
    expect(tagRoutes(payload, "en")[0]?.props.path).toMatch(/^\/blog\/tag\/t-[0-9a-f]{8}\/$/);
  });
  it("stops on a contents entry that points at no heading of the body, naming the post", () => {
    const good = post("a", { html: '<h2 id="one">One</h2><p>x</p>', toc: [{ id: "one", text: "One", level: 2 }] });
    expect(() => assertBuildable(payloadOf([good]))).not.toThrow();
    const bad = post("um-post", { lang: "pt", html: '<h2 id="one">One</h2><p>id="two" is text here</p>', toc: [{ id: "one", text: "One", level: 2 }, { id: "two", text: "Two", level: 2 }] });
    expect(() => assertBuildable(payloadOf([good, bad]))).toThrow(/pt\/um-post.*#two/);
  });
  it("accepts the fixture", async () => {
    const load = await readBlog({ env: { BLOG_SOURCE: "fixture" } });
    if (load.mode === "off") throw new Error("fixture mode expected");
    expect(() => assertBuildable(load.payload)).not.toThrow();
    expect(indexRoutes(load.payload, "en").map((r) => r.props.path)).toEqual(["/blog/", "/blog/page/2/"]);
    expect(indexRoutes(load.payload, "pt").map((r) => r.props.path)).toEqual(["/pt/blog/"]);
  });
});

describe("updatedDay and avatarOf", () => {
  it("is null when the edit is on the day of publication, in the blog's time zone", () => {
    expect(updatedDay(post("a", { publishedAt: "2026-09-28T13:00:00.000Z", updatedAt: "2026-09-28T23:30:00.000Z" }), "en")).toBeNull();
    // 02:30 UTC on the 29th is still the 28th in São Paulo.
    expect(updatedDay(post("a", { publishedAt: "2026-09-28T13:00:00.000Z", updatedAt: "2026-09-29T02:30:00.000Z" }), "en")).toBeNull();
  });
  it("is the day of the edit when it is another day", () => {
    const edited = post("a", { publishedAt: "2026-09-28T13:00:00.000Z", updatedAt: "2026-09-29T09:30:00.000Z" });
    expect(updatedDay(edited, "en")).toBe("September 29, 2026");
    expect(updatedDay(edited, "pt")).toBe("29 de setembro de 2026");
  });
  it("points an avatar at the copy in blog-media", () => {
    expect(avatarOf(author("a", { avatarUrl: "/media/autores/x/y.webp" }))).toBe("/blog-media/autores/x/y.webp");
    expect(avatarOf(author("a"))).toBeNull();
  });
});
