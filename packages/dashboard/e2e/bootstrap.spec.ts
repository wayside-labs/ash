import { getBase64Encoder, getTransactionDecoder } from "@solana/kit";
import {
  ADDR,
  BOOTSTRAP_VENDOR,
  clickUntil,
  createRow,
  expect,
  stubChain,
  stubWallet,
  t,
  test,
} from "./fixtures";

/**
 * ADR-021 wave 2A, end to end with the chain stubbed: a workflow with no treasury gets
 * one from the Treasury page, without a terminal. What is asserted is what the browser
 * does that nothing else can — generate the create_key, sign the treasury stage with it
 * after the wallet does, send only public keys to the server, and link the workflow —
 * plus that the loop walks every stage the server hands out. Which stages exist, and in
 * what order, is `buildStages`' business and is tested in `packages/cli` and in
 * `lib/server/bootstrap.test.ts` against real encodings.
 */
test.describe("treasury bootstrap wizard", () => {
  test("creates a vault, links the workflow and hands over the first agent's key", async ({
    page,
    baseURL,
  }) => {
    const workflow = await createRow(baseURL as string, "workflows", {
      name: "Fresh Ops",
      description: "no treasury yet",
      icon: "🧪",
      cluster: "devnet",
      ownerAddress: ADDR.wallet,
      treasuryAddress: null,
      demo: false,
      demoBalanceUsd: null,
    });
    const chain = await stubChain(page);
    await stubWallet(page);

    await page.goto("/treasury");
    const card = page.getByTestId(`workflow-${workflow.id}`);
    // The CLI hint is gone: the empty card offers the wizard instead.
    await expect(card.getByText("agent-rails init")).toHaveCount(0);
    const dialog = page.getByRole("dialog");
    await clickUntil(
      card.getByRole("button", { name: t("treasury.bootstrap.cta") }),
      dialog.getByText(t("bootstrap.network.heading")),
    );

    const next = dialog.getByRole("button", { name: t("bootstrap.next") });
    await next.click();
    await expect(page.locator("#bootstrap-per-tx")).toHaveValue("0.1");
    await next.click();

    await dialog.getByRole("radio", { name: t("bootstrap.destination.mode.vendor") }).click();
    await dialog.getByRole("button", { name: new RegExp(BOOTSTRAP_VENDOR.title) }).click();
    await next.click();

    await dialog.getByRole("switch").click();
    await page.locator("#bootstrap-agent-name").fill("Scout");
    await next.click();

    const sign = dialog.getByRole("button", { name: t("bootstrap.review.sign", { count: 3 }) });
    await expect(sign).toBeEnabled();
    await sign.click();

    const delivery = page
      .getByRole("dialog")
      .filter({ hasText: t("sessionKeyDelivery.lossWarning") });
    await expect(delivery).toBeVisible();
    await delivery
      .getByRole("button", { name: t("common.close") })
      .last()
      .click();
    await expect(dialog.getByText(t("bootstrap.done.title"))).toBeVisible();

    // Every stage the server handed out was built once, and the loop stopped at `done`.
    expect(chain.bootstrapStages).toEqual(["treasury", "policy", "funding"]);
    const builds = chain.calls.filter((call) => call.url === "/api/solana/bootstrap/build-step");
    expect(builds).toHaveLength(4);

    // A new treasury is named by its create_key until it exists, then by its address.
    type Body = {
      createKey: string | null;
      treasury: string | null;
      destination: unknown;
      session: Record<string, unknown> | null;
    };
    const [first, second] = builds.map((call) => call.body as Body);
    expect(first?.treasury).toBeNull();
    expect(first?.createKey).toMatch(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
    expect(second).toMatchObject({ treasury: ADDR.treasury, createKey: null });
    expect(first?.destination).toEqual({
      owner: BOOTSTRAP_VENDOR.owner,
      label: BOOTSTRAP_VENDOR.label,
    });
    // The session key crosses the wire as a public key and nothing else (ADR-017/018).
    expect(Object.keys(first?.session ?? {}).sort()).toEqual(["feeBudgetLamports", "key", "label"]);

    // The wallet signs first: the treasury stage reached it without the create_key's
    // signature, and the create_key signed after it, before the dashboard sent it.
    const decode = (wire: string) =>
      getTransactionDecoder().decode(getBase64Encoder().encode(wire));
    const signed = await page.evaluate(
      () => (window as unknown as { __signed: { transaction: string }[] }).__signed,
    );
    expect(signed).toHaveLength(3);
    const createKey = first?.createKey as string;
    const atWallet = decode(signed[0]?.transaction ?? "");
    expect(atWallet.signatures[createKey as keyof typeof atWallet.signatures]).toBeNull();
    const sends = chain.calls.filter((call) => call.url === "/api/solana/send");
    expect(sends).toHaveLength(3);
    const sent = decode(
      (sends[0]?.body as { transaction?: string } | undefined)?.transaction ?? "",
    );
    expect(sent.signatures[createKey as keyof typeof sent.signatures]).not.toBeNull();

    // The workflow now points at the new treasury, so the card shows the vault.
    await dialog.getByRole("link", { name: t("bootstrap.done.openTreasury") }).click();
    await expect(page.getByTestId(`vault-${ADDR.treasury}`)).toBeVisible();
  });

  test("offers manual entry when the vendors do not answer", async ({ page, baseURL }) => {
    const workflow = await createRow(baseURL as string, "workflows", {
      name: "Offline Vendors",
      cluster: "devnet",
      ownerAddress: ADDR.wallet,
      treasuryAddress: null,
    });
    await stubChain(page);
    await stubWallet(page);
    // Registered after `stubChain`, so it wins for this one path.
    await page.route("**/api/solana/bootstrap/vendors", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: '{"vendors":[]}' }),
    );

    await page.goto("/treasury");
    const dialog = page.getByRole("dialog");
    await clickUntil(
      page
        .getByTestId(`workflow-${workflow.id}`)
        .getByRole("button", { name: t("treasury.bootstrap.cta") }),
      dialog.getByText(t("bootstrap.network.heading")),
    );
    const next = dialog.getByRole("button", { name: t("bootstrap.next") });
    await next.click();
    await next.click();
    await dialog.getByRole("radio", { name: t("bootstrap.destination.mode.vendor") }).click();
    await expect(dialog.getByText(t("bootstrap.destination.vendorsUnavailable"))).toBeVisible();
    await expect(next).toBeDisabled();

    await dialog.getByRole("radio", { name: t("bootstrap.destination.mode.manual") }).click();
    await page.locator("#bootstrap-dest-label").fill("acme");
    await page.locator("#bootstrap-dest-owner").fill("not-an-address");
    await expect(next).toBeDisabled();
    await page.locator("#bootstrap-dest-owner").fill(ADDR.solVault);
    await expect(next).toBeEnabled();
  });

  test("keeps the wizard closed to a visitor with no wallet", async ({ page, baseURL }) => {
    const workflow = await createRow(baseURL as string, "workflows", {
      name: "No Wallet",
      cluster: "devnet",
      ownerAddress: null,
      treasuryAddress: null,
    });
    await stubChain(page);
    await page.goto("/treasury");
    const card = page.getByTestId(`workflow-${workflow.id}`);
    await expect(card.getByRole("button", { name: t("treasury.bootstrap.cta") })).toBeDisabled();
    await expect(card.getByText(t("treasury.bootstrap.connectWallet"))).toBeVisible();
  });
});
