import { test as base, expect, type Locator, type Page } from "@playwright/test";
import {
  AccountRole,
  address,
  appendTransactionMessageInstructions,
  compileTransaction,
  createTransactionMessage,
  getBase64EncodedWireTransaction,
  pipe,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
} from "@solana/kit";
import en from "../src/i18n/locales/en.json" with { type: "json" };

/**
 * Selectors read from the same catalogue the UI renders from, so a reworded
 * button breaks the assertion at the key rather than silently matching nothing.
 * English only: `DEFAULT_LOCALE` is `en`, and the locale test switches to
 * pt-BR explicitly rather than every other test guessing which one is stored.
 */
type MessageKey = keyof typeof en;

export function t(key: MessageKey, params?: Record<string, string | number>): string {
  let text: string = en[key];
  for (const [name, value] of Object.entries(params ?? {})) {
    text = text.replaceAll(`{${name}}`, String(value));
  }
  return text;
}

/**
 * Real base58, because the dashboard hands these straight to `addressSchema`
 * and to the RPC layer — a placeholder like "treasury1" is rejected before it
 * can exercise anything.
 */
export const ADDR = {
  wallet: "5LwWtPdEvVUSbYCTv5zvhP9gkt3nKANLGkvD2xa6jvvD",
  treasury: "2xbbqA1KvP7znHHk59tCbyN85cyHTy5hcwpQnwTKGc1i",
  solVault: "4Qg14cZWVLPXeFFrcaD9cFZEdLX44M4AWfxdHwSiVYeF",
  // Not `sessionKey`: `generic-api-key` matches a high-entropy literal assigned to any
  // field whose name ends in "key", so a public address in a fixture reads to the secrets
  // gate as a credential. Renaming the field is cheaper than an allowlist entry that would
  // have to be carried forever for a string that is not a secret.
  agentSession: "7v5FqEj8DaCbvJPEqpUtZXKyLBtrHuxhG2tWayTaJd4C",
  usdcDevnet: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
  nativeMint: "So11111111111111111111111111111111111111112",
  tokenProgram: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
} as const;

const LAMPORTS_PER_SOL = 1_000_000_000;

/** What the stubbed cluster says, and what a test can rewrite before loading a page. */
export type ChainState = {
  /** On-chain owner of the vault. Withdraw is offered only to this address. */
  owner: string;
  paused: boolean;
  solVaultLamports: number;
  /** Base units of devnet USDC sitting in the vault ATA. */
  usdcVaultAmount: string;
  /** Base units of devnet USDC the connected wallet holds. */
  usdcWalletAmount: string;
  /** Every signature the stubbed wallet returns, and what `confirm` says about it. */
  confirmStatus: "confirmed" | "failed" | "timeout";
};

export const DEFAULT_CHAIN: ChainState = {
  owner: ADDR.wallet,
  paused: false,
  solVaultLamports: 2 * LAMPORTS_PER_SOL,
  usdcVaultAmount: "1500000000",
  usdcWalletAmount: "250000000",
  confirmStatus: "confirmed",
};

export type ChainStub = {
  state: ChainState;
  /** Bootstrap stages the stub has handed out, in order; `build-step` walks this list. */
  bootstrapStages: ("treasury" | "policy" | "funding")[];
  /** Requests the browser made to `/api/solana/*`, in order, for assertions. */
  calls: { url: string; method: string; body: unknown }[];
};

const STUB_SIGNATURE =
  "5VERv8NMvzbJMEkV8xnrLkEaWRtSz9CosKDYjCJjBRnbJLgp8uirBgmQpjKhoR4tjF3ZpRzrFmBV6UjKdiSZkQUW";

function vaultAssets(chain: ChainState) {
  return [
    {
      mint: ADDR.nativeMint,
      symbol: "SOL",
      decimals: 9,
      tokenProgram: ADDR.tokenProgram,
      vault: ADDR.solVault,
      amount: String(chain.solVaultLamports),
      exists: true,
      fundingMode: "isolated-vault",
      configured: true,
    },
    {
      mint: ADDR.usdcDevnet,
      symbol: "USDC",
      decimals: 6,
      tokenProgram: ADDR.tokenProgram,
      vault: ADDR.solVault,
      amount: chain.usdcVaultAmount,
      exists: true,
      fundingMode: "isolated-vault",
      configured: true,
    },
  ];
}

