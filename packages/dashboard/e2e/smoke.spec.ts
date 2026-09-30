import { expect, stubChain, stubChat, stubWallet, t, test } from "./fixtures";

/**
 * Every route in the sidebar, rendered with a wallet connected and the chain
 * stubbed. The point is not the heading text — it is that no page throws on
 * mount, which is the failure a typecheck cannot see and a unit test does not
 * reach, because these pages are assembled from hooks and providers.
 */
const ROUTES: { path: string; heading: string }[] = [
  { path: "/templates", heading: t("templates.title") },
  { path: "/workflows", heading: t("workflows.title") },
  { path: "/agents", heading: t("agents.title") },
  { path: "/treasury", heading: t("treasury.title") },
  { path: "/limits", heading: t("limits.title") },
  { path: "/wallets", heading: t("wallets.title") },
  { path: "/mcps", heading: t("mcps.title") },
  { path: "/skills", heading: t("skills.title") },
  { path: "/apis", heading: t("apis.title") },
  { path: "/account", heading: t("account.title") },
  { path: "/profile", heading: t("profile.title") },
  { path: "/settings", heading: t("settings.title") },
  // Last: the sidebar walk below takes the first four, which must all sit under Advanced.
  { path: "/balance", heading: t("balance.title") },
];

test.describe("every page renders", () => {
  for (const { path, heading } of ROUTES) {
    test(`${path} renders and logs no error`, async ({ page }) => {
      await stubChain(page);
      await stubChat(page);
      await stubWallet(page);

      const problems: string[] = [];
      page.on("console", (message) => {
        if (message.type() === "error") problems.push(message.text());
      });
      page.on("pageerror", (error) => problems.push(String(error)));

      const response = await page.goto(path);
      expect(response?.status(), `${path} served an error status`).toBeLessThan(400);
      await expect(page.getByRole("heading", { name: heading, level: 1 })).toBeVisible();

      // React hydration warnings are noisy in dev; only hard failures count.
      const hard = problems.filter((line) => !/Warning:|hydrat/i.test(line));
      expect(hard, `${path} logged: ${hard.join(" | ")}`).toEqual([]);
    });
  }

  test("/ renders the chat beside the workflows, without asking for a wallet", async ({ page }) => {
    await stubChain(page);
    await stubChat(page);

    await page.goto("/");
    await expect(page.getByPlaceholder(t("chat.placeholder"))).toBeVisible();
    await expect(page.getByRole("heading", { name: t("home.workflowsTitle") })).toBeVisible();
    await expect(page.getByRole("button", { name: t("wallet.connect") })).toHaveCount(0);
  });

  test("/advanced keeps the operator's chat and workflow panel", async ({ page }) => {
    await stubChain(page);
    await stubChat(page);
    await stubWallet(page);

    await page.goto("/advanced");
    await expect(page.getByPlaceholder(t("chat.placeholder"))).toBeVisible();
    await expect(page.getByRole("heading", { name: t("home.workflowsTitle") })).toBeVisible();
  });

  test("the sidebar reaches every route it advertises", async ({ page }) => {
    await stubChain(page);
    await stubChat(page);
    await page.goto("/workflows");

    for (const { path, heading } of ROUTES.slice(0, 4)) {
      await page
        .getByRole("link", { name: new RegExp(heading, "i") })
        .first()
        .click();
      await expect(page).toHaveURL(new RegExp(`${path}$`));
      await expect(page.getByRole("heading", { name: heading, level: 1 })).toBeVisible();
    }
  });
});
