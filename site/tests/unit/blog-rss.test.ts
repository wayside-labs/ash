import { describe, it, expect } from "vitest";
import sax from "sax";
import { rssXml } from "../../src/lib/blog-rss";
import { post, series } from "./blog-helpers";

// A real XML parser in strict mode: it throws on anything that is not well formed. sax is not a
// dependency of the site; it arrives with @astrojs/sitemap. If that ever changes, this import
// fails loudly and the suite needs another parser.
interface Node { name: string; attributes: Record<string, string>; text: string; children: Node[] }
function parse(xml: string): Node {
  const parser = sax.parser(true);
  const root: Node = { name: "#root", attributes: {}, text: "", children: [] };
  const stack: Node[] = [root];
  const top = () => stack[stack.length - 1] as Node;
  parser.onerror = (err) => { throw err; };
  parser.onopentag = (tag) => {
    const node: Node = { name: tag.name, attributes: tag.attributes as Record<string, string>, text: "", children: [] };
    top().children.push(node);
    stack.push(node);
  };
  parser.ontext = (text) => { top().text += text; };
  parser.oncdata = (text) => { top().text += text; };
  parser.onclosetag = () => { stack.pop(); };
  parser.write(xml).close();
  return root.children[0] as Node;
}
const child = (node: Node, name: string) => node.children.find((c) => c.name === name);
const all = (node: Node, name: string) => node.children.filter((c) => c.name === name);

const feed = { siteUrl: "https://ash.app.br", title: "Ash blog", description: "Notes on giving agents a budget." };