function treasuryView(chain: ChainState) {
  return {
    address: ADDR.treasury,
    owner: chain.owner,
    operator: chain.owner,
    paused: chain.paused,
    solVaultAddress: ADDR.solVault,
    solVaultLamports: chain.solVaultLamports,
    activeSessions: 1,
    policyCount: 1,
    mints: [
      {
        mint: ADDR.nativeMint,
        decimals: 9,
        maxPerTx: "100000000",
        maxShortWindow: "1000000000",
        maxLongWindow: "5000000000",
        maxLifetime: "30000000000",
      },
    ],
    policies: [
      {
        address: ADDR.solVault,
        name: "default",
        destinationMode: 1,
        requireMemo: false,
        activeSessions: 1,
        limits: [
          {
            mint: ADDR.nativeMint,
            perTxMax: "50000000",
            shortWindowMax: "500000000",
            shortWindowSeconds: 86_400,
            longWindowMax: "2000000000",
            longWindowSeconds: 604_800,
            lifetimeMax: "15000000000",
          },
        ],
      },
    ],
    sessions: [
      {
        address: ADDR.agentSession,
        label: "payer",
        sessionKey: ADDR.agentSession,
        policy: ADDR.solVault,
        // Far enough out that a slow run never reads as expired.
        expiresAt: Math.floor(Date.now() / 1000) + 86_400,
        revoked: false,
        seq: "3",
        auditHead: "9c4e17bb5af2408da6013e7cd1a50000000000000000000000000000000000ab",
        spend: [
          {
            mint: ADDR.nativeMint,
            shortSpent: "125000000",
            longSpent: "125000000",
            lifetimeSpent: "125000000",
            shortWindowStart: Math.floor(Date.now() / 1000) - 3600,
          },
        ],
      },
    ],
    decimals: { [ADDR.nativeMint]: 9, [ADDR.usdcDevnet]: 6 },
  };
}

/**
 * Fulfils every `/api/solana/*` call in the browser, so no test depends on a
 * cluster being reachable, on devnet holding a particular balance, or on the
 * rate limiter's process-wide bucket. What reaches the server is the JSON store
 * and nothing else.
 */
