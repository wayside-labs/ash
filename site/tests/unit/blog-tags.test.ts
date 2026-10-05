import { describe, it, expect } from "vitest";
import { postsByTag, tagCollisions, tagIndex, tagSlug } from "../../src/lib/blog-tags";
import { post } from "./blog-helpers";

describe("tagSlug", () => {
  it.each([
    ["solana", "solana"],
    ["agentes de ia", "agentes-de-ia"],
    ["orçamento por sessão", "orcamento-por-sessao"],
    ["política de gastos", "politica-de-gastos"],
    ["token-2022", "token-2022"],
    ["  spaced   out  ", "spaced-out"],
    ['<b>bold</b> & "quoted"', "b-bold-b-quoted"],
  ])("turns %j into %j", (tag, slug) => {
    expect(tagSlug(tag)).toBe(slug);
  });
  it("gives one slug to the composed and the decomposed form of a letter", () => {
    const composed = "sessão".normalize("NFC");
    const decomposed = "sessão".normalize("NFD");
    expect(decomposed).not.toBe(composed);
    expect(tagSlug(decomposed)).toBe(tagSlug(composed));
  });
  it("gives a tag with no Latin letter or digit a stable slug instead of stopping the build", () => {
    for (const tag of ["日本", "---", "😀", "  "]) {
      const slug = tagSlug(tag);
      expect(slug, tag).toMatch(/^t-[0-9a-f]{8}$/);
      expect(tagSlug(tag), tag).toBe(slug);
    }
    expect(tagSlug("日本")).not.toBe(tagSlug("中国"));
    // The same characters, composed or not, with or without spaces around: the same page.
    expect(tagSlug(" 日本 ")).toBe(tagSlug("日本"));
    // A tag that has one usable character keeps the readable slug.
    expect(tagSlug("日本 2")).toBe("2");
  });
});

describe("tagIndex", () => {
  const posts = [
    post("a1", { tags: ["solana", "orçamento por sessão"] }),
    post("b2", { tags: ["solana", "agents"] }),
    post("c3", { tags: ["solana"] }),
    post("d4"),
  ];
  it("counts the posts of each tag, most used first, then by name", () => {
    expect(tagIndex(posts)).toEqual([
      { tag: "solana", slug: "solana", count: 3 },
      { tag: "agents", slug: "agents", count: 1 },
      { tag: "orçamento por sessão", slug: "orcamento-por-sessao", count: 1 },
    ]);
  });
  it("counts a tag once per post", () => {
    expect(tagIndex([post("a1", { tags: ["solana", "solana"] })])).toEqual([{ tag: "solana", slug: "solana", count: 1 }]);
  });
  it("treats two spellings with one slug as one tag: the first spelling names it, the posts of both are counted", () => {
    const clash = [post("a1", { tags: ["sessão"] }), post("b2", { tags: ["sessao"] }), post("c3", { tags: ["Sessão", "other"] })];
    expect(tagIndex(clash)).toEqual([
      { tag: "sessão", slug: "sessao", count: 3 },
      { tag: "other", slug: "other", count: 1 },
    ]);
    expect(postsByTag(clash, "sessao").map((p) => p.slug)).toEqual(["a1", "b2", "c3"]);
    // Both spellings on one post are one mention of the tag.
    expect(tagIndex([post("a1", { tags: ["limit s", "limit-s"] })])).toEqual([{ tag: "limit s", slug: "limit-s", count: 1 }]);
  });
  it("names the spellings that share a page, for the build log", () => {
    const clash = [post("a1", { tags: ["sessão", "solana"] }), post("b2", { tags: ["sessao"] }), post("c3", { tags: ["Sessão", "sessão"] })];
    expect(tagCollisions(clash)).toEqual([{ slug: "sessao", tags: ["sessão", "sessao", "Sessão"] }]);
    expect(tagCollisions([post("a1", { tags: ["solana", "agents"] })])).toEqual([]);
  });
  it("is empty without tags", () => {
    expect(tagIndex([post("a1")])).toEqual([]);
  });
});

describe("postsByTag", () => {
  it("finds the posts by the tag's slug", () => {
    const posts = [post("a1", { tags: ["orçamento por sessão"] }), post("b2", { tags: ["solana"] }), post("c3", { tags: ["solana", "orçamento por sessão"] })];
    expect(postsByTag(posts, "orcamento-por-sessao").map((p) => p.slug)).toEqual(["a1", "c3"]);
    expect(postsByTag(posts, "nope")).toEqual([]);
  });
});
