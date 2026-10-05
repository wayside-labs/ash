import { test, expect } from "@playwright/test";

for (const path of ["/", "/pt/", "/privacy/", "/pt/privacidade/"]) {
  test(`${path} renders with no console errors and no horizontal overflow`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
    await page.goto(path);
    await expect(page.locator("h1")).toBeVisible();
    for (const width of [375, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      const over = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
      expect(over, `horizontal overflow at ${width}px`).toBe(false);
    }
    expect(errors).toEqual([]);
  });
}

test("language switch lands on the Portuguese home and back", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: "PT", exact: true }).click();
  await expect(page).toHaveURL(/\/pt\/?$/);
  await expect(page.locator("h1")).toContainText("Solte seus agentes na Solana");
  await page.getByRole("link", { name: "EN", exact: true }).click();
  await expect(page.locator("h1")).toContainText("Unleash your agents on Solana");
});

test("the hero shows the mascot, and 'run a payment' moves the first agent's budget", async ({ page }) => {
  await page.goto("/");
  // The mascot is the hero's picture now (the money map lives in the pitch and the blog block).
  const robot = page.locator(".hero img");
  await expect(robot).toBeVisible();
  expect(await robot.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);
  await expect(page.locator(".hero [data-flow]")).toHaveCount(0);

  const demo = page.locator("#demo");
  await expect(demo.locator("article")).toHaveCount(3);
  const left = demo.locator("[data-sim] [data-sim-left]");
  const spent = demo.locator("[data-sim-spent]");
  await expect(left).toHaveText("55.00");
  await expect(spent).toHaveText("45.00");
  await demo.getByRole("button", { name: "run a payment" }).click();
  await expect(left).toHaveText("50.00");
  await expect(spent).toHaveText("50.00");
  await expect(demo.locator("[data-sim] [data-sim-times]")).toHaveText("×2");
  // Four payments, then the fifth click starts over.
  for (let i = 0; i < 4; i++) await demo.getByRole("button", { name: "run a payment" }).click();
  await expect(left).toHaveText("55.00");
});

test("reduced motion shows the final state without animation", async ({ browser }) => {
  const ctx = await browser.newContext({ reducedMotion: "reduce" });
  const page = await ctx.newPage();
  await page.goto("/");
  const opacity = await page.locator("[data-reveal]").last().evaluate((el) => getComputedStyle(el).opacity);
  expect(opacity).toBe("1");
  await ctx.close();
});

test("every page declares canonical, hreflang and open graph", async ({ page }) => {
  await page.goto("/pt/");
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", "https://ash.app.br/pt/");
  await expect(page.locator('link[hreflang="en"]')).toHaveAttribute("href", "https://ash.app.br/");
  await expect(page.locator('meta[property="og:image"]')).toHaveAttribute("content", "https://ash.app.br/og.png");
});

// Every page of the site that existed before the blog. What a page advertises must exist: the
// privacy pair used to point hreflang at /pt/privacy/ and /privacidade/, which are 404s, and its
// header linked to sections that only the home has.
const PAGES = ["/", "/pt/", "/privacy/", "/pt/privacidade/", "/pitch/", "/pt/pitch/", "/investor/", "/pt/investidor/"];
const SITE = "https://ash.app.br";

