import { readFile } from "node:fs/promises";
import { proofPackSchema, ZEC_MINT } from "@agent-rails/contract/template-run";
import type { Page } from "@playwright/test";
import { ADDR, expect, stubChain, stubChat, stubWallet, t, test } from "./fixtures";

/**
 * The private payout card, end to end in a browser: a chat reply with a ```template-run block
 * becomes an approval card, and approving it drives the runner with a stand-in for Cloak (the
 * build sets NEXT_PUBLIC_CLOAK_FAKE_SDK; see playwright.config.ts). What this suite pins is
 * the part that is ours: what the card shows, what gates it, what the wallet is asked, what is
 * stored, and that nothing reaches Cloak, the proving files or a mainnet RPC from a test.
 */

// Valid addresses that are neither the stub wallet nor anything real.
const SOL_PAYEE = ADDR.agentSession;
const ZEC_PAYEE = ADDR.treasury;

const proposal = {
  apiVersion: "agent-rails.template-run/v1",
  template: "builtin:cloak-private-payout",
  payees: [
    { label: "Vendor A", address: SOL_PAYEE, deliver: "SOL", amountSol: "0.02" },
    { label: "Contributor B", address: ZEC_PAYEE, deliver: "ZEC", amountSol: "0.02" },
  ],
};

const reply = (body: unknown) =>
  `Here is the plan.\n\n\`\`\`template-run\n${JSON.stringify(body)}\n\`\`\`\n\nNothing runs until you approve it in your wallet.`;

/** The quote endpoint answers; every host a real run would use fails the test if it is touched. */
async function stubCloakNetwork(page: Page): Promise<string[]> {
  const reached: string[] = [];
  await page.route("https://lite-api.jup.ag/**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "access-control-allow-origin": "*" },
      body: JSON.stringify({ outputMint: ZEC_MINT, outAmount: "183000" }),
    }),
  );
  await page.route(
    /^https:\/\/(api\.cloak\.ag|storage\.googleapis\.com|solana-rpc\.publicnode\.com|api\.mainnet-beta\.solana\.com)\//,
    (route) => {
      reached.push(route.request().url());
      return route.abort();
    },
  );
  return reached;
}

async function showCard(page: Page, body: unknown): Promise<void> {
  await stubChat(page, reply(body));
  await page.goto("/");
  await page.getByPlaceholder(t("chat.placeholder")).fill("pay my two contributors privately");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("template-run")).toBeVisible();
}

async function tickBoth(page: Page): Promise<void> {
  await page.getByLabel(t("chat.templateRun.confirmAddresses")).check();
  await page.getByLabel(t("chat.templateRun.confirmMainnet")).check();
}

const approve = (page: Page) => page.getByTestId("template-run-approve");
const step = (page: Page, id: string) => page.getByTestId(`template-run-step-${id}`);
const messagesSigned = (page: Page) =>
  page.evaluate(() => (window as unknown as { __messages?: number }).__messages ?? 0);

