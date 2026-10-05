import { describe, it, expect } from "vitest";
import {
  PAGE_SIZE, assertNoReservedSlugs, authorBio, authorSlugsOf, categoriesOf, categoryName, coverOf, extraPages,
  formatPostDate, indexPosts, pageCount, paginate, postsByAuthor, postsByCategory, postsByLang, relatedPosts,
} from "../../src/lib/blog-model";
import { author, category, payloadOf, post, series } from "./blog-helpers";

const slugs = (posts: { slug: string }[]) => posts.map((p) => p.slug);

describe("postsByLang", () => {
  it("keeps one language, newest first, whatever order the payload came in", () => {
    const payload = payloadOf([
      post("old", { publishedAt: "2026-01-01T00:00:00.000Z" }),
      post("pt-one", { lang: "pt", publishedAt: "2026-06-01T00:00:00.000Z" }),
      post("new", { publishedAt: "2026-09-01T00:00:00.000Z" }),
      post("mid", { publishedAt: "2026-05-01T00:00:00.000Z" }),
    ]);
    expect(slugs(postsByLang(payload, "en"))).toEqual(["new", "mid", "old"]);
    expect(slugs(postsByLang(payload, "pt"))).toEqual(["pt-one"]);
  });
  it("breaks a tie on the date by slug, so two builds give the same pages", () => {
    const at = { publishedAt: "2026-09-01T00:00:00.000Z" };
    expect(slugs(postsByLang(payloadOf([post("bb", at), post("aa", at), post("cc", at)]), "en"))).toEqual(["aa", "bb", "cc"]);
  });
  it("does not reorder the payload it was given", () => {
    const payload = payloadOf([post("old", { publishedAt: "2026-01-01T00:00:00.000Z" }), post("new")]);
    postsByLang(payload, "en");
    expect(slugs(payload.posts)).toEqual(["old", "new"]);
  });
});

describe("indexPosts", () => {
  it("puts the featured posts first and keeps the order inside each group", () => {
    const posts = [post("a1"), post("b2", { featured: true }), post("c3"), post("d4", { featured: true })];
    expect(slugs(indexPosts(posts))).toEqual(["b2", "d4", "a1", "c3"]);
  });
});

describe("pagination", () => {
  it("is twelve to a page", () => {
    expect(PAGE_SIZE).toBe(12);
    expect([0, 1, 12, 13, 24, 25].map((n) => pageCount(n))).toEqual([1, 1, 1, 2, 2, 3]);
  });
  it("slices each page", () => {
    const posts = series(14);
    const first = paginate(posts, 1);
    expect(first).toMatchObject({ page: 1, pageCount: 2, total: 14 });
    expect(slugs(first.items)).toEqual(slugs(posts.slice(0, 12)));
    expect(slugs(paginate(posts, 2).items)).toEqual(["post-13", "post-14"]);
  });
  it("gives an empty first page for an empty list", () => {
    expect(paginate([], 1)).toEqual({ items: [], page: 1, pageCount: 1, total: 0 });
  });
  it.each([0, -1, 3, 1.5, Number.NaN, Number.POSITIVE_INFINITY])("throws on page %s of two", (page) => {
    expect(() => paginate(series(14), page)).toThrow(RangeError);
  });
  it("lists the pages after the first, which are the ones that get a route of their own", () => {
    expect(extraPages(0)).toEqual([]);
    expect(extraPages(12)).toEqual([]);
    expect(extraPages(13)).toEqual([2]);
    expect(extraPages(37)).toEqual([2, 3, 4]);
  });
});

describe("by category and by author", () => {
  const pay = category("payments");
  const ops = category("operations", { namePt: "Operação", nameEn: "Operations" });
  const posts = [
    post("a1", { category: pay, author: { slug: "lucas", name: "Lucas" } }),
    post("b2", { category: ops, author: { slug: "ana", name: "Ana" } }),
    post("c3", { category: pay }),
    post("d4"),
  ];
  it("filters", () => {
    expect(slugs(postsByCategory(posts, "payments"))).toEqual(["a1", "c3"]);
    expect(slugs(postsByCategory(posts, "nope"))).toEqual([]);
    expect(slugs(postsByAuthor(posts, "ana"))).toEqual(["b2"]);
  });
  it("lists the categories and authors in use, once each, by slug", () => {
    expect(categoriesOf(posts)).toEqual([ops, pay]);
    expect(authorSlugsOf(posts)).toEqual(["ana", "lucas"]);
    expect(categoriesOf([])).toEqual([]);
  });
});

