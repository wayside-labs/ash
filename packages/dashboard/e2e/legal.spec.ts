import { expect, stubChain, stubChat, stubWallet, t, test } from "./fixtures";

/**
 * The pages OpenRouter's flow-down (§5.2) and Anthropic's terms oblige us to publish. The
 * hosted redirect for signed-out visitors is covered by `sign-in-gate.test.ts`: this suite runs
 * in local JSON mode, so it proves the pages render, say the required things and are linked.
 */
test.describe("legal pages", () => {
  for (const { path, title, mustSay } of [
    {
      path: "/terms",
      title: "Terms of Service",
      mustSay: [/competing AI model/, /resell/, /Anthropic’s Commercial Terms/, /Usage Policy/],
    },
    {
      path: "/privacy",
      title: "Privacy Policy",
      mustSay: [/OpenRouter/, /Anthropic/],
    },
  ]) {
    test(`${path} renders for a visitor with no session and no error`, async ({ page }) => {
      const problems: string[] = [];
      page.on("console", (m) => m.type() === "error" && problems.push(m.text()));
      page.on("pageerror", (e) => problems.push(String(e)));

      const response = await page.goto(path);
      expect(response?.status()).toBeLessThan(400);
      expect(new URL(page.url()).pathname).toBe(path);
      await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();
      for (const phrase of mustSay) await expect(page.locator("article")).toContainText(phrase);
      // No sidebar: these pages sit outside the dashboard shell.
      await expect(page.getByRole("link", { name: t("nav.treasury") })).toHaveCount(0);
      expect(problems).toEqual([]);
    });
  }

  test("the dashboard footer links to both", async ({ page }) => {
    await stubChain(page);
    await stubChat(page);
    await stubWallet(page);
    await page.goto("/treasury");
    const footer = page.locator("footer");
    await expect(footer.getByRole("link", { name: t("legal.terms.link") })).toHaveAttribute(
      "href",
      "/terms",
    );
    await expect(footer.getByRole("link", { name: t("legal.privacy.link") })).toHaveAttribute(
      "href",
      "/privacy",
    );
  });
});