export async function stubChain(
  page: Page,
  overrides: Partial<ChainState> = {},
): Promise<ChainStub> {
  const stub: ChainStub = {
    state: { ...DEFAULT_CHAIN, ...overrides },
    calls: [],
    bootstrapStages: [],
  };

  await page.route("**/api/solana/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    let body: unknown = null;
    try {
      body = request.postData() ? JSON.parse(request.postData() as string) : null;
    } catch {
      body = request.postData();
    }
    stub.calls.push({ url: url.pathname, method: request.method(), body });

    const json = (payload: unknown, status = 200) =>
      route.fulfill({ status, contentType: "application/json", body: JSON.stringify(payload) });

    switch (url.pathname) {
      case "/api/solana/balances": {
        const addresses = (body as { addresses?: string[] } | null)?.addresses ?? [];
        return json({
          balances: addresses.map((address) => ({ address, lamports: LAMPORTS_PER_SOL })),
        });
      }
      case "/api/solana/vault-balances":
        return json({
          vaults: [
            {
              treasury: ADDR.treasury,
              solVault: ADDR.solVault,
              lamports: stub.state.solVaultLamports,
              owner: stub.state.owner,
              assets: vaultAssets(stub.state),
            },
          ],
          rentExemptMinimum: 890_880,
          ownerTokens: [
            {
              mint: ADDR.usdcDevnet,
              ata: ADDR.agentSession,
              amount: stub.state.usdcWalletAmount,
              exists: true,
            },
          ],
        });
      case "/api/solana/treasury":
        return url.searchParams.get("address") === ADDR.treasury
          ? json(treasuryView(stub.state))
          : json({ error: "treasury not found" }, 404);
      case "/api/solana/price":
        return json({
          usd: 150,
          change24h: 1.5,
          source: "coingecko",
          asOf: new Date().toISOString(),
        });
      case "/api/solana/rpc-health":
        return json({ ok: true, detail: "stubbed cluster", url: "http://127.0.0.1/stub-rpc" });
      case "/api/solana/vault-transfer":
        return json({
          // Not a decodable transaction: the stubbed wallet never parses it,
          // and a real one would be a fixture that expires.
          transaction: Buffer.from("stub-transaction").toString("base64"),
          vault: ADDR.solVault,
          lastValidBlockHeight: 1,
        });
      case "/api/solana/create-session":
        return json({
          session: ADDR.agentSession,
          sessionKey: ADDR.agentSession,
          policy: ADDR.solVault,
          transaction: Buffer.from("stub-create-session").toString("base64"),
          lastValidBlockHeight: 1,
        });
      case "/api/solana/bootstrap/vendors":
        return json({ vendors: [BOOTSTRAP_VENDOR] });
      case "/api/solana/bootstrap/plan":
        return json(bootstrapPlan(body as BootstrapBody));
      case "/api/solana/bootstrap/build-step": {
        const next = BOOTSTRAP_ORDER[stub.bootstrapStages.length];
        if (!next) return json({ done: true, treasury: ADDR.treasury });
        stub.bootstrapStages.push(next);
        const request = body as BootstrapBody;
        return json({
          done: false,
          treasury: ADDR.treasury,
          stepId: next,
          // Only the treasury stage has to be real: the browser decodes it to add the
          // create_key signature. The wallet stub never parses the others.
          transaction:
            next === "treasury" && request.createKey
              ? treasuryStageTransaction(request.wallet, request.createKey)
              : Buffer.from(`stub-${next}`).toString("base64"),
          lastValidBlockHeight: 1,
          needsCreateKeySignature: next === "treasury",
          remaining: BOOTSTRAP_ORDER.length - stub.bootstrapStages.length + 1,
        });
      }
      case "/api/solana/confirm":
        return json({
          signature: STUB_SIGNATURE,
          status: stub.state.confirmStatus,
          ...(stub.state.confirmStatus === "failed"
            ? { error: "custom program error: 0x1771" }
            : {}),
        });
      default:
        return json({ error: `unstubbed solana route: ${url.pathname}` }, 500);
    }
  });

  return stub;
}

/** A payee the stubbed `/bootstrap/vendors` offers, as the VPS catalogs would. */
export const BOOTSTRAP_VENDOR = {
  vendor: "oracle",
  title: "Price oracle",
  label: "oracle",
  owner: "4Qg14cZWVLPXeFFrcaD9cFZEdLX44M4AWfxdHwSiVYeF",
  mintRef: "SOL",
};

const BOOTSTRAP_ORDER = ["treasury", "policy", "funding"] as const;

type BootstrapBody = {
  wallet: string;
  treasury: string | null;
  createKey: string | null;
  session: { key: string } | null;
  depositLamports: string;
};

function bootstrapPlan(body: BootstrapBody) {
  return {
    treasury: ADDR.treasury,
    solVault: ADDR.solVault,
    policy: ADDR.solVault,
    session: body.session ? ADDR.agentSession : null,
    allowlistEntry: null,
    treasuryExists: false,
    steps: BOOTSTRAP_ORDER.map((id) => ({ id, instructions: 2 })),
    deposit: { target: body.depositLamports, held: "0", shortfall: body.depositLamports },
    feeBudget: null,
    walletLamports: String(5 * LAMPORTS_PER_SOL),
    requiredLamports: String(LAMPORTS_PER_SOL),
  };
}

/**
 * A decodable v0 transaction naming the browser's `create_key` as a signer — what the
 * real `build-step` hands back for the treasury stage, minus the instruction data. The
 * browser has to find its key in the signer slots or it refuses to sign.
 */
