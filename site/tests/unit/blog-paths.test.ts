import { describe, it, expect } from "vitest";
import {
  absoluteUrl, authorAlternate, authorPath, blogIndexPath, categoryAlternate, categoryPath, indexAlternate, langSwitchTarget,
  postAlternate, postPath, rssPath, tagPath,
} from "../../src/lib/blog-paths";
import type { PublicPost } from "../../src/lib/blog-types";
import { category, payloadOf, post } from "./blog-helpers";

describe("blog paths", () => {
  it("English lives at /blog/", () => {
    expect(blogIndexPath("en")).toBe("/blog/");
    expect(blogIndexPath("en", 1)).toBe("/blog/");
    expect(blogIndexPath("en", 2)).toBe("/blog/page/2/");
    expect(postPath("en", "a-budget-never-the-keys")).toBe("/blog/a-budget-never-the-keys/");
    expect(categoryPath("en", "payments")).toBe("/blog/category/payments/");
    expect(tagPath("en", "session-keys")).toBe("/blog/tag/session-keys/");
    expect(authorPath("en", "lucas")).toBe("/blog/author/lucas/");
    expect(rssPath("en")).toBe("/blog/rss.xml");
  });
  it("Portuguese lives at /pt/blog/, with its own words", () => {
    expect(blogIndexPath("pt")).toBe("/pt/blog/");
    expect(blogIndexPath("pt", 3)).toBe("/pt/blog/pagina/3/");
    expect(postPath("pt", "um-orcamento")).toBe("/pt/blog/um-orcamento/");
    expect(categoryPath("pt", "payments")).toBe("/pt/blog/categoria/payments/");
    expect(tagPath("pt", "chaves-de-sessao")).toBe("/pt/blog/tag/chaves-de-sessao/");
    expect(authorPath("pt", "lucas")).toBe("/pt/blog/autor/lucas/");
    expect(rssPath("pt")).toBe("/pt/blog/rss.xml");
  });
  it.each([0, -1, 1.5, Number.NaN])("refuses page %s", (page) => {
    expect(() => blogIndexPath("en", page)).toThrow(RangeError);
  });
  it.each(["", "a/b", "../x", "A", "a b", "a?b", "a#b", "a%2f"])("refuses the segment %j", (segment) => {
    expect(() => postPath("en", segment)).toThrow("segment");
    expect(() => categoryPath("pt", segment)).toThrow("segment");
    expect(() => tagPath("en", segment)).toThrow("segment");
    expect(() => authorPath("pt", segment)).toThrow("segment");
  });
});

describe("absoluteUrl", () => {
  it("joins the site and a path, with or without a trailing slash on the site", () => {
    expect(absoluteUrl("https://ash.app.br", "/blog/")).toBe("https://ash.app.br/blog/");
    expect(absoluteUrl("https://ash.app.br/", "/pt/blog/rss.xml")).toBe("https://ash.app.br/pt/blog/rss.xml");
    expect(absoluteUrl("http://localhost:4321", "/")).toBe("http://localhost:4321/");
  });
  it.each(["//evil.example/x", "blog/", "https://evil.example/", "/\\evil.example"])("refuses the path %j", (path) => {
    expect(() => absoluteUrl("https://ash.app.br", path)).toThrow("one slash");
  });
  it.each(["ash.app.br", "javascript:alert(1)", ""])("refuses the site URL %j", (site) => {
    expect(() => absoluteUrl(site, "/blog/")).toThrow("site URL");
  });
});

describe("alternates", () => {
  const pay = category("payments");
  const ops = category("operations");
  const lucas = { slug: "lucas", name: "Lucas" };
  const ana = { slug: "ana", name: "Ana" };
  const payload = payloadOf([
    post("the-pair", { translationSlug: "o-par", category: pay, author: lucas }),
    post("o-par", { lang: "pt", translationSlug: "the-pair", category: pay, author: lucas }),
    post("english-only", { category: ops, author: ana }),
    post("so-em-portugues", { lang: "pt" }),
  ]);
  const [pair, par, alone, sozinho] = payload.posts as [PublicPost, PublicPost, PublicPost, PublicPost];

  it("a post alternates with its translation, and with nothing when it has none", () => {
    expect(postAlternate(pair)).toBe("/pt/blog/o-par/");
    expect(postAlternate(par)).toBe("/blog/the-pair/");
    expect(postAlternate(alone)).toBeNull();
    expect(postAlternate(sozinho)).toBeNull();
  });
  it("the index alternates when the other language has posts", () => {
    expect(indexAlternate("en", payload)).toBe("/pt/blog/");
    expect(indexAlternate("pt", payload)).toBe("/blog/");
    const onlyEnglish = payloadOf([post("english-only")]);
    expect(indexAlternate("en", onlyEnglish)).toBeNull();
    expect(indexAlternate("pt", onlyEnglish)).toBe("/blog/");
  });
  it("a category alternates only when it has posts in the two languages", () => {
    expect(categoryAlternate("en", "payments", payload)).toBe("/pt/blog/categoria/payments/");
    expect(categoryAlternate("pt", "payments", payload)).toBe("/blog/category/payments/");
    expect(categoryAlternate("en", "operations", payload)).toBeNull();
    expect(categoryAlternate("pt", "nope", payload)).toBeNull();
  });
  it("an author alternates only when they have posts in the two languages", () => {
    expect(authorAlternate("en", "lucas", payload)).toBe("/pt/blog/autor/lucas/");
    expect(authorAlternate("pt", "lucas", payload)).toBe("/blog/author/lucas/");
    expect(authorAlternate("en", "ana", payload)).toBeNull();
  });
  it("the language switch goes to the pair, or to the other language's blog", () => {
    expect(langSwitchTarget("en", postAlternate(pair))).toBe("/pt/blog/o-par/");
    expect(langSwitchTarget("en", postAlternate(alone))).toBe("/pt/blog/");
    expect(langSwitchTarget("pt", postAlternate(sozinho))).toBe("/blog/");
    expect(langSwitchTarget("pt", null)).toBe("/blog/");
  });
});
