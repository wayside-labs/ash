import { test, expect, type Page } from "@playwright/test";
import { requireFixtureBuild } from "./blog-build";

requireFixtureBuild();

// What a crawler and a feed reader get from the blog, against the fixture build: canonical,
// Open Graph, structured data, the feed and the sitemap.

const SITE = "https://ash.app.br";
const meta = (page: Page, property: string) => page.locator(`meta[property="${property}"]`);

test("a post declares canonical, article metadata and structured data that parses", async ({ page, request }) => {
  await page.goto("/blog/how-this-blog-is-built/");
  await expect(page).toHaveTitle("Sample: how this blog is built — Ash");
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", `${SITE}/blog/how-this-blog-is-built/`);
  await expect(page.locator('meta[name="description"]')).toHaveAttribute("content", "Sample post about how a post leaves the studio and becomes a page of this site.");
  await expect(meta(page, "og:type")).toHaveAttribute("content", "article");
  await expect(meta(page, "og:url")).toHaveAttribute("content", `${SITE}/blog/how-this-blog-is-built/`);
  await expect(meta(page, "article:published_time")).toHaveAttribute("content", "2026-09-28T13:00:00.000Z");
  await expect(meta(page, "article:modified_time")).toHaveAttribute("content", "2026-09-29T09:30:00.000Z");
  await expect(page.locator('meta[name="robots"]')).toHaveCount(0);
  await expect(page.locator('link[rel="alternate"][type="application/rss+xml"]')).toHaveAttribute("href", "/blog/rss.xml");

  // og:image is the cover as a 1200x630 JPEG written by the build, on this site.
  const image = await meta(page, "og:image").getAttribute("content");
  expect(image).toMatch(/^https:\/\/ash\.app\.br\/blog-media\/posts\/[a-z0-9-]+\/[a-z0-9-]+\.webp\.og\.jpg$/);
  const file = await request.get(new URL(image as string).pathname);
  expect(file.status()).toBe(200);
  expect(file.headers()["content-type"]).toBe("image/jpeg");
  const bytes = await file.body();
  expect([bytes[0], bytes[1], bytes[2]]).toEqual([0xff, 0xd8, 0xff]);
  const size = await page.evaluate(async (src) => {
    const img = new Image();
    img.src = src;
    await img.decode();
    return [img.naturalWidth, img.naturalHeight];
  }, new URL(image as string).pathname);
  expect(size).toEqual([1200, 630]);

  const blocks = (await page.locator('script[type="application/ld+json"]').allTextContents()).map((text) => JSON.parse(text));
  expect(blocks.map((b) => b["@type"])).toEqual(["BlogPosting", "BreadcrumbList"]);
  const [posting, crumbs] = blocks;
  expect(posting).toMatchObject({
    "@context": "https://schema.org",
    headline: "Sample: how this blog is built",
    url: `${SITE}/blog/how-this-blog-is-built/`,
    datePublished: "2026-09-28T13:00:00.000Z",
    dateModified: "2026-09-29T09:30:00.000Z",
    inLanguage: "en",
    articleSection: "Product",
    keywords: "release notes, glossary, site",
    image: [image],
    author: { "@type": "Person", name: "Ash team", url: `${SITE}/blog/author/ash-team/` },
    publisher: { "@type": "Organization", name: "Ash" },
  });
  expect(crumbs.itemListElement.map((item: { name: string; item: string }) => [item.name, item.item])).toEqual([
    ["Ash", `${SITE}/`],
    ["Blog", `${SITE}/blog/`],
    ["Sample: how this blog is built", `${SITE}/blog/how-this-blog-is-built/`],
  ]);
});

test("a post with no cover keeps the site's image, and the Portuguese post says so in Portuguese", async ({ page }) => {
  await page.goto("/pt/blog/um-post-curto/");
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", `${SITE}/pt/blog/um-post-curto/`);
  await expect(meta(page, "og:type")).toHaveAttribute("content", "article");
  await expect(meta(page, "og:image")).toHaveAttribute("content", `${SITE}/og.png`);
  await expect(page.locator('link[rel="alternate"][type="application/rss+xml"]')).toHaveAttribute("href", "/pt/blog/rss.xml");
  // With no meta description the excerpt is the description.
  await expect(page.locator('meta[name="description"]')).toHaveAttribute("content", "Post de exemplo. Dois parágrafos, sem títulos e sem imagem.");
  const posting = JSON.parse((await page.locator('script[type="application/ld+json"]').first().textContent()) as string);
  expect(posting.inLanguage).toBe("pt-BR");
  // The structured data always names a picture: the site's own when the post has no cover.
  expect(posting.image).toEqual([`${SITE}/og.png`]);
});

