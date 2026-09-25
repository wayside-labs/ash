import { createOnChainWorkflow, expect, stubChain, stubWallet, t, test } from "./fixtures";

/**
 * The UI half of the privilege split. `src/lib/server/privileged-surface.test.ts`
 * proves no privileged instruction builder is imported; this proves the pages
 * behave accordingly — limits are reported, never edited, and the only write
 * the browser ever issues against a cluster is the owner's own vault transfer.
 */
const READ_ONLY_CHAIN_ROUTES = new Set([
  "/api/solana/balances",
  "/api/solana/vault-balances",
  "/api/solana/treasury",
  "/api/solana/price",
  "/api/solana/rpc-health",
]);

test.describe("privilege boundaries", () => {
  test("browsing the money pages issues no chain write", async ({ page, baseURL }) => {
    await createOnChainWorkflow(baseURL as string);
    const chain = await stubChain(page);
    await stubWallet(page);

    for (const path of ["/treasury", "/limits", "/wallets", "/agents"]) {
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    }

    const writes = chain.calls.filter((call) => !READ_ONLY_CHAIN_ROUTES.has(call.url));
    expect(writes, `unexpected chain write: ${JSON.stringify(writes)}`).toEqual([]);
  });

  test("limits are shown with their provenance, and offer no control", async ({
    page,
    baseURL,
  }) => {
    await createOnChainWorkflow(baseURL as string);
    await stubChain(page);
    await stubWallet(page);

    await page.goto("/limits");
    // Loosening flows downhill, and the page says so rather than implying the
    // numbers are editable here.
    await expect(page.getByText(t("limits.descriptionLong"))).toBeVisible();

    // No button on this page submits anything: every control is a link or a
    // disclosure. A "save limits" button here would be the bug ADR-002 exists
    // to prevent.
    const labels = await page.getByRole("button").allInnerTexts();
    for (const label of labels) {
      expect(label.toLowerCase()).not.toMatch(/save|apply|raise|update|set /);
    }
  });

  test("a treasury with no address points at the CLI instead of a dead button", async ({
    page,
  }) => {
    await stubChain(page);
    await stubWallet(page);

    // The seeded workflows carry no treasury, which is the state a first-run
    // user is in: the honest answer is the bootstrap command, not a form.
    await page.goto("/treasury");
    await expect(page.getByText(t("treasury.noTreasuryConnected")).first()).toBeVisible();
    await expect(page.getByText(t("treasury.setupHint")).first()).toBeVisible();
    await expect(page.getByText(/pnpm agent-rails init/).first()).toBeVisible();
  });

  test("the chat box cannot move money", async ({ page }) => {
    await stubChain(page);
    await page.route("**/api/chat/providers", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ providers: [] }),
      }),
    );
    const chatCalls: string[] = [];
    await page.route("**/api/chat", async (route) => {
      chatCalls.push(route.request().postData() ?? "");
      await route.fulfill({
        status: 200,
        contentType: "text/plain; charset=utf-8",
        body: "I can read your vaults, but you sign every payment.",
      });
    });

    await page.goto("/");
    await page.getByPlaceholder(t("chat.placeholder")).fill("withdraw everything to my wallet");
    await page.keyboard.press("Enter");

    await expect(page.getByText(/you sign every payment/)).toBeVisible();
    // The chat route takes messages and a cluster. There is no tool call, no
    // signature, and no transaction to be built out of what it returns.
    expect(chatCalls).toHaveLength(1);
    const body = JSON.parse(chatCalls[0] as string);
    expect(Object.keys(body).sort()).toEqual(
      ["cluster", "messages", "model", "rpc"].filter((key) => key in body).sort(),
    );
    expect(JSON.stringify(body)).not.toContain("signature");
  });
});
