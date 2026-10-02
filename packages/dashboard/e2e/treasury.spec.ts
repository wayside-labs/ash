import type { Page } from "@playwright/test";
import { ADDR, createOnChainWorkflow, expect, stubChain, stubWallet, t, test } from "./fixtures";

/**
 * The page renders one card per workflow, and the cards with no treasury carry
 * their own disabled Deposit/Withdraw pair next to the CLI hint. Every query
 * here is scoped to the card whose vault the test stubbed, or it would match
 * four buttons and assert nothing.
 */
const vaultCard = (page: Page) => page.getByTestId(`vault-${ADDR.treasury}`);

/**
 * The only path in this UI that moves money, end to end with the chain stubbed:
 * build the transaction on the server, sign it in the wallet, confirm the
 * signature. What is asserted is the shape of the request the dashboard sends
 * and the state the user is left in — the program's own rules are tested in
 * `programs/agent_rails/tests`, not here.
 */
test.describe("vault deposit and withdraw", () => {
  test("deposits SOL and reports the confirmation", async ({ page, baseURL }) => {
    await createOnChainWorkflow(baseURL as string);
    const chain = await stubChain(page);
    await stubWallet(page);

    await page.goto("/treasury");
    await vaultCard(page)
      .getByRole("button", { name: t("common.deposit") })
      .click();
    // The dialog opens on the treasury's largest holding, which here is USDC.
    // SOL is picked explicitly so the assertion below is about lamports.
    await page.getByRole("dialog").getByRole("button", { name: "SOL", exact: true }).click();
    await page.locator("#vault-transfer-amount").fill("0.1");
    await page
      .getByRole("dialog")
      .getByRole("button", { name: t("common.deposit") })
      .click();

    await expect(page.getByText(t("vaultTransfer.confirmedTitle"))).toBeVisible();

    const built = chain.calls.find((call) => call.url === "/api/solana/vault-transfer");
    expect(built?.body).toMatchObject({
      kind: "deposit",
      treasury: ADDR.treasury,
      wallet: ADDR.wallet,
      // Base units as a string: a u64 does not survive JSON as a number.
      amount: "100000000",
    });
  });

  test("withdraw is offered to the on-chain owner only", async ({ page, baseURL }) => {
    await createOnChainWorkflow(baseURL as string);
    // The vault's owner is someone else, whatever the workflow row claims.
    await stubChain(page, { owner: ADDR.agentSession });
    await stubWallet(page);

    await page.goto("/treasury");
    const card = vaultCard(page);
    await expect(card.getByText(t("treasury.withdrawOwnerOnly"))).toBeVisible();
    await expect(card.getByRole("button", { name: t("common.withdraw") })).toBeDisabled();
    // Depositing stays open: anyone may fund a vault they do not own.
    await expect(card.getByRole("button", { name: t("common.deposit") })).toBeEnabled();
  });

  test("both buttons are dead until a wallet is connected", async ({ page, baseURL }) => {
    await createOnChainWorkflow(baseURL as string);
    await stubChain(page);
    // No wallet injected at all: the header offers connect, the card offers nothing.

    await page.goto("/treasury");
    const card = vaultCard(page);
    await expect(card.getByText(t("treasury.connectWalletToMoveFunds"))).toBeVisible();
    await expect(card.getByRole("button", { name: t("common.deposit") })).toBeDisabled();
    await expect(card.getByRole("button", { name: t("common.withdraw") })).toBeDisabled();
  });

  test("a rejected signature is reported, not swallowed", async ({ page, baseURL }) => {
    await createOnChainWorkflow(baseURL as string);
    const chain = await stubChain(page);
    await stubWallet(page, { rejectSigning: true });

    await page.goto("/treasury");
    await vaultCard(page)
      .getByRole("button", { name: t("common.deposit") })
      .click();
    await page.locator("#vault-transfer-amount").fill("0.1");
    await page
      .getByRole("dialog")
      .getByRole("button", { name: t("common.deposit") })
      .click();

    await expect(page.getByText(t("vaultTransfer.error.rejected"))).toBeVisible();
    expect(chain.calls.some((call) => call.url === "/api/solana/vault-transfer")).toBe(true);
    // Nothing was sent or confirmed, because the wallet signed nothing.
    expect(chain.calls.some((call) => call.url === "/api/solana/send")).toBe(false);
    expect(chain.calls.some((call) => call.url === "/api/solana/confirm")).toBe(false);
  });

  test("an amount above the withdrawable balance is refused before signing", async ({
    page,
    baseURL,
  }) => {
    await createOnChainWorkflow(baseURL as string);
    const chain = await stubChain(page);
    await stubWallet(page);

    await page.goto("/treasury");
    await vaultCard(page)
      .getByRole("button", { name: t("common.withdraw") })
      .click();
    await page.getByRole("dialog").getByRole("button", { name: "SOL", exact: true }).click();
    // The stubbed vault holds 2 SOL, and rent exemption is withheld on top.
    await page.locator("#vault-transfer-amount").fill("999");

    await expect(page.getByText(/Above the available/)).toBeVisible();
    await expect(
      page.getByRole("dialog").getByRole("button", { name: t("common.withdraw") }),
    ).toBeDisabled();
    expect(chain.calls.some((call) => call.url === "/api/solana/vault-transfer")).toBe(false);
  });

  test("the policy and session drawer reads from the chain", async ({ page, baseURL }) => {
    await createOnChainWorkflow(baseURL as string);
    await stubChain(page);
    await stubWallet(page);

    await page.goto("/treasury");
    await vaultCard(page)
      .getByRole("button", { name: t("treasury.viewPolicySessions") })
      .click();

    // The session label and the policy name come from the decoded accounts, so
    // seeing them proves the drawer is rendering chain state and not the store.
    await expect(page.getByText("payer").first()).toBeVisible();
    await expect(page.getByText("default").first()).toBeVisible();
  });
});
