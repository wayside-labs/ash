import { describe, it, expect } from "vitest";
import { generatedCover } from "../../src/lib/blog-cover";
import { ogImageHref, ogImageTarget, ogJobs } from "../../src/lib/blog-og";
import { shareLinks } from "../../src/lib/blog-share";
import { payloadOf, post } from "./blog-helpers";

describe("og:image of a cover", () => {
  // The size itself (1200 by 630) is checked where it is real: the e2e decodes the file.
  it("is a JPEG beside the cover in blog-media", () => {
    expect(ogImageTarget("/media/posts/a/b.webp")).toBe("blog-media/posts/a/b.webp.og.jpg");
    expect(ogImageHref("/media/posts/a/b.webp")).toBe("/blog-media/posts/a/b.webp.og.jpg");
  });
  it("gives two covers two files, even when one name is the other plus a suffix", () => {
    expect(ogImageTarget("/media/posts/a/b.webp")).not.toBe(ogImageTarget("/media/posts/a/b"));
    expect(ogImageTarget("/media/posts/a/b.webp.og.jpg")).toBe("blog-media/posts/a/b.webp.og.jpg.og.jpg");
  });
  it("refuses a cover that is not a /media/ path", () => {
    expect(() => ogImageHref("https://evil.test/x.webp")).toThrow(/not a \/media\/ path/);
    expect(() => ogImageHref("/media/../secret")).toThrow();
  });
  it("makes one job per cover, sorted, and none for a post without one", () => {
    const payload = payloadOf([
      post("a", { coverUrl: "/media/posts/z/1.webp" }),
      post("b", { coverUrl: "/media/posts/a/2.webp" }),
      post("c", { coverUrl: "/media/posts/z/1.webp", lang: "pt" }),
      post("d"),
    ]);
    expect(ogJobs(payload)).toEqual([
      { source: "blog-media/posts/a/2.webp", target: "blog-media/posts/a/2.webp.og.jpg" },
      { source: "blog-media/posts/z/1.webp", target: "blog-media/posts/z/1.webp.og.jpg" },
    ]);
    expect(ogJobs(payloadOf([post("d")]))).toEqual([]);
  });
});

describe("generatedCover", () => {
  it("is the same for the same slug and stays inside the bar", () => {
    expect(generatedCover("a-budget")).toEqual(generatedCover("a-budget"));
    for (const slug of ["a", "a-budget-never-the-keys", "regras-que-valem", "x".repeat(120)]) {
      const { bars } = generatedCover(slug);
      expect(bars).toHaveLength(3);
      for (const fill of bars) {
        expect(Number.isInteger(fill)).toBe(true);
        expect(fill).toBeGreaterThanOrEqual(22);
        expect(fill).toBeLessThanOrEqual(88);
      }
    }
  });
  it("differs between posts", () => {
    const drawn = ["agents-that-pay", "devnet-first", "why-not-a-wallet", "sessions-that-expire"].map((slug) => generatedCover(slug).bars.join(","));
    expect(new Set(drawn).size).toBe(drawn.length);
  });
});

describe("shareLinks", () => {
  const url = "https://ash.app.br/blog/a-post/";
  it("encodes the address and the title, whatever the title carries", () => {
    const title = 'Tom & Jerry </script> "quotes" #1?';
    const links = shareLinks(url, title);
    expect(links.map((l) => l.id)).toEqual(["x", "linkedin", "whatsapp", "email"]);
    for (const link of links) {
      expect(link.href).not.toMatch(/[<>"\s]/);
      expect(link.href).toMatch(/^(https:\/\/(x\.com|www\.linkedin\.com|wa\.me)\/|mailto:\?)/);
    }
    const x = new URL(links[0]?.href as string);
    expect(x.searchParams.get("url")).toBe(url);
    expect(x.searchParams.get("text")).toBe(title);
    expect(new URL(links[2]?.href as string).searchParams.get("text")).toBe(`${title} ${url}`);
    expect(decodeURIComponent((links[3]?.href as string).split("body=")[1] as string)).toBe(url);
  });
  it("survives half a surrogate pair in a title instead of throwing URI malformed", () => {
    const high = String.fromCharCode(0xd83d);
    const low = String.fromCharCode(0xde00);
    for (const title of [`broken ${high} title`, `${low}start`, `end${high}`]) {
      const links = shareLinks(url, title);
      expect(links).toHaveLength(4);
      const text = new URL(links[0]?.href as string).searchParams.get("text") as string;
      expect(text).toBe(title.replace(high, "�").replace(low, "�"));
    }
    // A whole pair is a character and is left alone.
    expect(new URL(shareLinks(url, `ok ${high}${low}`)[0]?.href as string).searchParams.get("text")).toBe(`ok ${high}${low}`);
  });
});
