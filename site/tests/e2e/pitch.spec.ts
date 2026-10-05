import { test, expect, type Page } from "@playwright/test";

const slideTexts = (page: Page) => page.locator("[data-slide] .line").allTextContents();

test.describe("pitch deck", () => {
  test("moves by keyboard, jumps by hash and stops at the ends", async ({ page }) => {
    await page.goto("/pitch/");
    const count = page.locator("[data-count]");
    await expect(count).toHaveText("1 / 18");
    await page.keyboard.press("ArrowRight");
    await expect(count).toHaveText("2 / 18");
    await expect(page).toHaveURL(/#2$/);
    await page.keyboard.press("End");
    await expect(count).toHaveText("18 / 18");
    await page.keyboard.press("ArrowRight");
    await expect(count).toHaveText("18 / 18");
    await page.goto("/pitch/#4");
    await expect(page.locator("[data-slide].is-active .line")).toHaveText("Unleash your agents on Solana. Full autonomy, on your terms.");
  });

  test("notes toggle with N", async ({ page }) => {
    await page.goto("/pt/pitch/");
    await expect(page.locator("[data-slide].is-active [data-notes]")).toBeHidden();
    await page.keyboard.press("n");
    await expect(page.locator("[data-slide].is-active [data-notes]")).toBeVisible();
  });

  for (const path of ["/pitch/", "/pt/pitch/", "/investor/", "/pt/investidor/"]) {
    test(`${path} is noindex, out of the sitemap and does not overflow on a phone`, async ({ page, request }) => {
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(String(e)));
      await page.setViewportSize({ width: 375, height: 800 });
      await page.goto(path);
      await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "noindex, nofollow");
      const over = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
      expect(over).toBe(false);
      expect(errors).toEqual([]);
      const sitemap = await (await request.get("/sitemap-0.xml")).text();
      expect(sitemap).not.toContain(path.replace(/\/$/, ""));
    });
  }
});

test.describe("investor funnel", () => {
  test("shows exactly the slides of the official pitch, in both languages", async ({ page }) => {
    for (const [pitch, investor] of [["/pitch/", "/investor/"], ["/pt/pitch/", "/pt/investidor/"]] as const) {
      await page.goto(pitch);
      const official = await slideTexts(page);
      await page.goto(investor);
      expect(await slideTexts(page)).toEqual(official);
      expect(official).toHaveLength(18);
    }
  });

  test("blocks the deck until the form is sent, then greets by first name", async ({ page }) => {
    let sent: Record<string, unknown> | undefined;
    await page.route("**/api/lead", async (route) => {
      sent = route.request().postDataJSON() as Record<string, unknown>;
      await route.fulfill({ status: 200, contentType: "application/json", body: '{"ok":true}' });
    });
    await page.goto("/investor/");
    await expect(page.locator("[data-gate]")).toBeVisible();
    await expect(page.locator("[data-deck]")).toBeHidden();

    await page.getByRole("textbox", { name: "Name", exact: true }).fill("Ana Souza");
    await page.getByRole("textbox", { name: "Role", exact: true }).fill("Partner");
    await page.getByLabel("An investor").check();
    await page.getByRole("textbox", { name: "E-mail", exact: true }).fill("ana@exemplo.com");
    await page.getByRole("button", { name: "Open the pitch" }).click();
    await expect(page.locator('[data-err="consent"]')).toBeVisible();
    expect(sent).toBeUndefined();

    await page.locator('input[name="consent"]').check();
    await page.getByRole("button", { name: "Open the pitch" }).click();
    await expect(page.locator("[data-hi-text]")).toHaveText("Hi, Ana.");
    expect(sent).toMatchObject({ name: "Ana Souza", role: "Partner", kind: "investor", email: "ana@exemplo.com", lang: "en", consent: true });

    await page.getByRole("button", { name: "See the pitch" }).click();
    await expect(page.locator("[data-deck]")).toBeVisible();
    await expect(page.locator("[data-count]")).toHaveText("1 / 18");

    // Coming back skips the form; the browser kept the name and kind, never the e-mail.
    await page.goto("/investor/");
    await expect(page.locator("[data-gate]")).toBeHidden();
    await expect(page.locator("[data-hi-text]")).toHaveText("Welcome back, Ana.");
    const stored = await page.evaluate(() => localStorage.getItem("ash.visitor"));
    expect(stored).not.toContain("@");
  });

  async function fillPt(page: Page) {
    await page.goto("/pt/investidor/");
    await page.getByRole("textbox", { name: "Nome", exact: true }).fill("Ana");
    await page.getByRole("textbox", { name: "Cargo", exact: true }).fill("CFO");
    await page.getByLabel("Empreendedor ou operador").check();
    await page.getByRole("textbox", { name: "E-mail", exact: true }).fill("ana@exemplo.com");
    await page.locator('input[name="consent"]').check();
    await page.getByRole("button", { name: "Abrir o pitch" }).click();
  }

  test("a server failure reads as a retry, not as the visitor's mistake", async ({ page }) => {
    await page.route("**/api/lead", (route) => route.fulfill({ status: 500, contentType: "application/json", body: '{"ok":false}' }));
    await fillPt(page);
    await expect(page.locator('[data-err="network"]')).toBeVisible();
    await expect(page.locator("[data-gate]")).toBeVisible();
  });

  test("past the last slide, the investor gets a thank-you by name and can replay", async ({ page }) => {
    await page.route("**/api/lead", (route) => route.fulfill({ status: 200, contentType: "application/json", body: '{"ok":true,"ref":"0b8e6f2a-3c1d-4e5f-9a7b-1c2d3e4f5a6b"}' }));
    await fillPt(page);
    await page.getByRole("button", { name: "Ver o pitch" }).click();
    await page.keyboard.press("End");
    await expect(page.locator("[data-count]")).toHaveText("18 / 18");
    await page.keyboard.press("ArrowRight");
    await expect(page.locator("[data-thanks-text]")).toHaveText("Obrigado pela leitura, Ana.");
    await expect(page.locator("[data-deck]")).toBeHidden();
    expect(await page.evaluate(() => localStorage.getItem("ash.visitor"))).toContain("0b8e6f2a");
    await page.getByRole("button", { name: /Rever o pitch/ }).click();
    await expect(page.locator("[data-deck]")).toBeVisible();
    await expect(page.locator("[data-count]")).toHaveText("1 / 18");
  });

  test("the open /pitch just stays on the last slide", async ({ page }) => {
    await page.goto("/pitch/#18");
    await page.keyboard.press("ArrowRight");
    await expect(page.locator("[data-count]")).toHaveText("18 / 18");
    await expect(page.locator("[data-deck]")).toBeVisible();
  });

  // Regression, 30/09: with collection switched off (503 unavailable) the form trapped the
  // visitor behind "try again". The lock is ours; the visitor still gets the pitch.
  test("with collection switched off, the visitor still reaches the pitch", async ({ page }) => {
    await page.route("**/api/lead", (route) => route.fulfill({ status: 503, contentType: "application/json", body: '{"ok":false,"errors":["unavailable"]}' }));
    await fillPt(page);
    await expect(page.locator("[data-hi-text]")).toHaveText("Olá, Ana.");
    await page.getByRole("button", { name: "Ver o pitch" }).click();
    await expect(page.locator("[data-deck]")).toBeVisible();
  });
});