test("a post with no summary at all describes itself with the first words of its body", async ({ page }) => {
  await page.goto("/blog/a-post-without-a-summary/");
  const description = (await page.locator('meta[name="description"]').getAttribute("content")) as string;
  expect(description.startsWith("Sample post, written to test the blog. Nobody wrote a summary for this one")).toBe(true);
  expect(description.endsWith("…")).toBe(true);
  expect([...description].length).toBeLessThanOrEqual(156);
  await expect(page).toHaveTitle("Sample: a post without a summary — Ash");
  await expect(meta(page, "og:description")).toHaveAttribute("content", description);
});

test("list pages are websites with a canonical, the feed link and a description of their own", async ({ page }) => {
  const seen = new Set<string>();
  for (const [path, title, description] of [
    ["/blog/", "Blog — Ash", "Notes from the people building Ash, on how agents pay and the rules around it."],
    ["/blog/page/2/", "Blog · Page 2 — Ash", "Page 2 of 2 of the Ash blog."],
    ["/blog/category/engineering/", "Engineering — Blog — Ash", "Posts in Engineering on the Ash blog."],
    ["/blog/author/ash-team/", "Ash team — Blog — Ash", "Posts by Ash team on the Ash blog."],
    ["/pt/blog/tag/site/", "site — Blog — Ash", "Posts com a tag site no blog do Ash."],
  ] as const) {
    await page.goto(path);
    await expect(page).toHaveTitle(title);
    await expect(page.locator('meta[name="description"]')).toHaveAttribute("content", description);
    seen.add(description);
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", `${SITE}${path}`);
    await expect(meta(page, "og:type")).toHaveAttribute("content", "website");
    await expect(meta(page, "og:image")).toHaveAttribute("content", `${SITE}/og.png`);
    await expect(page.locator('link[rel="alternate"][type="application/rss+xml"]')).toHaveCount(1);
    await expect(page.locator('script[type="application/ld+json"]')).toHaveCount(0);
  }
  expect(seen.size).toBe(5);
});

for (const feed of [
  { path: "/blog/rss.xml", language: "en", root: `${SITE}/blog/`, items: 14, first: "Sample: how this blog is built" },
  { path: "/pt/blog/rss.xml", language: "pt-BR", root: `${SITE}/pt/blog/`, items: 3, first: "Exemplo: como este blog é feito" },
]) {
  test(`${feed.path} is valid XML in the right language with absolute links`, async ({ page, request }) => {
    const res = await request.get(feed.path);
    expect(res.status()).toBe(200);
    const xml = await res.text();
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    // A real XML parser (the browser's): one stray "<" from a hostile title and this is a parsererror.
    await page.goto("/blog/");
    const parsed = await page.evaluate((text) => {
      const doc = new DOMParser().parseFromString(text, "application/xml");
      const all = (selector: string) => [...doc.querySelectorAll(selector)].map((el) => el.textContent ?? "");
      return {
        error: doc.querySelector("parsererror")?.textContent ?? null,
        root: doc.documentElement.nodeName,
        language: all("channel > language"),
        // atom:link (the feed's own address) is a "link" to the selector too, and it is empty.
        channelLink: all("channel > link").filter((text) => text !== ""),
        titles: all("item > title"),
        links: all("item > link"),
        guids: all("item > guid"),
        descriptions: all("item > description"),
      };
    }, xml);
    expect(parsed.error).toBeNull();
    expect(parsed.root).toBe("rss");
    expect(parsed.language).toEqual([feed.language]);
    expect(parsed.channelLink).toEqual([feed.root]);
    expect(parsed.titles).toHaveLength(feed.items);
    expect(parsed.titles[0]).toBe(feed.first);
    for (const link of parsed.links) expect(link.startsWith(feed.root)).toBe(true);
    expect(parsed.guids).toEqual(parsed.links);
    // The hostile title and excerpt arrive as the characters they are.
    expect(parsed.titles.some((t) => t.includes("</script><script>alert("))).toBe(true);
    expect(parsed.descriptions.some((d) => d.includes("<img src=x onerror=alert("))).toBe(true);
  });
}

test("the sitemap lists posts, categories and authors, and leaves tags and page 2 out", async ({ request }) => {
  const sitemap = await (await request.get("/sitemap-0.xml")).text();
  for (const path of ["/blog/", "/pt/blog/", "/blog/how-this-blog-is-built/", "/pt/blog/como-este-blog-e-feito/", "/blog/category/product/", "/blog/author/ash-team/"]) {
    expect(sitemap, path).toContain(`<loc>${SITE}${path}</loc>`);
  }
  expect(sitemap).not.toMatch(/\/blog\/tag\//);
  expect(sitemap).not.toMatch(/\/blog\/(page|pagina)\//);
  expect(sitemap).not.toContain("rss.xml");
});