describe("rssXml", () => {
  it("is RSS 2.0 with the channel's own address, language and absolute links", () => {
    const xml = rssXml({ ...feed, lang: "en", posts: [post("a-budget", { title: "A budget", excerpt: "What a budget is.", publishedAt: "2026-09-28T13:00:00.000Z", updatedAt: "2026-09-29T09:30:00.000Z" })] });
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    const rss = parse(xml);
    expect(rss.name).toBe("rss");
    expect(rss.attributes).toMatchObject({ version: "2.0", "xmlns:atom": "http://www.w3.org/2005/Atom" });
    const channel = child(rss, "channel") as Node;
    expect(child(channel, "title")?.text).toBe("Ash blog");
    expect(child(channel, "link")?.text).toBe("https://ash.app.br/blog/");
    expect(child(channel, "description")?.text).toBe("Notes on giving agents a budget.");
    expect(child(channel, "language")?.text).toBe("en");
    expect(child(channel, "lastBuildDate")?.text).toBe("Tue, 29 Sep 2026 09:30:00 GMT");
    expect(child(channel, "atom:link")?.attributes).toEqual({ href: "https://ash.app.br/blog/rss.xml", rel: "self", type: "application/rss+xml" });

    const [item] = all(channel, "item") as [Node];
    expect(child(item, "title")?.text).toBe("A budget");
    expect(child(item, "link")?.text).toBe("https://ash.app.br/blog/a-budget/");
    expect(child(item, "guid")?.text).toBe("https://ash.app.br/blog/a-budget/");
    expect(child(item, "guid")?.attributes).toEqual({ isPermaLink: "true" });
    expect(child(item, "pubDate")?.text).toBe("Mon, 28 Sep 2026 13:00:00 GMT");
    expect(child(item, "description")?.text).toBe("What a budget is.");
  });
  it("speaks Portuguese under /pt/", () => {
    const channel = child(parse(rssXml({ ...feed, lang: "pt", posts: [post("um-post", { lang: "pt" })] })), "channel") as Node;
    expect(child(channel, "language")?.text).toBe("pt-BR");
    expect(child(channel, "link")?.text).toBe("https://ash.app.br/pt/blog/");
    expect(child(channel, "atom:link")?.attributes.href).toBe("https://ash.app.br/pt/blog/rss.xml");
    expect(child(all(channel, "item")[0] as Node, "link")?.text).toBe("https://ash.app.br/pt/blog/um-post/");
  });
  it("lists only the posts of its language", () => {
    const channel = child(parse(rssXml({ ...feed, lang: "en", posts: [post("english"), post("portugues", { lang: "pt" })] })), "channel") as Node;
    expect(all(channel, "item").map((i) => child(i, "link")?.text)).toEqual(["https://ash.app.br/blog/english/"]);
  });
  it("leaves the description out when the post has no excerpt, and never carries the body", () => {
    const xml = rssXml({ ...feed, lang: "en", posts: [post("no-excerpt", { html: "<p>BODY-MARKER</p>" })] });
    const item = all(child(parse(xml), "channel") as Node, "item")[0] as Node;
    expect(child(item, "description")).toBeUndefined();
    expect(xml).not.toContain("BODY-MARKER");
  });
  it("keeps the newest twenty by default", () => {
    const posts = series(25);
    const items = all(child(parse(rssXml({ ...feed, lang: "en", posts })), "channel") as Node, "item");
    expect(items).toHaveLength(20);
    expect(child(items[0] as Node, "link")?.text).toBe("https://ash.app.br/blog/post-01/");
    expect(all(child(parse(rssXml({ ...feed, lang: "en", posts, limit: 3 })), "channel") as Node, "item")).toHaveLength(3);
  });
  it("is still a feed with no posts", () => {
    const channel = child(parse(rssXml({ ...feed, lang: "en", posts: [] })), "channel") as Node;
    expect(all(channel, "item")).toEqual([]);
    expect(child(channel, "lastBuildDate")).toBeUndefined();
  });

  const hostile = [
    '</title><script>alert(1)</script>',
    '"><img src=x onerror=alert(1)>',
    "Tom & Jerry &amp; &lt;b&gt;",
    "it's 'quoted' and \"double\"",
    "]]> <![CDATA[ <!-- -->",
    "</item></channel></rss>",
  ];
  it.each(hostile)("text %j in a title or an excerpt stays text", (text) => {
    const xml = rssXml({ siteUrl: "https://ash.app.br", lang: "en", title: text, description: text, posts: [post("hostile", { title: text, excerpt: text })] });
    const channel = child(parse(xml), "channel") as Node;
    expect(child(channel, "title")?.text).toBe(text);
    expect(child(channel, "description")?.text).toBe(text);
    const items = all(channel, "item");
    expect(items).toHaveLength(1);
    expect(child(items[0] as Node, "title")?.text).toBe(text);
    expect(child(items[0] as Node, "description")?.text).toBe(text);
    expect(xml).not.toContain("<script");
    expect(xml).not.toContain("<img");
  });
  it("escapes the five characters, the apostrophe included", () => {
    const xml = rssXml({ ...feed, lang: "en", posts: [post("five", { title: `<>&"'` })] });
    expect(xml).toContain("<title>&lt;&gt;&amp;&quot;&apos;</title>");
  });
  it("drops characters XML cannot carry instead of emitting a broken feed", () => {
    const text = `a${String.fromCharCode(0)}b${String.fromCharCode(8)}c${String.fromCharCode(0x1b)}d${String.fromCharCode(0xd800)}e${String.fromCharCode(0xffff)}f`;
    const xml = rssXml({ ...feed, lang: "en", posts: [post("control", { title: `${text} ok\ttab`, excerpt: "astral 🙂 stays" })] });
    const item = all(child(parse(xml), "channel") as Node, "item")[0] as Node;
    expect(child(item, "title")?.text).toBe("abcdef ok\ttab");
    expect(child(item, "description")?.text).toBe("astral 🙂 stays");
  });
  it("refuses a site URL that is not one", () => {
    expect(() => rssXml({ ...feed, siteUrl: "javascript:alert(1)", lang: "en", posts: [] })).toThrow("site URL");
    expect(() => rssXml({ ...feed, siteUrl: "ash.app.br", lang: "en", posts: [] })).toThrow("site URL");
  });
});
