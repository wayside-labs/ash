import ptBR from "../src/i18n/locales/pt-BR.json" with { type: "json" };
import { clickUntil, expect, openDialog, stubChain, stubWallet, t, test } from "./fixtures";

test.describe("settings", () => {
  test.beforeEach(async ({ page }) => {
    await stubChain(page);
    await stubWallet(page);
  });

  test("switching the language re-renders the whole dashboard", async ({ page }) => {
    await page.goto("/settings");
    await page.getByRole("combobox").filter({ hasText: "English" }).click();
    await page.getByRole("option", { name: "Português (BR)" }).click();

    await expect(
      page.getByRole("heading", { name: ptBR["settings.title"], level: 1 }),
    ).toBeVisible();
    // The preference is stored server-side, so it has to survive a navigation
    // to a page that never saw the click.
    await page.goto("/workflows");
    await expect(
      page.getByRole("heading", { name: ptBR["workflows.title"], level: 1 }),
    ).toBeVisible();
  });

  test("the RPC test reports what the cluster answered", async ({ page }) => {
    await page.goto("/settings");
    await clickUntil(
      page.getByRole("button", { name: t("common.testConnection") }),
      page.getByText(/stubbed cluster/),
    );
  });

  test("restoring defaults clears what the user made and says what it does not touch", async ({
    page,
  }) => {
    await page.goto("/skills");
    await openDialog(page, t("skills.newSkill"), "#sk-name");
    await page.locator("#sk-name").fill("Temporary");
    await page.getByRole("button", { name: t("common.create"), exact: true }).click();
    await expect(page.getByText("Temporary", { exact: true })).toBeVisible();

    await page.goto("/settings");
    // The warning is load-bearing: a reset drops keys and workflows, and the
    // user has to know it stops at the browser — vaults and sessions stay.
    await expect(page.getByText(t("settings.restoreWarning"))).toBeVisible();
    page.once("dialog", (dialog) => void dialog.accept());
    await page.getByRole("button", { name: t("common.restoreDefaults") }).click();

    await page.goto("/skills");
    await expect(page.getByText("Temporary", { exact: true })).toHaveCount(0);
  });
});
