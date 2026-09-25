import { expect, openDialog, stubChain, stubWallet, t, test } from "./fixtures";

test.describe("agents", () => {
  test.beforeEach(async ({ page }) => {
    await stubChain(page);
    await stubWallet(page);
  });

  test("creates an agent inside a workflow", async ({ page }) => {
    await page.goto("/agents");
    await openDialog(page, t("agents.newAgent"), "#ag-name");

    await page.locator("#ag-name").fill("Suite Bot");
    await page.locator("#ag-role").fill("Payments");
    // The workflow has to be picked by hand: the dialog's default is read once,
    // at first render, when the workflow query has not resolved yet.
    await page.getByRole("combobox").click();
    await page.getByRole("option").first().click();
    await page.getByRole("button", { name: t("workflowDialogs.createAgent.submit") }).click();

    const remove = page.getByRole("button", {
      name: t("agents.aria.removeAgent", { name: "Suite Bot" }),
    });
    await expect(remove).toBeVisible();
    await page.reload();
    await expect(remove).toBeVisible();
  });

  test("pausing an agent persists and says what it does not do", async ({ page }) => {
    await page.goto("/agents");
    const card = page.getByTestId("agent-a_demo_maria");
    await card.getByRole("button", { name: t("common.pause") }).click();
    await expect(card.getByRole("button", { name: t("common.activate") })).toBeVisible();

    await page.reload();
    await expect(
      page.getByTestId("agent-a_demo_maria").getByRole("button", { name: t("common.activate") }),
    ).toBeVisible();

    // Pausing here is a label. Revoking the session is an operator action with a
    // signature behind it, and the page has to keep saying so.
    await expect(page.getByText(t("agents.footerNote"))).toBeVisible();
  });

  test("removes an agent after confirming", async ({ page }) => {
    await page.goto("/agents");
    await expect(page.getByTestId("agent-a_demo_ana")).toBeVisible();
    page.once("dialog", (dialog) => void dialog.accept());
    await page.getByRole("button", { name: t("agents.aria.removeAgent", { name: "Ana" }) }).click();
    await expect(page.getByTestId("agent-a_demo_ana")).toHaveCount(0);
  });
});
