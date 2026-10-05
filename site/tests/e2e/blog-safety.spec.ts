import { test, expect, type Page } from "@playwright/test";
import { requireFixtureBuild } from "./blog-build";

requireFixtureBuild();

// Two promises of the blog, against the fixture build: a page asks nothing of any other origin
// (decisions 3 and 10), and a plain-text field of the payload is never markup. The fixture's
// hostile posts put "</script><script>alert(...)", "\"><img src=x onerror=alert(...)>" and "<b>"
// in every field that is plain text: title, excerpt, tags, contents, author, bio, category, alt,
// meta title and meta description.

const PAGES = [
  "/blog/", "/blog/page/2/", "/blog/notes-on-writing-a-post/", "/blog/every-special-block-in-one-post/",
  "/blog/sample-escaping-test/", "/blog/category/sample-escaping/", "/blog/tag/script-alert-tag-script/",
  "/blog/author/sample-author/", "/pt/blog/", "/pt/blog/teste-de-escape/", "/pt/blog/como-este-blog-e-feito/",
];

for (const path of PAGES) {
  test(`${path} asks nothing of another origin, logs no error and does not overflow`, async ({ page, baseURL }) => {
    const origin = new URL(baseURL as string).origin;
    const foreign: string[] = [];
    const errors: string[] = [];
    page.on("request", (request) => {
      const url = new URL(request.url());
      if (url.protocol !== "data:" && url.origin !== origin) foreign.push(request.url());
    });
    page.on("pageerror", (e) => errors.push(String(e)));
    page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
    await page.goto(path);
    await expect(page.locator("h1")).toHaveCount(1);
    for (const width of [375, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      const over = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
      expect(over, `horizontal overflow at ${width}px`).toBe(false);
    }
    // Lazy images and the map only start when they come into view.
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForLoadState("networkidle");
    const broken = await page.evaluate(() => [...document.images].filter((img) => img.complete && img.naturalWidth === 0).map((img) => img.src));
    expect(broken).toEqual([]);
    expect(foreign).toEqual([]);
    expect(errors).toEqual([]);
  });
}

// Every payload in the fixture calls alert(): the trap records the call instead of opening a
// dialog, and a dialog that opens anyway fails the test too.
async function trap(page: Page): Promise<string[]> {
  const dialogs: string[] = [];
  page.on("dialog", async (dialog) => { dialogs.push(dialog.message()); await dialog.dismiss(); });
  await page.addInitScript(() => {
    const w = window as unknown as { __xss?: unknown; alert: (message?: unknown) => void };
    w.alert = (message) => { w.__xss = message ?? true; };
  });
  return dialogs;
}

// What a field that became markup would leave in the document.
const injected = (page: Page) => page.evaluate(() => ({
  xss: (window as unknown as { __xss?: unknown }).__xss,
  handlers: document.querySelectorAll("[onerror], [onload], [onclick]").length,
  // Only the post's own media and the site's built assets (the mascot in the header and footer)
  // may be images here; anything else came out of a hostile string, or from another origin.
  strayImages: [...document.images].filter((img) => {
    const url = new URL(img.currentSrc || img.src);
    return url.origin !== location.origin || !/^\/(blog-media|_astro)\//.test(url.pathname);
  }).length,
  refresh: document.querySelectorAll("meta[http-equiv]").length,
  scripts: [...document.scripts].filter((s) => s.type !== "application/ld+json" && /alert\s*\(/.test(s.textContent ?? "")).length,
  // <b> and <em> are in the fixture's strings; the pages checked with this have neither in their
  // own markup (only the money map does, and none of them draws it).
  bold: document.querySelectorAll("b, em").length,
}));
const CLEAN = { xss: undefined, handlers: 0, strayImages: 0, refresh: 0, scripts: 0, bold: 0 };

const HOSTILE = [
  {
    path: "/blog/sample-escaping-test/", contents: "On this page",
    title: 'Sample: escaping test </script><script>alert("title")</script> & "quotes" \'single\' <b>bold</b>',
    heading: "Escaping <script>alert(\"toc\")</script> & 'quotes'",
  },
  {
    path: "/pt/blog/teste-de-escape/", contents: "Nesta página",
    title: 'Exemplo: teste de escape </script><script>alert("título")</script> & "aspas" \'simples\' <b>negrito</b>',
    heading: "Escapando <script>alert(\"sumário\")</script> & 'aspas'",
  },
];

for (const { path, title, heading, contents } of HOSTILE) {
  test(`${path} renders every hostile field as text`, async ({ page }) => {
    const dialogs = await trap(page);
    await page.goto(path);
    const h1 = page.locator("h1");
    await expect(h1).toHaveText(title);
    expect(await h1.evaluate((el) => el.childElementCount)).toBe(0);

    const head = page.locator("main > article > header");
    await expect(head).toContainText("onerror=alert(");
    await expect(head).toContainText("</script>");
    expect(await head.evaluate((el) => el.querySelectorAll("b, em, img, script").length)).toBe(0);

    // The contents: the heading's text as characters, linked to the heading in the body.
    const entry = page.getByRole("navigation", { name: contents }).getByRole("link").first();
    await expect(entry).toHaveText(heading);
    expect(await entry.evaluate((el) => el.childElementCount)).toBe(0);
    const target = page.locator(`[data-post-body] h2${await entry.getAttribute("href")}`);
    await expect(target).toHaveText(heading);
    expect(await target.evaluate((el) => el.childElementCount)).toBe(0);

    // Tags, author and bio: the literal characters, and no element made of them.
    await expect(page.locator("ul.tags").getByRole("link").first()).toHaveText('<script>alert("tag")</script>');
    const author = page.locator("[data-author]");
    await expect(author).toContainText('Sample "><img src=x onerror=alert("author")> Author & Co');
    await expect(author).toContainText('</script><script>alert("bio")</script>');
    expect(await author.evaluate((el) => el.querySelectorAll("img, script, b").length)).toBe(0);

    // The document title and the description carry the meta fields, escaped.
    expect(await page.title()).toContain('</title><script>alert("meta")</script>');
    await expect(page.locator('meta[name="description"]')).toHaveAttribute("content", /<meta http-equiv=refresh content=0>/);

    // The structured data still parses and says what the post says.
    const blocks = await page.locator('script[type="application/ld+json"]').allTextContents();
    expect(blocks).toHaveLength(2);
    const [posting, crumbs] = blocks.map((text) => JSON.parse(text));
    expect(posting.headline).toBe(title);
    expect(posting.author.name).toBe('Sample "><img src=x onerror=alert("author")> Author & Co');
    expect(crumbs.itemListElement.at(-1).name).toBe(title);
    for (const text of blocks) expect(text).not.toMatch(/[<>]/);

    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForLoadState("networkidle");
    expect(await injected(page)).toEqual(CLEAN);
    expect(dialogs).toEqual([]);
  });
}

test("the hostile strings stay text in lists and on their own pages", async ({ page }) => {
  const dialogs = await trap(page);

  await page.goto("/blog/");
  const card = page.locator('article[data-post="sample-escaping-test"]');
  await expect(card.locator(".title")).toContainText('</script><script>alert("title")</script>');
  await expect(card).toContainText('onerror=alert("excerpt")');
  // The cover's alt is the author's text, in the attribute and nowhere else.
  await expect(card.locator("img")).toHaveAttribute("alt", "Sample cover \"><img src=x onerror=alert(\"alt\")> & 'alt'");
  await expect(page.getByRole("navigation", { name: "Categories" })).toContainText('Escaping test <b>bold</b> & "quotes" </script>');
  expect(await injected(page)).toEqual(CLEAN);

  await page.goto("/blog/category/sample-escaping/");
  await expect(page.locator("h1")).toHaveText('Escaping test <b>bold</b> & "quotes" </script>');
  expect(await injected(page)).toEqual(CLEAN);

  await page.goto("/blog/tag/script-alert-tag-script/");
  await expect(page.locator("h1")).toHaveText('<script>alert("tag")</script>');
  expect(await injected(page)).toEqual(CLEAN);

  await page.goto("/blog/tag/img-onerror-tag/");
  await expect(page.locator("h1")).toHaveText('"><img onerror> & tag');
  expect(await injected(page)).toEqual(CLEAN);

  await page.goto("/blog/author/sample-author/");
  await expect(page.locator("h1")).toHaveText('Sample "><img src=x onerror=alert("author")> Author & Co');
  expect(await page.locator("h1").evaluate((el) => el.childElementCount)).toBe(0);
  await expect(page.locator("main > header")).toContainText('Sample bio </script><script>alert("bio")</script> & "quotes" <b>bold</b>');
  expect(await injected(page)).toEqual(CLEAN);
  expect(dialogs).toEqual([]);
});
