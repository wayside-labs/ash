import { expect, stubChain, stubWallet, t, test } from "./fixtures";

const EARN = t("templates.builtin.earnBountyHunter.name");
const DCA = t("templates.builtin.dcaSol.name");
const WORKSTATION = t("templates.builtin.solanaWorkstation.name");
const CLOAK = t("templates.builtin.cloakPrivatePayout.name");

/**
 * The templates workspace: a builder canvas with the menu on the right (the default), and the
 * card gallery behind a toggle. Nothing here writes to the store, so it needs no chain beyond
 * the stub every page already gets.
 */
test.describe("templates", () => {
  test.beforeEach(async ({ page }) => {
    await stubChain(page);
    await stubWallet(page);
  });

  const builderTitle = (page: import("@playwright/test").Page) =>
    page.getByTestId("template-builder-title");

  test("opens as a builder with the template list on the right", async ({ page }) => {
    await page.goto("/templates");

    await expect(builderTitle(page)).toContainText(EARN);
    const canvas = page.getByLabel(t("templates.builder.canvasLabel"));
    await expect(canvas).toBeVisible();
    // The Earn starter's three agents are real nodes, not a screenshot.
    await expect(canvas.getByText("Builder", { exact: true })).toBeVisible();
    await expect(canvas.getByText("RPC credits")).toBeVisible();

    const menu = page.getByRole("complementary", { name: t("templates.title") });
    const [canvasBox, menuBox] = await Promise.all([canvas.boundingBox(), menu.boundingBox()]);
    expect(menuBox?.x).toBeGreaterThan((canvasBox?.x ?? 0) + (canvasBox?.width ?? 0) - 2);
  });

  test("picking a row swaps the canvas and puts the template in the URL", async ({ page }) => {
    await page.goto("/templates");
    await page.getByTestId("template-row").filter({ hasText: WORKSTATION }).click();

    await expect(builderTitle(page)).toContainText(WORKSTATION);
    await expect(page).toHaveURL(/[?&]t=builtin%3Asolana-workstation/);
    // Workflow-scoped tools show up because applying this starter creates them.
    await expect(
      page.getByLabel(t("templates.builder.canvasLabel")).getByText("Solana Jupiter"),
    ).toBeVisible();

    await page.reload();
    await expect(builderTitle(page)).toContainText(WORKSTATION);
  });

  test("a node opens its inspector", async ({ page }) => {
    await page.goto("/templates");
    await page
      .getByLabel(t("templates.builder.canvasLabel"))
      .getByText("Builder", { exact: true })
      .click();
    await expect(page.getByTestId("template-inspector")).toContainText(
      t("templates.builder.cap", { amount: 50 }),
    );
  });

  test("search narrows the list", async ({ page }) => {
    await page.goto("/templates");
    await page.getByLabel(t("templates.panel.search")).fill("dca");
    await expect(page.getByTestId("template-row")).toHaveCount(1);
    await expect(page.getByTestId("template-row")).toContainText(DCA);

    await page.getByLabel(t("templates.panel.search")).fill("zzzz-nothing");
    await expect(
      page.getByText(t("templates.panel.noMatches", { query: "zzzz-nothing" })),
    ).toBeVisible();
  });

  test("a template with no agents says why its canvas is bare", async ({ page }) => {
    await page.goto("/templates");
    await page.getByTestId("template-row").filter({ hasText: DCA }).click();
    await expect(page.getByText(t("templates.builder.noAgents"))).toBeVisible();
  });

  test("cards view keeps the gallery, and a card opens its template in the builder", async ({
    page,
  }) => {
    await page.goto("/templates");
    await page.getByRole("button", { name: t("templates.view.cards") }).click();

    await expect(page.getByRole("heading", { name: t("templates.title"), level: 1 })).toBeVisible();
    await expect(page.getByTestId("template-card")).toHaveCount(5);

    await page
      .getByTestId("template-card")
      .filter({ hasText: WORKSTATION })
      .click({ position: { x: 20, y: 120 } });

    await expect(builderTitle(page)).toContainText(WORKSTATION);
    await expect(page).toHaveURL(/[?&]t=builtin%3Asolana-workstation/);
  });

  test("the private payout desk draws its planner, its desk and who the desk pays", async ({
    page,
  }) => {
    await page.goto("/templates?t=builtin%3Acloak-private-payout");

    await expect(builderTitle(page)).toContainText(CLOAK);
    const canvas = page.getByLabel(t("templates.builder.canvasLabel"));
    await expect(canvas.getByText("Payout planner", { exact: true })).toBeVisible();
    await expect(canvas.getByText("Cloak desk", { exact: true })).toBeVisible();
    await expect(canvas.getByText("SOL payee")).toBeVisible();
    await expect(canvas.getByText("ZEC payee")).toBeVisible();
  });

  test("a card's own buttons do not open the builder", async ({ page }) => {
    await page.goto("/templates");
    await page.getByRole("button", { name: t("templates.view.cards") }).click();

    await page
      .getByTestId("template-card")
      .filter({ hasText: DCA })
      .getByRole("button", { name: t("templates.learnMore") })
      .click();
    await expect(page.getByRole("dialog")).toContainText(DCA);
    await expect(page).not.toHaveURL(/[?&]t=/);
  });

  test("the chosen view survives a reload", async ({ page }) => {
    await page.goto("/templates");
    await page.getByRole("button", { name: t("templates.view.cards") }).click();
    await page.reload();
    await expect(page.getByTestId("template-card").first()).toBeVisible();

    await page.getByRole("button", { name: t("templates.view.list") }).click();
    await page.reload();
    await expect(builderTitle(page)).toBeVisible();
  });

  test("Use template from the builder opens the apply dialog for that template", async ({
    page,
  }) => {
    await page.goto("/templates?t=builtin%3Adca-sol");
    await expect(builderTitle(page)).toContainText(DCA);
    await page
      .getByTestId("template-builder")
      .getByRole("button", { name: t("templates.use.submit") })
      .click();
    await expect(page.locator("#tpl-wf-name")).toHaveValue(DCA);
  });
});