describe("relatedPosts", () => {
  const cat = category("payments");
  const day = (n: number) => `2026-09-${String(n).padStart(2, "0")}T12:00:00.000Z`;
  const me = post("me", { tags: ["solana", "agents", "limits"], category: cat, publishedAt: day(20) });
  const all = [
    me,
    post("one-tag-new", { tags: ["solana"], publishedAt: day(19) }),
    post("two-tags-old", { tags: ["agents", "limits", "x"], publishedAt: day(2) }),
    post("one-tag-old", { tags: ["limits"], publishedAt: day(3) }),
    post("category-only", { category: cat, publishedAt: day(18) }),
    post("unrelated", { tags: ["other"], publishedAt: day(21) }),
    post("pt-same-tags", { lang: "pt", tags: ["solana", "agents", "limits"], category: cat, publishedAt: day(22) }),
  ];
  it("ranks by shared tags, then newest; the category comes after every tag match", () => {
    expect(slugs(relatedPosts(me, all, 10))).toEqual(["two-tags-old", "one-tag-new", "one-tag-old", "category-only"]);
  });
  it("cuts at n, three by default", () => {
    expect(slugs(relatedPosts(me, all))).toEqual(["two-tags-old", "one-tag-new", "one-tag-old"]);
    expect(relatedPosts(me, all, 0)).toEqual([]);
  });
  it("never returns the post itself, another language, or a post that shares nothing", () => {
    const out = slugs(relatedPosts(me, [me, ...all, me], 50));
    expect(out).not.toContain("me");
    expect(out).not.toContain("pt-same-tags");
    expect(out).not.toContain("unrelated");
  });
  it("gives the same answer whatever order the posts come in", () => {
    expect(slugs(relatedPosts(me, [...all].reverse(), 10))).toEqual(slugs(relatedPosts(me, all, 10)));
  });
  it("is empty for a post with no tag and no category", () => {
    expect(relatedPosts(post("alone"), all)).toEqual([]);
  });
});

describe("assertNoReservedSlugs", () => {
  it("accepts ordinary slugs, including ones that only contain a reserved word", () => {
    expect(() => assertNoReservedSlugs([post("page-one"), post("my-tag"), post("pagina-nova", { lang: "pt" })])).not.toThrow();
  });
  it.each(["page", "category", "tag", "author", "pagina", "categoria", "autor"])(
    "throws on a post called %s, in either language, saying which post", (slug) => {
      expect(() => assertNoReservedSlugs([post("fine"), post(slug)])).toThrow(`en/${slug}`);
      expect(() => assertNoReservedSlugs([post(slug, { lang: "pt" })])).toThrow(`pt/${slug}`);
    });
});

describe("formatPostDate", () => {
  it("writes the date the way each language does", () => {
    expect(formatPostDate("2026-10-01T15:00:00.000Z", "en")).toBe("October 1, 2026");
    expect(formatPostDate("2026-10-01T15:00:00.000Z", "pt")).toBe("1 de outubro de 2026");
  });
  // 02:30 UTC is still the day before in Sao Paulo: the machine's zone must not decide the day.
  it("uses the blog's time zone, not the machine's", () => {
    expect(formatPostDate("2026-10-01T02:30:00.000Z", "en")).toBe("September 30, 2026");
    expect(formatPostDate("2026-10-01T02:30:00.000Z", "pt")).toBe("30 de setembro de 2026");
    expect(formatPostDate("2026-10-01T02:30:00.000Z", "en", "UTC")).toBe("October 1, 2026");
  });
  it("throws on something that is not a date", () => {
    expect(() => formatPostDate("soon", "en")).toThrow("not a date");
  });
});

describe("names, bios and covers per language", () => {
  it("picks the category name and the bio of the page's language", () => {
    expect(categoryName(category(), "en")).toBe("Payments");
    expect(categoryName(category(), "pt")).toBe("Pagamentos");
    expect(authorBio(author(), "en")).toBe("Bio in English");
    expect(authorBio(author(), "pt")).toBe("Bio em português");
  });
  it("gives the cover as the page will ask for it, with the title standing in for a missing alt", () => {
    expect(coverOf(post("a1"))).toBeNull();
    expect(coverOf(post("a1", { coverUrl: "/media/posts/a/c.webp", coverAlt: "A vault" }))).toEqual({ src: "/blog-media/posts/a/c.webp", alt: "A vault" });
    expect(coverOf(post("a1", { title: "The title", coverUrl: "/media/posts/a/c.webp" }))).toEqual({ src: "/blog-media/posts/a/c.webp", alt: "The title" });
  });
});
