import { test, expect, type Page } from "@playwright/test";
import { requireFixtureBuild } from "./blog-build";

// Runs against a build made with BLOG_SOURCE=fixture (tests/fixtures/blog-payload.json): 14 posts
// in English, 3 in Portuguese, one translated pair, one featured post that is not the newest.
// Languages, categories, tags and authors are in blog-lists.spec.ts; the head in blog-seo.spec.ts;
// the hostile posts and "nothing leaves the origin" in blog-safety.spec.ts; the search in
// blog-search.spec.ts; the builds with the blog off or half-empty in blog-modes.spec.ts.

requireFixtureBuild();

const cards = (page: Page) => page.locator("main article[data-post]");
const POST = "/blog/notes-on-writing-a-post/";

test.describe("blog index", () => {
  test("lists 12 posts with the featured one first, and page 2 has the rest", async ({ page }) => {
    await page.goto("/blog/");
    await expect(page.locator("h1")).toHaveText("Blog");
    await expect(cards(page)).toHaveCount(12);
    const first = cards(page).first();
    await expect(first).toHaveAttribute("data-post", "notes-on-writing-a-post");
    await expect(first).toContainText("Featured");
    // Newest first after the featured one.
    await expect(cards(page).nth(1)).toHaveAttribute("data-post", "how-this-blog-is-built");

    await page.getByRole("link", { name: /Older/ }).click();
    await expect(page).toHaveURL(/\/blog\/page\/2\/$/);
    await expect(cards(page)).toHaveCount(2);
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "noindex, follow");
    await expect(page.locator("link[hreflang]")).toHaveCount(0);
    await page.getByRole("link", { name: /Newer/ }).click();
    await expect(page).toHaveURL(/\/blog\/$/);
  });

  test("a card leads to its post and its category", async ({ page }) => {
    await page.goto("/blog/");
    const card = page.locator('article[data-post="how-the-search-works"]');
    await expect(card.getByRole("link", { name: "Engineering" })).toHaveAttribute("href", "/blog/category/engineering/");
    await card.getByRole("link", { name: "Sample: how the search works" }).click();
    await expect(page).toHaveURL(/\/blog\/how-the-search-works\/$/);
  });

  test("the header and the footer link to the blog, and the section links go back to the home", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("body > header").getByRole("link", { name: "Blog", exact: true })).toHaveAttribute("href", "/blog/");
    await expect(page.locator("footer").getByRole("link", { name: "Blog", exact: true })).toHaveAttribute("href", "/blog/");
    await expect(page.locator("body > header").getByRole("link", { name: "How it works" })).toHaveAttribute("href", "#how");
    await page.goto("/pt/blog/");
    await expect(page.locator("body > header").getByRole("link", { name: "Como funciona" })).toHaveAttribute("href", "/pt/#how");
    await expect(page.locator("footer").getByRole("link", { name: "Blog", exact: true })).toHaveAttribute("href", "/pt/blog/");
  });
});

