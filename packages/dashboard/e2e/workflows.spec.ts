import { ADDR, expect, openDialog, stubChain, stubWallet, t, test } from "./fixtures";

/**
 * The CRUD the dashboard actually owns. Nothing here touches the chain: a
 * workflow is a dashboard label with an optional treasury address attached, and
 * the address is the only field that has to survive `addressSchema`.
 */
test.describe("workflows", () => {
  test.beforeEach(async ({ page }) => {
    await stubChain(page);
    await stubWallet(page);
  });

  test("creates a workflow and it survives a reload", async ({ page }) => {
    await page.goto("/workflows");
    await openDialog(page, t("workflows.newWorkflow"), "#wf-name");

    await page.locator("#wf-name").fill("Playwright Ops");
    await page.locator("#wf-desc").fill("Created by the UI suite");
    await page.locator("#wf-treasury").fill(ADDR.treasury);
    await page.getByRole("button", { name: t("workflowDialogs.createWorkflow.submit") }).click();

    await expect(page.getByRole("heading", { name: "Playwright Ops" })).toBeVisible();
    await page.reload();
    await expect(page.getByRole("heading", { name: "Playwright Ops" })).toBeVisible();
  });

  test("refuses a treasury address that is not base58", async ({ page }) => {
    await page.goto("/workflows");
    await openDialog(page, t("workflows.newWorkflow"), "#wf-name");

    await page.locator("#wf-name").fill("Bad Address");
    await page.locator("#wf-treasury").fill("not-an-address");
    await expect(page.getByText(t("common.invalidAddress"))).toBeVisible();

    // The submit is blocked, not merely warned about: a malformed address would
    // otherwise be handed to the RPC as a getAccountInfo argument.
    const submit = page.getByRole("button", {
      name: t("workflowDialogs.createWorkflow.submit"),
    });
    await expect(submit).toBeDisabled();

    // Clearing the field is allowed — "not provisioned" is a legitimate state,
    // and the button has to come back for it.
    await page.locator("#wf-treasury").fill("");
    await expect(submit).toBeEnabled();
  });

  test("edits and then removes a workflow", async ({ page }) => {
    await page.goto("/workflows");
    await openDialog(page, t("workflows.newWorkflow"), "#wf-name");
    await page.locator("#wf-name").fill("Renameable");
    await page.getByRole("button", { name: t("workflowDialogs.createWorkflow.submit") }).click();
    await expect(page.getByRole("heading", { name: "Renameable" })).toBeVisible();

    await page
      .getByRole("button", { name: t("workflowRow.aria.editWorkflow", { name: "Renameable" }) })
      .click();
    await page.locator("#wf-edit-name").fill("Renamed");
    await page.getByRole("button", { name: t("common.save") }).click();
    await expect(page.getByRole("heading", { name: "Renamed" })).toBeVisible();

    page.once("dialog", (dialog) => {
      expect(dialog.message()).toContain("Renamed");
      void dialog.accept();
    });
    await page
      .locator("section", { hasText: "Renamed" })
      .getByRole("button", { name: t("workflowRow.aria.removeWorkflow") })
      .first()
      .click();
    await expect(page.getByRole("heading", { name: "Renamed" })).toHaveCount(0);
  });

  test("the seeded rows are labelled as demo, not as on-chain", async ({ page }) => {
    await page.goto("/workflows");
    // Three seeded workflows, none of them with a treasury: the badge is the
    // only thing keeping an illustrative number from reading as a balance.
    await expect(page.getByText(t("common.demo"), { exact: true }).first()).toBeVisible();
  });
});
