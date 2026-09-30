import { expect, stubBilling, stubChain, stubChat, t, test } from "./fixtures";

/**
 * The consumer path: sign in → add balance → ask. What this file pins is that `/` gets there
 * without a wallet or a cluster, that the balance and the extrato are the billing route's, and
 * that the operator surfaces are one click away rather than gone.
 */

const debit = (id: string, micros: number, minutesAgo: number) => ({
  id,
  kind: "chat_debit" as const,
  amountMicros: -micros,
  createdAt: new Date(Date.now() - minutesAgo * 60_000).toISOString(),
  model: "openrouter:anthropic/claude-sonnet-4.5",
  promptTokens: 1200,
  completionTokens: 300,
  rawCostMicros: Math.floor(micros / 1.2),
  markupMicros: micros - Math.floor(micros / 1.2),
});

test.describe("simple shell", () => {
  test("a funded account sees its balance, the chat and the last five movements", async ({
    page,
  }) => {
    await stubChain(page);
    await stubChat(page);
    await stubBilling(page, {
      balanceMicros: 1_234_567,
      entries: [
        ...Array.from({ length: 7 }, (_, i) => debit(`d${i}`, 2_400 + i, i + 1)),
        {
          id: "grant",
          kind: "starter_grant",
          amountMicros: 1_250_000,
          createdAt: new Date(Date.now() - 86_400_000).toISOString(),
        },
      ],
    });

    await page.goto("/");
    await expect(page.getByPlaceholder(t("chat.placeholder"))).toBeVisible();
    await expect(page.getByTestId("home-balance")).toHaveText("$1.23");
    await expect(page.getByTestId("header-balance")).toContainText("$1.23");
    await expect(page.getByTestId("recent-activity").getByTestId("ledger-row")).toHaveCount(5);
    await expect(page.getByTestId("fund-first")).toHaveCount(0);

    // The operator controls are not on this page, and no wallet was asked for.
    await expect(page.getByText("Devnet", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /connect/i })).toHaveCount(0);
  });

  test("an empty balance says to add some, and the CTA lands on the deposit section", async ({
    page,
  }) => {
    await stubChain(page);
    await stubChat(page);
    await stubBilling(page, { balanceMicros: 0 });

    await page.goto("/");
    const prompt = page.getByTestId("fund-first");
    await expect(prompt).toContainText(t("balance.emptyTitle"));
    await prompt.getByRole("link", { name: t("balance.add") }).click();

    await expect(page).toHaveURL(/\/balance#add$/);
    await expect(page.getByRole("heading", { name: t("balance.title"), level: 1 })).toBeVisible();
    await expect(page.getByTestId("add-balance")).toBeVisible();
    await expect(page.getByTestId("add-balance")).toContainText(t("balance.soon"));
  });

  test("a chat refused for credit offers the top-up in the reply", async ({ page }) => {
    await stubChain(page);
    await stubBilling(page, { balanceMicros: 10 });
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
    await expect(page.getByRole("link", { name: t("balance.add") }).last()).toHaveAttribute(
      "href",
      "/balance#add",
    );
  });

  test("with billing off the page is just the chat", async ({ page }) => {
    await stubChain(page);
    await stubChat(page);
    // No stub: the suite's server has billing off and answers `enabled: false`.

    await page.goto("/");
    await expect(page.getByPlaceholder(t("chat.placeholder"))).toBeVisible();
    await expect(page.getByTestId("balance-strip")).toHaveCount(0);
    await expect(page.getByTestId("header-balance")).toHaveCount(0);
  });

  test("advanced opens on demand, and on its own inside an advanced route", async ({ page }) => {
    await stubChain(page);
    await stubChat(page);
    await stubBilling(page, { balanceMicros: 500_000 });

    await page.goto("/");
    const toggle = page.getByRole("button", { name: t("nav.advanced") });
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(page.getByRole("link", { name: t("nav.treasury") })).toHaveCount(0);

    await toggle.click();
    await page.getByRole("link", { name: new RegExp(t("nav.treasury")) }).click();
    await expect(page).toHaveURL(/\/treasury$/);
    await expect(page.getByRole("button", { name: t("nav.advanced") })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    // Back on an operator route, the operator header is back.
    await expect(page.getByTestId("header-balance")).toHaveCount(0);
  });
});