test.describe("private payout card", () => {
  let reached: string[] = [];

  test.beforeEach(async ({ page }) => {
    await stubChain(page);
    reached = await stubCloakNetwork(page);
  });

  test.afterEach(() => {
    expect(reached, "a test reached Cloak, the proving files or a mainnet RPC").toEqual([]);
  });

  test("turns a chat reply into an approval card with the whole address and the fees", async ({
    page,
  }) => {
    await stubWallet(page);
    await showCard(page, proposal);

    const card = page.getByTestId("template-run");
    await expect(page.getByTestId("template-run-mainnet")).toHaveText(
      t("chat.templateRun.mainnet"),
    );
    await expect(card.getByTestId("template-run-funder")).toContainText(ADDR.wallet);
    // The raw block is not shown: it is the card.
    await expect(page.getByText("agent-rails.template-run/v1")).toHaveCount(0);

    const vendor = page.getByTestId("template-run-payee-0");
    await expect(vendor).toContainText("Vendor A");
    await expect(vendor).toContainText(SOL_PAYEE);
    await expect(vendor).toContainText("fee 0.00506");
    await expect(vendor).toContainText("they receive 0.01494");

    const contributor = page.getByTestId("template-run-payee-1");
    await expect(contributor).toContainText(ZEC_PAYEE);
    await expect(contributor).toContainText("swaps 0.01494 SOL after a 0.00506 fee");
    await expect(contributor).toContainText("at least 0.0017934 ZEC (quote 0.00183)");

    await expect(page.getByTestId("template-run-totals")).toContainText(
      "Shield 0.04 SOL · Cloak fees 0.01012 SOL · the wallet needs at least 0.06 SOL",
    );
  });

  test("keeps Approve disabled until both confirmations are ticked", async ({ page }) => {
    await stubWallet(page);
    await showCard(page, proposal);

    await expect(approve(page)).toBeDisabled();
    await page.getByLabel(t("chat.templateRun.confirmAddresses")).check();
    await expect(approve(page)).toBeDisabled();
    await page.getByLabel(t("chat.templateRun.confirmMainnet")).check();
    await expect(approve(page)).toBeEnabled();
    await page.getByLabel(t("chat.templateRun.confirmMainnet")).uncheck();
    await expect(approve(page)).toBeDisabled();
  });

  test("refuses a wallet that is not on the allowed list, however much is ticked", async ({
    page,
  }) => {
    await stubWallet(page, { address: ADDR.solVault });
    await showCard(page, proposal);
    await tickBoth(page);

    await expect(page.getByTestId("template-run-policy")).toContainText(
      t("chat.templateRun.error.wallet_not_allowed"),
    );
    await expect(approve(page)).toBeDisabled();
  });

  test("asks for a wallet before anything else when none is connected", async ({ page }) => {
    await stubWallet(page, { trusted: false });
    await showCard(page, proposal);
    await tickBoth(page);

    await expect(page.getByTestId("template-run-policy")).toContainText(
      t("chat.templateRun.error.wallet_missing"),
    );
    await expect(approve(page)).toBeDisabled();
  });

  test("turns an invalid block into a refusal, never a payout", async ({ page }) => {
    await stubWallet(page);
    await stubChat(
      page,
      reply({ ...proposal, payees: [{ ...proposal.payees[0], address: "not-an-address" }] }),
    );
    await page.goto("/");
    await page.getByPlaceholder(t("chat.placeholder")).fill("pay someone");
    await page.keyboard.press("Enter");

    await expect(page.getByTestId("template-run-invalid")).toContainText(
      t("chat.templateRun.invalid"),
    );
    await expect(page.getByTestId("template-run-invalid")).toContainText("not a Solana address");
    await expect(page.getByTestId("template-run")).toHaveCount(0);
    await expect(approve(page)).toHaveCount(0);
  });

  test("refuses a payout to the wallet that would fund it", async ({ page }) => {
    await stubWallet(page);
    await showCard(page, {
      ...proposal,
      payees: [{ ...proposal.payees[0], address: ADDR.wallet }],
    });
    await tickBoth(page);

    await expect(page.getByTestId("template-run-policy")).toContainText(
      t("chat.templateRun.error.payee_invalid"),
    );
    await expect(approve(page)).toBeDisabled();
  });

  test("runs the whole payout, asks the wallet twice, and leaves a proof and no secret", async ({
    page,
  }) => {
    await stubWallet(page);
    await showCard(page, proposal);
    await tickBoth(page);
    await expect(approve(page)).toBeEnabled();
    await approve(page).click();

    await expect(page.getByTestId("template-run-done")).toBeVisible();
    for (const id of [
      "preflight",
      "derive-keys",
      "shield",
      "commit",
      "payout:0",
      "payout:1",
      "report",
    ]) {
      await expect(step(page, id)).toHaveAttribute("data-status", "done");
    }
    await expect(step(page, "shield").getByRole("link")).toHaveAttribute(
      "href",
      /^https:\/\/explorer\.solana\.com\/tx\/[1-9A-HJ-NP-Za-km-z]{64,90}$/,
    );
    // First run on this device: the wallet signs the derivation message twice.
    expect(await messagesSigned(page)).toBe(2);

    const download = page.waitForEvent("download");
    await page.getByRole("link", { name: t("chat.templateRun.downloadProof") }).click();
    const proof = proofPackSchema.parse(
      JSON.parse(await readFile((await (await download).path()) as string, "utf8")),
    );
    expect(proof.cluster).toBe("mainnet-beta");
    expect(proof.funder).toBe(ADDR.wallet);
    expect(proof.payouts.map((p) => [p.address, p.deliver])).toEqual([
      [SOL_PAYEE, "SOL"],
      [ZEC_PAYEE, "ZEC"],
    ]);

    // All the browser kept is a public checksum of the keys: no log (the run finished), no note.
    const stored = await page.evaluate(() =>
      Object.fromEntries(
        Object.keys(localStorage)
          .filter((key) => key.startsWith("agent-rails.cloak"))
          .map((key) => [key, localStorage.getItem(key)]),
      ),
    );
    expect(Object.keys(stored)).toEqual([`agent-rails.cloak.fingerprint:${ADDR.wallet}`]);
    expect(Object.values(stored)[0]).toMatch(/^[0-9a-f]{16}$/);
  });

  test("says plainly when the build is a test build that sends nothing", async ({ page }) => {
    await stubWallet(page);
    await showCard(page, proposal);
    await expect(page.getByTestId("template-run-test-mode")).toHaveText(
      t("chat.templateRun.testMode"),
    );
  });

  test("shows every address whole, with no part of it picked out", async ({ page }) => {
    await stubWallet(page);
    await showCard(page, proposal);
    const addresses = page.getByTestId("template-run-address");
    await expect(addresses.first()).toBeVisible();
    for (const element of await addresses.all()) {
      // Plain text: nothing inside it is styled apart from the rest.
      expect(await element.locator("*").count()).toBe(0);
    }
    await expect(addresses.filter({ hasText: SOL_PAYEE })).toHaveCount(1);
    await expect(addresses.filter({ hasText: ZEC_PAYEE })).toHaveCount(1);
  });

  test.describe("when the quote moves between the card and the click", () => {
    test("asks for a new approval instead of running on numbers the operator did not read", async ({
      page,
    }) => {
      await stubWallet(page);
      let outAmount = "183000";
      await page.route("https://lite-api.jup.ag/**", (route) =>
        route.fulfill({
          status: 200,
          contentType: "application/json",
          headers: { "access-control-allow-origin": "*" },
          body: JSON.stringify({ outputMint: ZEC_MINT, outAmount }),
        }),
      );
      await showCard(page, proposal);
      await tickBoth(page);
      await expect(page.getByTestId("template-run-payee-1")).toContainText("quote 0.00183");

      outAmount = "190000"; // +3.8% by the time of the click
      await approve(page).click();

      await expect(page.getByTestId("template-run-failure")).toContainText(
        t("chat.templateRun.error.quote_moved"),
      );
      // The card now shows the numbers it would have run on, and nothing was signed or sent.
      await expect(page.getByTestId("template-run-payee-1")).toContainText("quote 0.0019");
      await expect(page.getByTestId("template-run-payee-1")).toContainText("at least 0.001862 ZEC");
      expect(await messagesSigned(page)).toBe(0);
      await expect(step(page, "shield")).toHaveCount(0);

      await approve(page).click();
      await expect(page.getByTestId("template-run-done")).toBeVisible();
    });
  });

  test.describe("a run that takes a while", () => {
    test.beforeEach(async ({ page }) => {
      await stubWallet(page);
      await page.addInitScript(() => {
        (window as unknown as { __CLOAK_FAKE_OPTIONS__: unknown }).__CLOAK_FAKE_OPTIONS__ = {
          latencyMs: 500,
        };
      });
    });

    const leaveGuarded = (page: Page) =>
      page.evaluate(() => {
        const event = new Event("beforeunload", { cancelable: true });
        window.dispatchEvent(event);
        return event.defaultPrevented;
      });

    test("asks the browser before the page is left, and only while it runs", async ({ page }) => {
      await showCard(page, proposal);
      await tickBoth(page);
      expect(await leaveGuarded(page)).toBe(false);
      await approve(page).click();
      await expect(step(page, "shield")).toHaveAttribute("data-status", "started");
      expect(await leaveGuarded(page)).toBe(true);
      await expect(page.getByTestId("template-run-done")).toBeVisible();
      expect(await leaveGuarded(page)).toBe(false);
    });

    test("will not start a second run for the same wallet from a second card", async ({ page }) => {
      await stubChat(page, reply(proposal));
      await page.goto("/");
      for (const message of ["pay my contributors privately", "pay them again"]) {
        await page.getByPlaceholder(t("chat.placeholder")).fill(message);
        await page.keyboard.press("Enter");
      }
      const cards = page.getByTestId("template-run");
      await expect(cards).toHaveCount(2);
      for (const index of [0, 1]) {
        const card = cards.nth(index);
        await card.getByLabel(t("chat.templateRun.confirmAddresses")).check();
        await card.getByLabel(t("chat.templateRun.confirmMainnet")).check();
      }

      await cards.nth(0).getByTestId("template-run-approve").click();
      await expect(cards.nth(0).getByTestId("template-run-step-shield")).toHaveAttribute(
        "data-status",
        "started",
      );
      await cards.nth(1).getByTestId("template-run-approve").click();

      await expect(cards.nth(1).getByTestId("template-run-failure")).toContainText(
        t("chat.templateRun.error.run_in_progress"),
      );
      await expect(cards.nth(1).getByTestId("template-run-step-shield")).toHaveCount(0);
      // The first one is not disturbed.
      await expect(cards.nth(0).getByTestId("template-run-done")).toBeVisible();
    });
  });

  test.describe("a deposit that may have landed", () => {
    test.beforeEach(async ({ page }) => {
      await stubWallet(page);
      await page.addInitScript(() => {
        (window as unknown as { __CLOAK_FAKE_OPTIONS__: unknown }).__CLOAK_FAKE_OPTIONS__ = {
          failures: [{ at: "shield", landed: true, error: { message: "socket hang up" } }],
        };
      });
      await showCard(page, proposal);
      await tickBoth(page);
      await approve(page).click();
      await expect(page.getByTestId("template-run-failure")).toBeVisible();
    });

    test("is not shielded a second time: only a recovery may look for it", async ({ page }) => {
      await expect(page.getByTestId("template-run-failure")).toContainText(
        t("chat.templateRun.error.outcome_unknown"),
      );
      // Not "the funds are in the pool": it cannot say that, only that they may be.
      await expect(page.getByTestId("template-run-failure")).toContainText(
        t("chat.templateRun.uncertainFound"),
      );
      await expect(page.getByTestId("template-run-failure")).not.toContainText(
        t("chat.templateRun.fundsInPool"),
      );
      await expect(page.getByTestId("template-run-recover")).toBeVisible();
      await expect(approve(page)).toBeDisabled();
      // Nothing to cite, so nothing is stored but the fact that it may be there.
      const stored = await page.evaluate(() =>
        Object.keys(localStorage)
          .filter((key) => key.includes(".run:"))
          .map((key) => localStorage.getItem(key)),
      );
      expect(stored.map((value) => JSON.parse(value ?? "null"))).toEqual([
        { shieldUncertain: true, payoutSignatures: {} },
      ]);
    });

    test("finds the deposit, sends it back, and then allows a fresh run", async ({ page }) => {
      await page.getByTestId("template-run-recover").click();
      await expect(page.getByTestId("template-run-recovered")).toBeVisible();
      await expect(step(page, "recover")).toHaveAttribute("data-status", "done");
      await expect(approve(page)).toBeEnabled();
    });
  });

  test.describe("when a step fails after the shield", () => {
    test.beforeEach(async ({ page }) => {
      await stubWallet(page);
      await page.addInitScript(() => {
        (window as unknown as { __CLOAK_FAKE_OPTIONS__: unknown }).__CLOAK_FAKE_OPTIONS__ = {
          failures: [{ at: "swap", error: { message: "relay hiccup" } }],
        };
      });
      await showCard(page, proposal);
      await tickBoth(page);
      await approve(page).click();
      await expect(page.getByTestId("template-run-failure")).toBeVisible();
    });

    test("says the funds are in the pool and which step stopped", async ({ page }) => {
      await expect(page.getByTestId("template-run-failure")).toContainText(
        t("chat.templateRun.error.unknown"),
      );
      await expect(page.getByTestId("template-run-failure")).toContainText(
        t("chat.templateRun.fundsInPool"),
      );
      await expect(step(page, "shield")).toHaveAttribute("data-status", "done");
      await expect(step(page, "payout:0")).toHaveAttribute("data-status", "done");
      await expect(step(page, "payout:1")).toHaveAttribute("data-status", "failed");
    });

    test("resumes without shielding or paying anyone twice", async ({ page }) => {
      await expect(approve(page)).toHaveText(t("chat.templateRun.resume"));
      await approve(page).click();

      await expect(page.getByTestId("template-run-done")).toBeVisible();
      await expect(step(page, "shield")).toHaveAttribute("data-status", "skipped");
      await expect(step(page, "payout:0")).toHaveAttribute("data-status", "skipped");
      await expect(step(page, "payout:1")).toHaveAttribute("data-status", "done");
      // 2 for the first run's determinism check, 1 now that the checksum is known.
      expect(await messagesSigned(page)).toBe(3);
    });

    test("lets the operator take the funds back to the wallet instead", async ({ page }) => {
      await page.getByTestId("template-run-recover").click();

      await expect(page.getByTestId("template-run-recovered")).toBeVisible();
      await expect(step(page, "recover")).toHaveAttribute("data-status", "done");
      await expect(approve(page)).toHaveText(t("chat.templateRun.approve"));
    });
  });

  test.describe("a recovery that cannot see the deposit", () => {
    test("is a stop, not a success, and keeps the record of the deposit", async ({ page }) => {
      await stubWallet(page);
      await page.addInitScript(() => {
        // Only the first load of the page fails the swap; after a reload the stand-in's pool is
        // empty, as it would be for an RPC that no longer holds the history of the deposit.
        if (!sessionStorage.getItem("reloaded")) {
          (window as unknown as { __CLOAK_FAKE_OPTIONS__: unknown }).__CLOAK_FAKE_OPTIONS__ = {
            failures: [{ at: "swap", error: { message: "relay hiccup" } }],
          };
        }
      });
      await showCard(page, proposal);
      await tickBoth(page);
      await approve(page).click();
      await expect(page.getByTestId("template-run-failure")).toBeVisible();

      await page.evaluate(() => sessionStorage.setItem("reloaded", "1"));
      await page.reload();
      await page.getByPlaceholder(t("chat.placeholder")).fill("pay my two contributors privately");
      await page.keyboard.press("Enter");
      await expect(page.getByTestId("template-run")).toBeVisible();
      await expect(page.getByTestId("template-run-recover-panel")).toContainText(
        t("chat.templateRun.resumeFound"),
      );

      await page.getByTestId("template-run-recover").click();

      await expect(page.getByTestId("template-run-failure")).toContainText(
        t("chat.templateRun.error.outcome_unknown"),
      );
      await expect(page.getByTestId("template-run-recovered")).toHaveCount(0);
      await expect(page.getByTestId("template-run-recover")).toBeVisible();
      const runs = await page.evaluate(
        () => Object.keys(localStorage).filter((key) => key.includes(".run:")).length,
      );
      expect(runs).toBe(1);
    });
  });
});
