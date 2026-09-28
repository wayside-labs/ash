import type { ChainStub } from "./fixtures";
import { expect, openDialog, stubChain, stubWallet, t, test } from "./fixtures";

async function createTreasuryWorkflow(page: import("@playwright/test").Page): Promise<ChainStub> {
  const chain = await stubChain(page);
  await stubWallet(page);

  await page.goto("/workflows");
  await openDialog(page, t("workflows.newWorkflow"), "#wf-name");
  await page.locator("#wf-name").fill("Treasury Ops");
  await page.locator("#wf-treasury").fill("2xbbqA1KvP7znHHk59tCbyN85cyHTy5hcwpQnwTKGc1i");
  await page.getByRole("button", { name: t("workflowDialogs.createWorkflow.submit") }).click();
  await expect(page.getByRole("heading", { name: "Treasury Ops" })).toBeVisible();
  return chain;
}

test.describe("on-chain agent create", () => {
  test("creates an agent with a stubbed on-chain session", async ({ page }) => {
    const chain = await createTreasuryWorkflow(page);
    await page.goto("/agents");
    await openDialog(page, t("agents.newAgent"), "#ag-name");

    await page.locator("#ag-name").fill("On-chain Bot");
    await page.locator("#ag-role").fill("Payments");
    await page.getByRole("combobox").click();
    await page.getByRole("option", { name: /Treasury Ops/ }).click();
    await page.getByRole("button", { name: t("workflowDialogs.createAgent.submit") }).click();

    expect(chain.calls.some((call) => call.url === "/api/solana/create-session")).toBe(true);
    await expect(page.getByText(t("sessionKeyDelivery.lossWarning"))).toBeVisible();
    await page.getByRole("button", { name: t("common.close") }).click();

    const remove = page.getByRole("button", {
      name: t("agents.aria.removeAgent", { name: "On-chain Bot" }),
    });
    await expect(remove).toBeVisible();
  });
});