for (const path of PAGES) {
  test(`${path}: every hreflang target, in-page anchor and local link leads somewhere`, async ({ page, request }) => {
    await page.goto(path);
    const links = await page.evaluate(() => ({
      alternates: [...document.querySelectorAll<HTMLLinkElement>("link[rel=alternate][hreflang]")].map((l) => l.getAttribute("href") ?? ""),
      canonical: document.querySelector<HTMLLinkElement>("link[rel=canonical]")?.getAttribute("href") ?? "",
      hrefs: [...document.querySelectorAll<HTMLAnchorElement>("a[href]")].map((a) => a.getAttribute("href") ?? ""),
    }));
    expect(links.canonical).toBe(`${SITE}${path}`);
    expect(links.alternates.length).toBe(2);
    for (const href of links.alternates) {
      expect(href.startsWith(`${SITE}/`)).toBe(true);
      expect((await request.get(href.slice(SITE.length))).status(), href).toBe(200);
    }

    // "#id" must be on this page; "/path/#id" must be a page that has the id; "/path/" must exist.
    const seen = new Map<string, string>();
    const html = async (target: string): Promise<string> => {
      if (!seen.has(target)) {
        const res = await request.get(target);
        expect(res.status(), target).toBe(200);
        seen.set(target, await res.text());
      }
      return seen.get(target) as string;
    };
    for (const href of new Set(links.hrefs)) {
      if (href.startsWith("#")) {
        expect(await page.locator(`[id="${href.slice(1)}"]`).count(), `${href} on ${path}`).toBe(1);
      } else if (href.startsWith("/") && !href.startsWith("//")) {
        const [target, id] = href.split("#") as [string, string | undefined];
        const body = await html(target);
        if (id) expect(body.includes(` id="${id}"`), `${href} from ${path}`).toBe(true);
      }
    }
  });
}

test("the skip link is the first stop of the keyboard and leads to the page's main", async ({ page }) => {
  for (const [path, label] of [["/", "Skip to content"], ["/pt/privacidade/", "Pular para o conteúdo"], ["/pitch/", "Skip to content"]] as const) {
    await page.goto(path);
    await page.keyboard.press("Tab");
    const skip = page.getByRole("link", { name: label });
    await expect(skip).toBeFocused();
    await expect(skip).toBeInViewport();
    await expect(skip).toHaveAttribute("href", "#main");
    await expect(page.locator("main#main")).toHaveCount(1);
  }
});

test("the header's section label is in the page's language, and the privacy pages switch to each other", async ({ page }) => {
  await page.goto("/pt/privacidade/");
  await expect(page.getByRole("navigation", { name: "Seções" })).toHaveCount(1);
  await expect(page.locator('link[hreflang="en"]')).toHaveAttribute("href", `${SITE}/privacy/`);
  await expect(page.locator("body > header").getByRole("link", { name: "Como funciona" })).toHaveAttribute("href", "/pt/#how");
  await page.getByRole("link", { name: "EN", exact: true }).click();
  await expect(page).toHaveURL(/\/privacy\/$/);
  await expect(page.getByRole("navigation", { name: "Sections" })).toHaveCount(1);
  await expect(page.locator('link[hreflang="pt-BR"]')).toHaveAttribute("href", `${SITE}/pt/privacidade/`);
});

// With the blog on the header has a fifth link. On a tablet in portrait (768) the labels used to
// break onto two lines; they must stay on one, in both languages, without pushing the page wide.
for (const path of ["/", "/pt/", "/blog/", "/pt/blog/"]) {
  test(`${path}: the header's links stay on one line at 768, 800 and 900 px`, async ({ page }) => {
    for (const width of [768, 800, 900]) {
      await page.setViewportSize({ width, height: 900 });
      const response = await page.goto(path);
      test.skip(response?.status() === 404, "dist/ was built without the blog");
      const nav = page.locator("body > header nav a");
      const lines = await nav.evaluateAll((links) => links.map((a) => ({ text: a.textContent, rects: a.getClientRects().length, height: a.getBoundingClientRect().height, line: Number.parseFloat(getComputedStyle(a).lineHeight) })));
      expect(lines.length).toBeGreaterThanOrEqual(4);
      for (const link of lines) {
        expect(link.rects, `${link.text} at ${width}`).toBe(1);
        expect(link.height, `${link.text} at ${width}`).toBeLessThan(link.line * 1.5);
      }
      const row = await page.locator("body > header .nav").evaluate((el) => ({ inner: el.scrollWidth, outer: el.clientWidth }));
      expect(row.inner, `header row at ${width}`).toBeLessThanOrEqual(row.outer);
      expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false);
    }
  });
}