function treasuryStageTransaction(wallet: string, createKey: string): string {
  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayer(address(wallet), m),
    (m) =>
      setTransactionMessageLifetimeUsingBlockhash(
        { blockhash: ADDR.solVault as never, lastValidBlockHeight: 1n },
        m,
      ),
    (m) =>
      appendTransactionMessageInstructions(
        [
          {
            programAddress: address("11111111111111111111111111111111"),
            accounts: [{ address: address(createKey), role: AccountRole.READONLY_SIGNER }],
          },
        ],
        m,
      ),
  );
  return getBase64EncodedWireTransaction(compileTransaction(message));
}

/**
 * Fulfils every `/api/metrics/*` call in the browser.
 *
 * `stubChain` routes the `/api/solana/` glob and nothing else, so a page calling
 * `/api/metrics/summary` would sail past it, reach the real route handler and open
 * a connection to devnet — exactly what `playwright.config.ts` exists to prevent.
 * Any spec that visits `/metrics` needs this as well as `stubChain`.
 *
 * The payload is folded from the same stubbed treasury `stubChain` serves, so the
 * two cannot drift into describing different vaults.
 */
export async function stubMetrics(page: Page, chain: ChainStub): Promise<void> {
  await page.route("**/api/metrics/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    chain.calls.push({ url: url.pathname, method: request.method(), body: null });

    const json = (payload: unknown, status = 200) =>
      route.fulfill({ status, contentType: "application/json", body: JSON.stringify(payload) });

    if (url.pathname === "/api/metrics/summary") {
      return json(metricsSummary(chain.state, url.searchParams.get("period") ?? "short-window"));
    }
    if (url.pathname === "/api/metrics/destinations") {
      return json({
        contacts: [
          {
            label: "Acme Hosting",
            normalizedLabel: "acme hosting",
            owner: ADDR.wallet,
            entry: ADDR.agentSession,
            policy: ADDR.solVault,
            perTxMaxOverrideRaw: "0",
            paid: null,
            demo: false,
          },
        ],
      });
    }
    if (url.pathname === "/api/metrics/history") {
      return json({
        records: [
          {
            ts: new Date().toISOString(),
            treasury: ADDR.treasury,
            session: ADDR.agentSession,
            policy: ADDR.solVault,
            intent: "9c4e17bb5af2408da6013e7cd1a50001",
            outcome: "settled",
            destination: ADDR.wallet,
            destination_label: "Acme Hosting",
            mint: ADDR.nativeMint,
            amount: "125000000",
            signature: "demo01",
            decimals: 9,
            symbol: "SOL",
            workflow_id: null,
            agent_id: null,
            agent_name: "payer",
            demo: false,
          },
        ],
        complete: false,
        oldestSlot: "302118004",
        truncatedBy: "retention",
        before: null,
        verifiedThrough: { [ADDR.agentSession]: null },
      });
    }
    if (url.pathname === "/api/metrics/history/export") {
      const format = url.searchParams.get("format") ?? "csv";
      const body =
        format === "json"
          ? '[{"intent":"9c4e17bb5af2408da6013e7cd1a50001","outcome":"settled"}]'
          : '"ts","treasury","session","policy","intent","outcome"\n';
      return route.fulfill({
        status: 200,
        headers: {
          "Content-Type": format === "json" ? "application/json" : "text/csv",
          "X-Metrics-Records": "1",
          "X-Metrics-Complete": "false",
        },
        body,
      });
    }
    return json({ error: `unstubbed metrics route: ${url.pathname}` }, 500);
  });
}

