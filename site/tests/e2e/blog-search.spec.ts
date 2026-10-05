import { test, expect, type Page } from "@playwright/test";
import { requireFixtureBuild } from "./blog-build";

// The search box of the two blog indexes, against the fixture build. The index is Pagefind's,
// written under /pagefind/ after the build; the box and its behaviour are the site's own.

requireFixtureBuild();

const box = (page: Page) => page.getByRole("searchbox");
const results = (page: Page) => page.locator("[data-search-results] a");
const status = (page: Page) => page.locator("[data-search-status]");

// Every request the page makes for the search, as paths.
function searchRequests(page: Page): string[] {
  const seen: string[] = [];
  page.on("request", (request) => { const url = new URL(request.url()); if (url.pathname.startsWith("/pagefind/")) seen.push(url.pathname); });
  return seen;
}

test("nothing of the search is loaded until the field is used, and then only from this site", async ({ page, baseURL }) => {
  const asked = searchRequests(page);
  const foreign: string[] = [];
  page.on("request", (request) => { if (new URL(request.url()).origin !== new URL(baseURL as string).origin) foreign.push(request.url()); });
  await page.goto("/blog/");
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForLoadState("networkidle");
  expect(asked).toEqual([]);
  expect(await page.locator('script[src*="pagefind"], link[href*="pagefind"]').count()).toBe(0);

  await box(page).focus();
  await expect(status(page)).toHaveText("Type a word to search the posts.");
  await expect.poll(() => asked.includes("/pagefind/pagefind.js")).toBe(true);
  await box(page).fill("menus");
  await expect(results(page).first()).toBeVisible();
  // Pagefind's own interface (script and stylesheet) is never asked for: it is not even shipped.
  expect(asked.filter((path) => /pagefind-(ui|modular-ui|component-ui|highlight)/.test(path))).toEqual([]);
  for (const file of ["pagefind-ui.css", "pagefind-ui.js", "pagefind-component-ui.css", "pagefind-modular-ui.css"]) {
    expect((await page.request.get(`/pagefind/${file}`)).status(), file).toBe(404);
  }
  expect(foreign).toEqual([]);
});

test("typing a word lists the posts that have it, with the title, an excerpt and the word marked", async ({ page }) => {
  await page.goto("/blog/");
  await box(page).fill("menus");
  await expect(results(page)).toHaveCount(1);
  const first = results(page).first();
  await expect(first).toHaveAttribute("href", "/blog/how-the-search-works/");
  await expect(first.locator(".t")).toHaveText("Sample: how the search works");
  await expect(first.locator(".e mark").first()).toHaveText(/menus/i);
  // The words around the mark keep their spaces.
  await expect(first.locator(".e")).toContainText("Lists, menus and the footer stay out.");
  // The status line says how many there are: it is what a screen reader announces.
  await expect(status(page)).toHaveAttribute("role", "status");
  await expect(status(page)).toHaveText("1 result");
  await box(page).fill("post");
  await expect(status(page)).toHaveText(/^\d+ results$/);
  expect(await status(page).textContent()).toBe(`${await results(page).count()} results`);

  await box(page).fill("zzzzqqq");
  await expect(status(page)).toHaveText("No post matches “zzzzqqq”.");
  await expect(results(page)).toHaveCount(0);
  await box(page).fill("");
  await expect(status(page)).toHaveText("Type a word to search the posts.");
});

test("a load that failed is tried again on the next keystroke, without reloading the page", async ({ page }) => {
  let refused = 0;
  await page.route("**/pagefind/pagefind.js*", async (route) => {
    // The first request fails: the one made on focus, which the first keystroke also waits on.
    if (refused < 1) { refused += 1; await route.fulfill({ status: 404, body: "not found" }); return; }
    await route.continue();
  });
  await page.goto("/blog/");
  await box(page).fill("menus");
  await expect(status(page)).toHaveText("Search is not available right now.");
  await expect(results(page)).toHaveCount(0);
  await box(page).fill("menus and");
  await expect(results(page).first()).toHaveAttribute("href", "/blog/how-the-search-works/");
  await expect(status(page)).toHaveText("1 result");
  expect(refused).toBe(1);
});

