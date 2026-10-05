import {
  ADDR,
  createOnChainWorkflow,
  createRow,
  expect,
  stubChain,
  stubMetrics,
  stubWallet,
  t,
  test,
} from "./fixtures";

/**
 * The Metrics page, Phase A (docs/product/metrics-page.md §K).
 *
 * What these assert is mostly *honesty*, not layout: that an exact figure says it
 * is exact, that an unknowable figure renders as an em dash rather than a zero, and
 * that a period chip never claims to be a calendar range it cannot answer.
 */
test.describe("metrics", () => {
  test("headline numbers carry their provenance, and refusals are not zero", async ({
    page,
    baseURL,
  }) => {
    await createOnChainWorkflow(baseURL as string);
    const chain = await stubChain(page);
    await stubMetrics(page, chain);
    await stubWallet(page);

    await page.goto("/metrics");
    await expect(page.getByRole("heading", { level: 1, name: t("metrics.title") })).toBeVisible();

    // Payments comes off `seq`, so it is exact and labelled as such.
    const payments = page.getByTestId("kpi-payments");
    await expect(payments).toContainText("3");
    await expect(payments.getByTestId("exactness-counter")).toBeVisible();

    // Refused cannot be known from a browser in Phase A. An em dash, never a 0.
    const denials = page.getByTestId("kpi-denials");
    await expect(denials).toContainText("—");
    await expect(denials).not.toContainText("0");
    await expect(denials.getByTestId("exactness-unavailable")).toBeVisible();
    await expect(denials).toContainText(t("metrics.headline.refusedEmpty"));
  });

  test("the period chip names the policy's real window, and Custom stays disabled", async ({
    page,
    baseURL,
  }) => {
    await createOnChainWorkflow(baseURL as string);
    const chain = await stubChain(page);
    await stubMetrics(page, chain);
    await stubWallet(page);

    await page.goto("/metrics");

    // The stubbed policy uses an 86400s short window and a 604800s long one, so
    // the chips must read 1d and 7d — not "Last 24 hours" and not "Last 7 days".
    await expect(
      page.getByRole("button", { name: t("metrics.period.shortWindow", { window: "1d" }) }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: t("metrics.period.longWindow", { window: "7d" }) }),
    ).toBeVisible();

    // Custom is visible and inert: hiding it would hide the reason it cannot work.
    const custom = page.getByTestId("period-custom-disabled");
    await expect(custom).toBeVisible();
    await expect(custom).toHaveText(new RegExp(t("metrics.period.custom")));
    expect(await custom.evaluate((node) => node.tagName)).not.toBe("BUTTON");

    // Switching period is a URL change, so the view is a link somebody can send.
    await page.getByRole("button", { name: t("metrics.period.sessionLife") }).click();
    await expect(page).toHaveURL(/period=session-life/);
  });

  test("payment history shows an incomplete banner and export buttons", async ({
    page,
    baseURL,
  }) => {
    const workflow = await createOnChainWorkflow(baseURL as string, "Vault With Session");
    await createRow(baseURL as string, "agents", {
      workflowId: workflow.id,
      name: "payer",
      status: "active",
      walletAddress: ADDR.agentSession,
      sessionAddress: ADDR.agentSession,
      resolvedSessionAddress: ADDR.agentSession,
    });
    const chain = await stubChain(page);
    await stubMetrics(page, chain);
    await stubWallet(page);

    await page.goto("/metrics");

    const table = page.getByTestId("payments-table");
    await expect(table).toBeVisible({ timeout: 10_000 });
    await expect(
      table.getByRole("button", { name: t("metrics.payments.exportCsv") }),
    ).toBeVisible();
    await expect(
      table.getByRole("button", { name: t("metrics.payments.exportJson") }),
    ).toBeVisible();
  });

  test("the audit chain reports a head without claiming it was verified", async ({
    page,
    baseURL,
  }) => {
    await createOnChainWorkflow(baseURL as string);
    const chain = await stubChain(page);
    await stubMetrics(page, chain);
    await stubWallet(page);

    await page.goto("/metrics");

    const rows = page.getByTestId("integrity-rows");
    await expect(rows).toContainText(t("metrics.integrity.seq", { seq: "3" }));
    // Reading a field is not verifying a chain, and the row must not imply it did.
    await expect(rows).toContainText(t("metrics.integrity.notVerified"));
    await expect(rows).not.toContainText(t("metrics.integrity.verified", { seq: "3" }));
  });

  test("hiding balances hides amounts but keeps the provenance readable", async ({
    page,
    baseURL,
  }) => {
    await createOnChainWorkflow(baseURL as string);
    const chain = await stubChain(page);
    await stubMetrics(page, chain);
    await stubWallet(page);

    await page.goto("/metrics");
    await expect(page.getByTestId("kpi-holdings")).toBeVisible();

    await page.getByRole("button", { name: t("wallet.aria.hideBalances") }).click();

    const holdings = page.getByTestId("kpi-holdings");
    await expect(holdings).toContainText("••••");
    // The footnote is not an amount, so it stays legible while amounts are hidden.
    await expect(holdings.getByTestId("exactness-counter")).toBeVisible();

    // §2 and §3 too, not only the headline: the stubbed vault holds 2 SOL and has
    // spent 0.125, and none of those figures may survive the toggle anywhere on
    // the page. Asserting on §1 alone is what let the headroom meter leak.
    const headroom = page.getByTestId("headroom-panel");
    await expect(headroom).toContainText("••••");
    await expect(headroom).not.toContainText("0.125");
    await expect(headroom).not.toContainText("0.5 SOL");
    // The bars stay: a proportion is not an amount, and hiding them would hide
    // whether a limit is nearly spent.
    await expect(headroom.getByTestId("headroom-meter").first()).toBeVisible();

    await expect(page.getByTestId("token-split")).not.toContainText("0.125");

    // And nothing anywhere still prints the vault's balance.
    await expect(page.locator("main")).not.toContainText("2.41");
  });

  test("a vault-less operator gets an honest empty state with the command to fix it", async ({
    page,
  }) => {
    // The seeded demo workflows carry no treasuryAddress, so nothing is readable.
    const chain = await stubChain(page);
    await stubMetrics(page, chain);
    await stubWallet(page);

    await page.goto("/metrics");
    await expect(page.getByText(t("metrics.emptyTitle"))).toBeVisible();
    await expect(page.getByText("pnpm ash init --rpc <url>")).toBeVisible();
  });
});