/** The fold's output for the stubbed treasury, per period. */
function metricsSummary(chain: ChainState, period: string) {
  // The stubbed session has spent the same amount in all three buckets, so every
  // period reads the same figure. A test that needs them to differ overrides this.
  const spent = "125000000";
  const windowFor = (window: string) =>
    window === "short" ? 86_400 : window === "long" ? 604_800 : null;
  const maxFor = (window: string) =>
    window === "short" ? "500000000" : window === "long" ? "2000000000" : "15000000000";
  const ceilingFor = (window: string) =>
    window === "short" ? "1000000000" : window === "long" ? "5000000000" : "30000000000";

  return {
    asOf: new Date().toISOString(),
    cluster: "devnet",
    scope: { workflowId: null, agentId: null, mint: null },
    period: {
      kind: period,
      seconds: period === "session-life" ? null : period === "long-window" ? 604_800 : 86_400,
      startedAt: period === "short-window" ? Math.floor(Date.now() / 1000) - 3600 : null,
    },
    holdings: {
      assets: [
        {
          raw: String(chain.solVaultLamports),
          mint: ADDR.nativeMint,
          decimals: 9,
          symbol: "SOL",
          usd: (chain.solVaultLamports / 1_000_000_000) * 150,
        },
        {
          raw: chain.usdcVaultAmount,
          mint: ADDR.usdcDevnet,
          decimals: 6,
          symbol: "USDC",
          usd: Number(chain.usdcVaultAmount) / 1_000_000,
        },
      ],
      usd:
        (chain.solVaultLamports / 1_000_000_000) * 150 + Number(chain.usdcVaultAmount) / 1_000_000,
      partial: false,
      excluded: 0,
    },
    spend: {
      byMint: [
        {
          raw: spent,
          mint: ADDR.nativeMint,
          decimals: 9,
          symbol: "SOL",
          usd: (Number(spent) / 1_000_000_000) * 150,
        },
      ],
      usd: (Number(spent) / 1_000_000_000) * 150,
      exactness: "counter",
    },
    payments: { count: 3, lifetimeOnly: true, exactness: "counter" },
    denials: { count: null, byReason: {}, exactness: "unavailable" },
    headroom: ["short", "long", "lifetime"].map((window) => ({
      mint: ADDR.nativeMint,
      decimals: 9,
      symbol: "SOL",
      policy: ADDR.solVault,
      policyName: "default",
      window,
      windowSeconds: windowFor(window),
      spentRaw: "125000000",
      policyMaxRaw: maxFor(window),
      ceilingRaw: ceilingFor(window),
      unlimited: false,
    })),
    policies: [{ address: ADDR.solVault, name: "default", destinationMode: 1, requireMemo: false }],
    price: { usd: 150, change24h: 1.5, source: "coingecko", asOf: new Date().toISOString() },
    integrity: [
      {
        session: ADDR.agentSession,
        label: "payer",
        seq: "3",
        auditHead: "9c4e17bb5af2408da6013e7cd1a50000000000000000000000000000000000ab",
        verifiedThroughSeq: null,
        revoked: false,
        expiresAt: Math.floor(Date.now() / 1000) + 86_400,
      },
    ],
    unreadable: [],
  };
}

/**
 * The chat panel asks the server which providers exist and then streams from
 * `/api/chat`. Both are stubbed: the real route spawns the local Claude CLI
 * when it is installed, which is neither deterministic nor free.
 */
export async function stubChat(page: Page, reply = "Stubbed answer."): Promise<void> {
  await page.route("**/api/chat/providers", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        providers: [
          {
            id: "demo",
            label: t("providers.demo.label"),
            available: true,
            detail: t("providers.demo.detail"),
            models: [{ id: "demo", label: t("providers.model.demo") }],
          },
        ],
      }),
    }),
  );
  await page.route("**/api/chat", (route) =>
    route.fulfill({ status: 200, contentType: "text/plain; charset=utf-8", body: reply }),
  );
}

/**
 * A Phantom-shaped provider on `window`, injected before any script runs so the
 * header's eager `connect({ onlyIfTrusted: true })` finds it on first paint.
 *
 * `request({ method: "signAndSendTransaction" })` is the entry point
 * `signAndSendTransaction` in `lib/solana.ts` prefers, so stubbing that one
 * covers the path the dashboard actually takes. `rejectSigning` drives the
 * other branch the UI has to handle: a user who clicks "reject" in the wallet.
 */