test("arrows move through the results, and Enter opens the first one", async ({ page }) => {
  await page.goto("/blog/");
  await box(page).fill("post");
  await expect.poll(() => results(page).count()).toBeGreaterThan(2);
  await box(page).press("ArrowDown");
  await expect(results(page).nth(0)).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(results(page).nth(1)).toBeFocused();
  await page.keyboard.press("ArrowUp");
  await expect(results(page).nth(0)).toBeFocused();
  await page.keyboard.press("ArrowUp");
  await expect(box(page)).toBeFocused();
  // Escape from a result clears the field and goes back to it.
  await box(page).press("ArrowDown");
  await page.keyboard.press("Escape");
  await expect(box(page)).toBeFocused();
  await expect(box(page)).toHaveValue("");
  await expect(results(page)).toHaveCount(0);

  await box(page).fill("menus");
  await expect(results(page).first()).toHaveAttribute("href", "/blog/how-the-search-works/");
  await box(page).press("Enter");
  await expect(page).toHaveURL(/\/blog\/how-the-search-works\/$/);
  await expect(page.locator("h1")).toHaveText("Sample: how the search works");
});

test("each blog searches its own language", async ({ page }) => {
  await page.goto("/pt/blog/");
  await expect(box(page)).toHaveAttribute("placeholder", "Buscar posts");
  await box(page).fill("parágrafos");
  await expect(results(page).first()).toBeVisible();
  expect(await results(page).evaluateAll((links) => links.map((a) => a.getAttribute("href") ?? ""))).toEqual(["/pt/blog/um-post-curto/"]);
  await expect(status(page)).toHaveText("1 resultado");
  // A word only the English posts have finds nothing here, and says so in Portuguese.
  await box(page).fill("menus");
  await expect(status(page)).toHaveText("Nenhum post corresponde a “menus”.");
  await expect(results(page)).toHaveCount(0);

  await page.goto("/blog/");
  await box(page).fill("parágrafos");
  await expect(status(page)).toHaveText("No post matches “parágrafos”.");
  await box(page).fill("paragraphs");
  await expect(results(page).first()).toBeVisible();
  expect(await results(page).evaluateAll((links) => links.map((a) => a.getAttribute("href") ?? ""))).toEqual(["/blog/a-short-post/"]);
});

test("a hostile title and excerpt come back from the index as text", async ({ page }) => {
  const dialogs: string[] = [];
  page.on("dialog", async (dialog) => { dialogs.push(dialog.message()); await dialog.dismiss(); });
  await page.addInitScript(() => {
    const w = window as unknown as { __xss?: unknown; alert: (message?: unknown) => void };
    w.alert = (message) => { w.__xss = message ?? true; };
  });
  await page.goto("/blog/");
  await box(page).fill("escaping");
  const hit = results(page).first();
  await expect(hit).toHaveAttribute("href", "/blog/sample-escaping-test/");
  await expect(hit.locator(".t")).toHaveText('Sample: escaping test </script><script>alert("title")</script> & "quotes" \'single\' <b>bold</b>');
  await expect(hit.locator(".e")).toContainText('<img src=x onerror=alert("excerpt")>');
  const made = await page.locator("[data-search-results]").evaluate((list) => ({
    inTitle: [...list.querySelectorAll(".t")].reduce((n, el) => n + el.childElementCount, 0),
    notMarks: list.querySelectorAll(".e *:not(mark)").length,
    dangerous: list.querySelectorAll("img, script, b, em, iframe, [onerror]").length,
    xss: (window as unknown as { __xss?: unknown }).__xss,
  }));
  expect(made).toEqual({ inTitle: 0, notMarks: 0, dangerous: 0, xss: undefined });
  expect(dialogs).toEqual([]);
});

test("the search fits a phone, and only the first page of an index has it", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto("/blog/");
  await box(page).fill("post");
  await expect(results(page).first()).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false);
  const width = await page.locator("[data-search-results]").evaluate((el) => el.getBoundingClientRect().width);
  expect(width).toBeLessThanOrEqual(375 - 2 * 24);
  for (const path of ["/blog/page/2/", "/blog/category/product/", "/blog/tag/writing/", "/blog/author/ash-team/", "/blog/a-short-post/"]) {
    await page.goto(path);
    await expect(page.getByRole("searchbox")).toHaveCount(0);
  }
});
