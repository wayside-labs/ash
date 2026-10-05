import { describe, it, expect } from "vitest";
import { isMediaPath, validatePayload } from "../../src/lib/blog-validate";
import { author, category, payloadOf, post } from "./blog-helpers";

// A payload that is valid, deep-cloned, with one thing changed.
function broken(change: (p: any) => void): unknown {
  const pt = post("um-post", { lang: "pt", translationSlug: "a-post" });
  const en = post("a-post", {
    translationSlug: "um-post", category: category(), author: { slug: "lucas", name: "Lucas" },
    coverUrl: "/media/posts/a/capa.webp", coverAlt: "Cover", tags: ["solana"],
    toc: [{ id: "one", text: "One", level: 2 }], html: '<h2 id="one">One</h2><p>body</p>',
  });
  const clone = JSON.parse(JSON.stringify(payloadOf([en, pt], [author("lucas", { avatarUrl: "/media/autores/a/b.webp" })])));
  change(clone);
  return clone;
}
const ok = () => broken(() => {});

describe("validatePayload", () => {
  it("returns a valid payload as it came", () => {
    const input = ok();
    expect(validatePayload(input)).toEqual(input);
  });
  it("turns an optional text the studio sent empty into null, so a page's fallback applies", () => {
    const out = validatePayload(broken((p) => {
      p.posts[0].excerpt = "";
      p.posts[0].metaTitle = "   ";
      p.posts[0].metaDescription = "\n\t";
      p.posts[0].coverAlt = "";
      p.posts[1].metaTitle = " kept as typed ";
    }));
    expect(out.posts[0]).toMatchObject({ excerpt: null, metaTitle: null, metaDescription: null, coverAlt: null });
    expect(out.posts[1]?.metaTitle).toBe(" kept as typed ");
    // A title is not optional: empty is still an error.
    expect(() => validatePayload(broken((p) => { p.posts[0].title = "  "; }))).toThrow("posts[0].title");
  });
  it("accepts an empty blog", () => {
    expect(validatePayload({ posts: [], categories: [], authors: [] })).toEqual({ posts: [], categories: [], authors: [] });
  });
  it("tolerates keys it does not know, and does not pass them on", () => {
    const out = validatePayload(broken((p) => { p.posts[0].views = 3; p.version = 2; p.authors[0].email = "a@b.c"; }));
    expect(out).toEqual(ok());
    expect(JSON.stringify(out)).not.toContain("a@b.c");
  });

  it.each([
    ["not an object", () => null, "payload"],
    ["an array", () => [], "payload"],
  ])("refuses %s", (_name, make, path) => {
    expect(() => validatePayload(make())).toThrow(`blog payload: ${path}:`);
  });

  it.each<[string, (p: any) => void, string]>([
    ["posts missing", (p) => { delete p.posts; }, "posts"],
    ["categories not a list", (p) => { p.categories = {}; }, "categories"],
    ["authors missing", (p) => { delete p.authors; }, "authors"],
    ["a post that is not an object", (p) => { p.posts[1] = "x"; }, "posts[1]"],
    ["slug missing", (p) => { delete p.posts[0].slug; }, "posts[0].slug"],
    ["slug with an upper-case letter", (p) => { p.posts[0].slug = "A-post"; }, "posts[0].slug"],
    ["slug of one character", (p) => { p.posts[0].slug = "a"; }, "posts[0].slug"],
    ["slug with a slash", (p) => { p.posts[0].slug = "a/b"; }, "posts[0].slug"],
    ["unknown language", (p) => { p.posts[0].lang = "es"; }, "posts[0].lang"],
    ["title of the wrong type", (p) => { p.posts[0].title = 7; }, "posts[0].title"],
    ["empty title", (p) => { p.posts[0].title = "  "; }, "posts[0].title"],
    ["excerpt missing (null is the empty value)", (p) => { delete p.posts[0].excerpt; }, "posts[0].excerpt"],
    ["html null", (p) => { p.posts[0].html = null; }, "posts[0].html"],
    ["toc not a list", (p) => { p.posts[0].toc = "x"; }, "posts[0].toc"],
    ["toc level 4", (p) => { p.posts[0].toc[0].level = 4; }, "posts[0].toc[0].level"],
    ["toc text missing", (p) => { delete p.posts[0].toc[0].text; }, "posts[0].toc[0].text"],
    ["toc id empty", (p) => { p.posts[0].toc[0].id = ""; }, "posts[0].toc[0].id"],
    ["reading time as text", (p) => { p.posts[0].readingMinutes = "1"; }, "posts[0].readingMinutes"],
    ["reading time of zero", (p) => { p.posts[0].readingMinutes = 0; }, "posts[0].readingMinutes"],
    ["category without a name", (p) => { delete p.posts[0].category.nameEn; }, "posts[0].category.nameEn"],
    ["category that is not in the list", (p) => { p.posts[0].category.slug = "other"; }, "posts[0].category.slug"],
    ["tags not a list", (p) => { p.posts[0].tags = "solana"; }, "posts[0].tags"],
    ["a tag that is not text", (p) => { p.posts[0].tags = ["ok", 3]; }, "posts[0].tags[1]"],
    ["an empty tag", (p) => { p.posts[0].tags = [""]; }, "posts[0].tags[0]"],
    ["author without a name", (p) => { delete p.posts[0].author.name; }, "posts[0].author.name"],
    ["author that is not in the list", (p) => { p.posts[0].author.slug = "ana"; }, "posts[0].author.slug"],
    ["cover on another origin", (p) => { p.posts[0].coverUrl = "https://evil.example/media/x.webp"; }, "posts[0].coverUrl"],
    ["cover outside /media/", (p) => { p.posts[0].coverUrl = "/img/x.webp"; }, "posts[0].coverUrl"],
    ["cover that climbs out", (p) => { p.posts[0].coverUrl = "/media/../secret.webp"; }, "posts[0].coverUrl"],
    ["cover with a query", (p) => { p.posts[0].coverUrl = "/media/a.webp?x=1"; }, "posts[0].coverUrl"],
    ["cover with a backslash", (p) => { p.posts[0].coverUrl = "/media/a\\b.webp"; }, "posts[0].coverUrl"],
    ["cover alt of the wrong type", (p) => { p.posts[0].coverAlt = 1; }, "posts[0].coverAlt"],
    ["meta title missing", (p) => { delete p.posts[0].metaTitle; }, "posts[0].metaTitle"],
    ["meta description of the wrong type", (p) => { p.posts[0].metaDescription = []; }, "posts[0].metaDescription"],
    ["featured as text", (p) => { p.posts[0].featured = "true"; }, "posts[0].featured"],
    ["a date that is not a date", (p) => { p.posts[0].publishedAt = "yesterday"; }, "posts[0].publishedAt"],
    ["a date without a time", (p) => { p.posts[0].publishedAt = "2026-09-01"; }, "posts[0].publishedAt"],
    ["a date that does not exist", (p) => { p.posts[0].updatedAt = "2026-13-45T00:00:00.000Z"; }, "posts[0].updatedAt"],
    ["translation that points nowhere", (p) => { p.posts[0].translationSlug = "nao-existe"; }, "posts[0].translationSlug"],
    ["translation in the same language", (p) => { p.posts[1].lang = "en"; }, "posts[0].translationSlug"],
    ["translation that does not point back", (p) => { p.posts[1].translationSlug = null; }, "posts[0].translationSlug"],
    ["category slug malformed", (p) => { p.categories[0].slug = "Payments!"; }, "categories[0].slug"],
    ["category name missing", (p) => { delete p.categories[0].namePt; }, "categories[0].namePt"],
    ["author bio missing", (p) => { delete p.authors[0].bioEn; }, "authors[0].bioEn"],
    ["avatar on another origin", (p) => { p.authors[0].avatarUrl = "//evil.example/a.webp"; }, "authors[0].avatarUrl"],
    ["avatar missing", (p) => { delete p.authors[0].avatarUrl; }, "authors[0].avatarUrl"],
  ])("refuses %s, naming the field", (_name, change, path) => {
    expect(() => validatePayload(broken(change))).toThrow(`blog payload: ${path}:`);
  });

  it("refuses two posts with the same language and slug, naming the second", () => {
    const input = broken((p) => { p.posts.push({ ...p.posts[0], translationSlug: null }); });
    expect(() => validatePayload(input)).toThrow("blog payload: posts[2].slug:");
  });
  it("accepts the same slug in the two languages", () => {
    const input = payloadOf([post("ash", { translationSlug: "ash" }), post("ash", { lang: "pt", translationSlug: "ash" })]);
    expect(validatePayload(input).posts).toHaveLength(2);
  });
  it("refuses a category or an author listed twice", () => {
    expect(() => validatePayload(broken((p) => { p.categories.push(p.categories[0]); }))).toThrow("blog payload: categories[1].slug:");
    expect(() => validatePayload(broken((p) => { p.authors.push(p.authors[0]); }))).toThrow("blog payload: authors[1].slug:");
  });
  it("never repeats the offending value in the message", () => {
    const secret = "https://evil.example/media/segredo.webp";
    try {
      validatePayload(broken((p) => { p.posts[0].coverUrl = secret; }));
      expect.unreachable();
    } catch (err) {
      expect((err as Error).message).not.toContain("evil.example");
    }
  });
});

describe("isMediaPath", () => {
  it("is the studio's rule", () => {
    for (const good of ["/media/a.webp", "/media/posts/0b8e6f2a/1c2d.webp", "/media/autores/x/y_z-1.webp"]) expect(isMediaPath(good), good).toBe(true);
    for (const bad of ["", "/media", "/media/", "media/a.webp", "/media//a.webp", "/media/./a.webp", "/media/../a.webp", "/media/a..b.webp",
      "/media/a.webp?x", "/media/a.webp#x", "/media/a b.webp", "/media/a%2e.webp", "/media/a\\b.webp", "https://x/media/a.webp", "//x/media/a.webp", "/media/.a"]) {
      expect(isMediaPath(bad), bad).toBe(false);
    }
  });
});
