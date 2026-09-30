import type { Page } from "@playwright/test";
import { clickUntil, expect, stubBilling, stubChain, stubChat, t, test } from "./fixtures";

/**
 * The dashboard's shape since 2026-10: chat + workflows at `/`, and a top bar that carries only
 * the client's money — balance, Deposit, Withdraw. What this file pins is that the operator
 * controls left the bar, that the deposit rails follow the viewer's region, and that credit
 * appears only once the server reports the transfer confirmed.
 */

const RECIPIENT = "5LwWtPdEvVUSbYCTv5zvhP9gkt3nKANLGkvD2xa6jvvD";

async function stubRegion(page: Page, country: string | null, usdRate = 1) {
  const currency = country === "BR" ? "BRL" : "USD";
  await page.route("**/api/region**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ country, currency, usdRate }),
    }),
  );
}

async function stubRails(page: Page, enabled = true) {
  await page.route("**/api/billing/rails", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        solanaPay: { enabled, cluster: "mainnet-beta" },
        pix: { enabled: false },
      }),
    }),
  );
}

async function money(page: Page, balanceMicros = 1_234_567) {
  await stubChain(page);
  await stubChat(page);
  await stubBilling(page, { balanceMicros });
}

test.describe("money bar", () => {
  test("home is chat beside the workflows, and the bar holds only the money", async ({ page }) => {
    await money(page);
    await stubRegion(page, "US");

    await page.goto("/");
    await expect(page.getByPlaceholder(t("chat.placeholder"))).toBeVisible();
    await expect(page.getByRole("heading", { name: t("home.workflowsTitle") })).toBeVisible();

    const bar = page.locator("header").first();
    await expect(bar.getByTestId("header-balance")).toContainText("$1.23");
    await expect(bar.getByRole("button", { name: t("header.deposit") })).toBeVisible();
    await expect(bar.getByRole("button", { name: t("header.withdraw") })).toBeVisible();
    // Cluster, payment mode, SOL price and Connect all left the bar.
    await expect(bar.getByText("Devnet", { exact: true })).toHaveCount(0);
    await expect(bar.getByRole("button", { name: t("wallet.connect") })).toHaveCount(0);
    await expect(bar.getByText(/\$\d+\.\d{2} \(/)).toHaveCount(0);
  });

  test("a Brazilian viewer sees reais, and PIX offered beside USDC", async ({ page }) => {
    await money(page, 2_000_000);
    await stubRegion(page, "BR", 5.5);
    await stubRails(page);

    await page.goto("/");
    await expect(page.getByTestId("header-balance")).toContainText("R$");
    await expect(page.getByTestId("header-balance")).toContainText("11,00");

    await page.getByRole("button", { name: t("header.deposit") }).click();
    await expect(page.getByTestId("deposit-rail-pix")).toBeVisible();
    await expect(page.getByTestId("deposit-rail-pix")).toBeDisabled();
    await expect(page.getByTestId("deposit-rail-solana_pay_usdc")).toBeEnabled();
  });

  test("anywhere else only USDC is offered", async ({ page }) => {
    await money(page);
    await stubRegion(page, "DE");
    await stubRails(page);

    await page.goto("/");
    await page.getByRole("button", { name: t("header.deposit") }).click();
    await expect(page.getByTestId("deposit-rail-solana_pay_usdc")).toBeVisible();
    await expect(page.getByTestId("deposit-rail-pix")).toHaveCount(0);
  });

  test("a Solana Pay deposit shows a QR and credits once the server confirms", async ({ page }) => {
    await money(page);
    await stubRegion(page, "US");
    await stubRails(page);
    const intent = {
      id: "11111111-1111-4111-8111-111111111111",
      rail: "solana_pay_usdc",
      cluster: "mainnet-beta",
      amountMicros: 25_000_000,
      url: `solana:${RECIPIENT}?amount=25&spl-token=EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v&reference=${RECIPIENT}`,
      reference: RECIPIENT,
      recipient: RECIPIENT,
      status: "pending",
    };
    let requested: unknown = null;
    await page.route("**/api/billing/deposits", async (route) => {
      requested = route.request().postDataJSON();
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({ intent }),
      });
    });
    await page.route("**/api/billing/deposits/*/check", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          intent: { ...intent, status: "confirmed", creditedMicros: 25_000_000, signature: "sig" },
        }),
      }),
    );

    await page.goto("/");
    await page.getByRole("button", { name: t("header.deposit") }).click();
    await page.getByRole("button", { name: "$25" }).click();
    await page.getByRole("button", { name: t("deposit.create") }).click();

    await expect(page.getByRole("img", { name: t("deposit.qrLabel") })).toBeVisible();
    await expect(page.getByRole("link", { name: t("deposit.openWallet") })).toHaveAttribute(
      "href",
      intent.url,
    );
    expect(requested).toEqual({ amountUsd: "25" });
    await expect(page.getByTestId("deposit-confirmed")).toContainText("$25.00", {
      timeout: 15_000,
    });
  });

  test("deposits say so when the server has no Solana Pay recipient", async ({ page }) => {
    await money(page);
    await stubRegion(page, "US");
    await stubRails(page, false);

    await page.goto("/");
    await page.getByRole("button", { name: t("header.deposit") }).click();
    await expect(page.getByText(t("deposit.railOff"))).toBeVisible();
    await expect(page.getByRole("button", { name: t("deposit.create") })).toHaveCount(0);
  });

  test("a withdrawal is sent as a request with its destination", async ({ page }) => {
    await money(page, 5_000_000);
    await stubRegion(page, "US");
    let sent: unknown = null;
    await page.route("**/api/billing/withdrawals", async (route) => {
      if (route.request().method() === "POST") {
        sent = route.request().postDataJSON();
        await route.fulfill({
          status: 201,
          contentType: "application/json",
          body: JSON.stringify({ request: { id: "w1", status: "pending" } }),
        });
      } else {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: '{"requests":[]}',
        });
      }
    });

    await page.goto("/");
    await page.getByRole("button", { name: t("header.withdraw") }).click();
    await page.getByLabel(t("withdraw.amount")).fill("2");
    await page.getByPlaceholder(t("withdraw.kind.solana_usdc.placeholder")).fill(RECIPIENT);
    await page.getByRole("button", { name: t("withdraw.submit") }).click();

    await expect(page.getByTestId("withdraw-sent")).toBeVisible();
    expect(sent).toEqual({
      amountUsd: "2",
      destinationKind: "solana_usdc",
      destination: RECIPIENT,
    });
  });

  test("a chat refused for credit opens the deposit dialog from the reply", async ({ page }) => {
    await stubChain(page);
    await stubBilling(page, { balanceMicros: 10 });
    await stubRegion(page, "US");
    await stubRails(page);
    await stubChat(page);
    // Registered after stubChat, so this handler wins for `/api/chat`.
    await page.route("**/api/chat", (route) =>
      route.fulfill({
        status: 402,
        contentType: "application/json",
        body: JSON.stringify({ error: "Not enough credit.", code: "insufficient_credit" }),
      }),
    );

    await page.goto("/");
    await page.getByPlaceholder(t("chat.placeholder")).fill("hello");
    await page.getByRole("button", { name: t("chat.aria.send") }).click();
    await expect(page.getByText("Not enough credit.")).toBeVisible();
    await page
      .getByRole("button", { name: t("balance.add") })
      .last()
      .click();
    await expect(page.getByRole("heading", { name: t("deposit.title") })).toBeVisible();
  });

  test("with billing off the bar is empty", async ({ page }) => {
    await stubChain(page);
    await stubChat(page);
    // No billing stub: the suite's server has billing off and answers `enabled: false`.

    await page.goto("/");
    await expect(page.getByPlaceholder(t("chat.placeholder"))).toBeVisible();
    await expect(page.getByTestId("header-balance")).toHaveCount(0);
    await expect(page.getByRole("button", { name: t("header.deposit") })).toHaveCount(0);
  });

  test("the menu button folds the sidebar away on desktop and brings it back", async ({ page }) => {
    await money(page);
    await stubRegion(page, "US");

    await page.goto("/");
    const nav = page.locator("aside").getByRole("link", { name: t("nav.balance") });
    const toggle = page.getByTestId("menu-toggle");
    await expect(nav).toBeVisible();
    // Server-rendered: the button exists before React attaches its handler.
    await expect(async () => {
      await toggle.click();
      await expect(nav).toBeHidden({ timeout: 2_000 });
    }).toPass({ timeout: 20_000 });
    await page.reload();
    await expect(nav).toBeHidden();
    await clickUntil(toggle, nav);
  });

  test("/advanced lands on home, and Connect lives in the pages that sign", async ({ page }) => {
    await money(page);
    await stubRegion(page, "US");

    await page.goto("/advanced");
    await expect(page).toHaveURL(/\/$/);

    await page.goto("/treasury");
    const main = page.locator("main");
    await expect(main.getByRole("button", { name: t("wallet.connect") })).toBeVisible();
    await expect(
      page
        .locator("header")
        .first()
        .getByRole("button", { name: t("wallet.connect") }),
    ).toHaveCount(0);
  });
});