test.describe("a post", () => {
  test("shows title, date, reading time, cover, body image, tags and related posts", async ({ page }) => {
    await page.goto(POST);
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await expect(page.locator("h1")).toHaveCount(1);
    await expect(page.locator("h1")).toHaveText("Sample: notes on writing a post");
    const head = page.locator("article > header");
    await expect(head.locator("time")).toHaveAttribute("datetime", "2026-09-24T13:00:00.000Z");
    await expect(head.locator("time")).toHaveText("September 24, 2026");
    await expect(head).toContainText("1 min read");
    await expect(head.getByRole("link", { name: "Ash team" })).toHaveAttribute("href", "/blog/author/ash-team/");

    // Both pictures come from this site's own copy and really load; the cover at once, the
    // body's picture when it comes near the screen.
    const cover = page.locator("main > article .cover img");
    const inBody = page.locator("[data-post-body] img");
    await expect(cover).toHaveAttribute("loading", "eager");
    await expect(inBody).toHaveAttribute("loading", "lazy");
    await expect(inBody).toHaveAttribute("decoding", "async");
    for (const img of [cover, inBody]) {
      await expect(img).toHaveAttribute("src", /^\/blog-media\/posts\//);
      await img.scrollIntoViewIfNeeded();
      await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0)).toBe(true);
    }
    await expect(cover).toHaveAttribute("alt", "Sample picture: a box with a dashed line above the lines that leave it");

    await expect(page.getByRole("list", { name: "Tags" }).getByRole("link", { name: "style guide" })).toHaveAttribute("href", "/blog/tag/style-guide/");
    await expect(page.locator(".related article[data-post]")).toHaveCount(3);
    await expect(page.locator('.related article[data-post="notes-on-writing-a-post"]')).toHaveCount(0);
  });

  test("every entry of the contents leads to a heading that stops below the sticky header", async ({ page }) => {
    await page.goto(POST);
    const toc = page.getByRole("navigation", { name: "On this page" }).getByRole("link");
    await expect(toc).toHaveCount(3);
    for (const href of await toc.evaluateAll((links) => links.map((a) => a.getAttribute("href") ?? ""))) {
      expect(href).toMatch(/^#[a-z0-9-]+$/);
      await expect(page.locator(`[data-post-body] :is(h2, h3)${href}`)).toHaveCount(1);
    }
    await toc.filter({ hasText: "What a post can hold" }).click();
    await expect(page).toHaveURL(/#what-a-post-can-hold$/);
    // Not merely "somewhere in the viewport": the heading's top is under the header's bottom, so
    // the header does not cover the line the reader jumped to.
    await expect.poll(() => page.evaluate(() => {
      const header = (document.querySelector("body > header") as HTMLElement).getBoundingClientRect();
      const heading = (document.getElementById("what-a-post-can-hold") as HTMLElement).getBoundingClientRect();
      return heading.top >= header.bottom && heading.top < window.innerHeight / 2;
    })).toBe(true);
  });

  test("a list in the body keeps its distance from what comes before it", async ({ page }) => {
    await page.goto(POST);
    const gaps = await page.evaluate(() => {
      const prose = document.querySelector("[data-post-body] .prose") as HTMLElement;
      const top = (selector: string) => Number.parseFloat(getComputedStyle(prose.querySelector(selector) as Element).marginTop);
      return {
        base: Number.parseFloat(getComputedStyle(prose).fontSize),
        afterParagraph: top("p + ul"), afterList: top("ul + ol"), afterHeading: top("h2 + ul"),
      };
    });
    // After a paragraph or another list: the gap any block gets (1.2em), the same a paragraph
    // gets after a paragraph. After a heading: the tighter one every block gets there.
    expect(gaps.afterParagraph).toBeCloseTo(gaps.base * 1.2, 0);
    expect(gaps.afterList).toBeCloseTo(gaps.base * 1.2, 0);
    expect(gaps.afterHeading).toBeCloseTo(gaps.base * 0.7, 0);
    expect(gaps.afterParagraph).toBeGreaterThan(12);
  });

  test("a post with no headings has no contents, and one that shares nothing has no related posts", async ({ page }) => {
    await page.goto("/blog/a-short-post/");
    await expect(page.locator("h1")).toHaveText("Sample: a short post");
    await expect(page.getByRole("navigation", { name: "On this page" })).toHaveCount(0);
    await page.goto("/blog/sample-escaping-test/");
    await expect(page.locator("h1")).toBeVisible();
    await expect(page.locator(".related")).toHaveCount(0);
  });

  test("renders the special blocks and leaves no marker and no empty box behind", async ({ page }) => {
    await page.goto("/blog/every-special-block-in-one-post/");
    const body = page.locator("[data-post-body]");
    await expect(body).not.toContainText("{{");
    await expect(body.locator('[data-shortcode="mapa"] [data-flow]')).toBeVisible();
    await expect(body.locator('[data-shortcode="cta:pitch"]').getByRole("link", { name: "See the pitch" })).toHaveAttribute("href", "/pitch/");
    // The newsletter block renders nothing until the newsletter exists. The contact card depends
    // on what the build was configured with: blog-modes.spec.ts builds with a channel and
    // without one and checks each outcome. What holds for any build is asserted here.
    await expect(body.locator('[data-shortcode="cta:newsletter"]')).toHaveCount(0);
    const blocks = body.locator("[data-shortcode]");
    const names = await blocks.evaluateAll((els) => els.map((el) => el.getAttribute("data-shortcode")));
    expect(names.filter((name) => name !== "cta:contato")).toEqual(["mapa", "cta:pitch"]);
    expect(names.filter((name) => name === "cta:contato").length).toBeLessThanOrEqual(1);
    for (const height of await blocks.evaluateAll((els) => els.map((el) => el.getBoundingClientRect().height))) expect(height).toBeGreaterThan(60);
    const cards = body.locator('[data-shortcode^="cta:"]');
    for (const links of await cards.evaluateAll((els) => els.map((el) => [...el.querySelectorAll("a")].map((a) => a.getAttribute("href") ?? "")))) {
      expect(links.length).toBeGreaterThan(0);
      for (const href of links) expect(href).toMatch(/^(\/pitch\/|https:\/\/|mailto:)/);
    }
    await expect(body.locator("h2")).toHaveText(["The map", "The pitch", "Talk to us"]);
  });

  test("copy link puts the post's address on the clipboard, and every share target is big enough to tap", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.goto("/blog/a-short-post/");
    // By attribute: the button's name changes when it is pressed.
    const button = page.locator("button[data-copy-link]");
    await expect(button).toHaveText("Copy link");
    const sizes = await page.locator(".share a, .share button").evaluateAll((els) => els.map((el) => { const r = el.getBoundingClientRect(); return [r.width, r.height]; }));
    expect(sizes).toHaveLength(5);
    for (const [width, height] of sizes) { expect(width).toBeGreaterThanOrEqual(24); expect(height).toBeGreaterThanOrEqual(24); }
    await button.click();
    await expect(button).toHaveText("Copied");
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("https://ash.app.br/blog/a-short-post/");
    await expect(page.locator('[data-share="linkedin"]')).toHaveAttribute("href", /^https:\/\/www\.linkedin\.com\/sharing\/share-offsite\/\?url=https%3A%2F%2Fash\.app\.br%2Fblog%2Fa-short-post%2F$/);
  });

  test("prints as dark text on white, the article without the site around it", async ({ page }) => {
    await page.goto(POST);
    await page.emulateMedia({ media: "print" });
    const printed = await page.evaluate(() => {
      // Drawn at all: hidden itself or inside something hidden, an element has no box.
      const shown = (selector: string) => [...document.querySelectorAll(selector)].some((el) => el.getClientRects().length > 0);
      return {
        background: getComputedStyle(document.body).backgroundColor,
        text: getComputedStyle(document.querySelector("[data-post-body] p") as Element).color,
        title: getComputedStyle(document.querySelector("h1") as Element).color,
        stillShown: ["body > header", "body > footer", "main aside", ".share", ".related", ".crumb"].filter(shown),
        body: shown("[data-post-body]"),
      };
    });
    expect(printed).toEqual({ background: "rgb(255, 255, 255)", text: "rgb(0, 0, 0)", title: "rgb(0, 0, 0)", stillShown: [], body: true });
  });
});