export async function stubWallet(
  page: Page,
  options: { address?: string; rejectSigning?: boolean; trusted?: boolean } = {},
): Promise<void> {
  const address = options.address ?? ADDR.wallet;
  const rejectSigning = options.rejectSigning ?? false;
  const trusted = options.trusted ?? true;

  await page.addInitScript(
    ({ address, rejectSigning, trusted, signature }) => {
      const key = { toBase58: () => address };
      const provider = {
        isPhantom: true,
        publicKey: trusted ? key : null,
        connect: async (opts?: { onlyIfTrusted?: boolean }) => {
          if (opts?.onlyIfTrusted && !trusted) throw new Error("not trusted");
          provider.publicKey = key;
          return { publicKey: key };
        },
        disconnect: async () => {
          provider.publicKey = null;
        },
        on: () => {},
        removeListener: () => {},
        signMessage: async (message: Uint8Array) => message,
        request: async ({ method, params }: { method: string; params?: unknown }) => {
          if (method !== "signAndSendTransaction") throw new Error(`unstubbed: ${method}`);
          if (rejectSigning) throw new Error("User rejected the request.");
          // Kept for tests that assert what the dashboard asked the wallet to sign.
          const w = window as unknown as { __signed?: unknown[] };
          w.__signed = [...(w.__signed ?? []), params];
          return { signature };
        },
      };
      Object.defineProperty(window, "phantom", { value: { solana: provider }, writable: true });
    },
    { address, rejectSigning, trusted, signature: STUB_SIGNATURE },
  );
}

/**
 * Clicks a button that opens a dialog, and waits for the dialog to actually be
 * there before returning.
 *
 * Not defensive padding: the pages are server-rendered, so the button exists in
 * the HTML before React has attached a handler to it. A click that lands in
 * that window is swallowed silently, which is a flake in a suite and a real
 * missed tap for a user on a slow connection.
 */
export async function clickUntil(button: Locator, expected: Locator): Promise<void> {
  await expect(button).toBeEnabled();
  await expect(async () => {
    await button.click();
    await expect(expected).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 20_000 });
}

/** The same, for the common case of a button that opens a dialog with a field in it. */
export async function openDialog(page: Page, buttonName: string, field: string): Promise<void> {
  await clickUntil(page.getByRole("button", { name: buttonName }).first(), page.locator(field));
}

/**
 * Restores the seeded store before each test. The server holds one JSON
 * document for the whole run, so isolation is this call, not a fresh process.
 */
async function resetStore(baseURL: string): Promise<void> {
  const response = await fetch(new URL("/api/state", baseURL), {
    method: "DELETE",
    headers: { origin: baseURL, "content-type": "application/json" },
  });
  if (!response.ok) {
    throw new Error(`could not reset the dashboard store: ${response.status}`);
  }
}

export const test = base.extend<{ freshStore: undefined }>({
  freshStore: [
    async ({ baseURL }, use) => {
      await resetStore(baseURL as string);
      await use(undefined);
    },
    { auto: true },
  ],
});

export { expect };

/**
 * Seeds a row straight through the API rather than through the UI, for tests
 * whose subject is a later screen. The origin header is not decoration: every
 * mutating route checks it, and in production there is no implicit localhost
 * allowlist to fall back on.
 */
export async function createRow(
  baseURL: string,
  resource: "workflows" | "agents" | "mcps" | "skills",
  fields: Record<string, unknown>,
): Promise<{ id: string }> {
  const response = await fetch(new URL(`/api/state/${resource}`, baseURL), {
    method: "POST",
    headers: { origin: baseURL, "content-type": "application/json" },
    body: JSON.stringify(fields),
  });
  if (!response.ok) {
    throw new Error(`could not seed ${resource}: ${response.status} ${await response.text()}`);
  }
  return (await response.json()).created as { id: string };
}

/** A workflow wired to the stubbed treasury, which is what the money screens need. */
export async function createOnChainWorkflow(baseURL: string, name = "Vault Under Test") {
  return createRow(baseURL, "workflows", {
    name,
    description: "wired to the stubbed treasury",
    icon: "🏦",
    cluster: "devnet",
    ownerAddress: ADDR.wallet,
    treasuryAddress: ADDR.treasury,
    demo: false,
    demoBalanceUsd: null,
  });
}
