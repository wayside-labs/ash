import { expect, openDialog, stubChain, stubWallet, t, test } from "./fixtures";

test.describe("MCPs and skills", () => {
  test.beforeEach(async ({ page }) => {
    await stubChain(page);
    await stubWallet(page);
  });

  test("adds an MCP server and the enable toggle persists", async ({ page }) => {
    await page.goto("/mcps");
    await openDialog(page, t("mcps.addMcp"), "#mcp-name");

    await page.locator("#mcp-name").fill("Postgres");
    await page.locator("#mcp-command").fill("npx");
    await page.locator("#mcp-args").fill("-y\n@modelcontextprotocol/server-postgres");
    await page.getByRole("button", { name: t("common.add"), exact: true }).click();

    const toggle = page.getByRole("switch", { name: t("mcps.aria.enable", { name: "Postgres" }) });
    await expect(toggle).toBeVisible();
    const before = await toggle.getAttribute("aria-checked");
    await toggle.click();
    await page.reload();

    // The switch writes through a PATCH; a reload is the only honest proof.
    await expect(
      page.getByRole("switch", { name: t("mcps.aria.enable", { name: "Postgres" }) }),
    ).toHaveAttribute("aria-checked", before === "true" ? "false" : "true");
  });

  test("an MCP environment value never comes back to the browser", async ({ page }) => {
    const secret = "postgresql://user:hunter2@db.internal:5432/app";
    const leaks: string[] = [];
    page.on("response", async (response) => {
      if (!response.url().includes("/api/state")) return;
      const body = await response.text().catch(() => "");
      if (body.includes("hunter2")) leaks.push(response.url());
    });

    await page.goto("/mcps");
    await openDialog(page, t("mcps.addMcp"), "#mcp-name");
    await page.locator("#mcp-name").fill("Leaky");
    await page.locator("#mcp-command").fill("npx");
    await page.getByRole("button", { name: t("mcps.addEnvVar") }).click();
    await page.getByPlaceholder(t("mcps.envKeyPlaceholder")).fill("DATABASE_URL");
    await page.getByPlaceholder(t("mcps.envValuePlaceholder")).fill(secret);
    await page.getByRole("button", { name: t("common.add"), exact: true }).click();

    await expect(page.getByText("Leaky", { exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByText("Leaky", { exact: true })).toBeVisible();
    expect(leaks, `the raw env value came back from ${leaks.join(", ")}`).toEqual([]);
  });

  test("creates a skill and removes it", async ({ page }) => {
    await page.goto("/skills");
    await openDialog(page, t("skills.newSkill"), "#sk-name");
    await page.locator("#sk-name").fill("Reconcile");
    await page.locator("#sk-desc").fill("Matches invoices to payments");
    await page.getByRole("button", { name: t("common.create"), exact: true }).click();
    await expect(page.getByText("Reconcile", { exact: true })).toBeVisible();

    await page
      .getByRole("button", { name: t("skills.aria.remove", { name: "Reconcile" }) })
      .click();
    await expect(page.getByText("Reconcile", { exact: true })).toHaveCount(0);
  });
});

test.describe("API keys", () => {
  test("stores the key on the server and only ever shows a mask", async ({ page }) => {
    const secret = "sk-ant-playwright-should-never-see-this";
    const leaks: string[] = [];
    page.on("response", async (response) => {
      if (!response.url().includes("/api/")) return;
      const body = await response.text().catch(() => "");
      if (body.includes(secret)) leaks.push(response.url());
    });

    await stubChain(page);
    await page.goto("/apis");
    await openDialog(page, t("apis.addProvider"), "#api-secret");
    await page.locator("#api-secret").fill(secret);
    await page.getByRole("button", { name: t("common.save") }).click();

    await expect(page.getByText(t("apis.status.connected"))).toBeVisible();
    await page.getByRole("button", { name: t("common.show") }).click();

    // Revealing shows the mask, because the mask is all the browser was given.
    await expect(page.locator(`input[value="${secret}"]`)).toHaveCount(0);
    await expect(page.getByText(t("apis.maskNote"))).toBeVisible();

    await page.reload();
    expect(leaks, `the raw key came back from ${leaks.join(", ")}`).toEqual([]);
  });
});
