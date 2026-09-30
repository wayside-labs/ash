import { defineConfig, devices } from "@playwright/test";

/**
 * Layer 4 of the ADR-008 pyramid, for the dashboard: a browser against a real
 * Next server, with the chain stubbed at the network boundary.
 *
 * Two guarantees this file exists to make, because a UI suite that gets either
 * wrong is worse than no suite at all:
 *
 *  - **It never touches `~/.agent-rails/dashboard.json`.** `AGENT_RAILS_HOME`
 *    repoints the JSON store, so a run cannot delete the operator's real
 *    workflows — or read their API keys — on its way to a green tick.
 *  - **It never reaches a cluster.** Blanking the Supabase vars forces
 *    `store.ts` down the JSON branch (no tenant, no auth), and `stubChain` in
 *    `e2e/fixtures.ts` fulfils every `/api/solana/*` call inside the browser.
 *    A test that needs the chain belongs in `packages/e2e`, on surfpool.
 */

const HOST = "127.0.0.1";
/** Not 3000: `pnpm dashboard` owns that, and a suite must not adopt it. */
const PORT = Number(process.env.PW_PORT ?? 3210);
const BASE_URL = `http://${HOST}:${PORT}`;

/**
 * `next build && next start` by default, because production is where the origin
 * guard stops trusting localhost implicitly and where the Supabase vars are
 * inlined — both are things this suite asserts. `PW_DEV=1` swaps in the dev
 * server for iteration, at the cost of per-route compiles on first hit.
 */
const webServerCommand = process.env.PW_DEV
  ? `pnpm exec next dev --port ${PORT} --hostname ${HOST}`
  : `pnpm exec next build && pnpm exec next start --port ${PORT} --hostname ${HOST}`;

export default defineConfig({
  testDir: "./e2e",
  outputDir: "./.playwright/results",
  fullyParallel: false,
  // The JSON store is one file and the rate limiter is one process-wide bucket;
  // parallel workers would race on both. Serial is not a placeholder here.
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["list"]] : [["list"]],
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: webServerCommand,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 300_000,
    stdout: "pipe",
    stderr: "pipe",
    env: {
      AGENT_RAILS_HOME: new URL("./.playwright/home", import.meta.url).pathname,
      // Production drops the implicit localhost allowlist, so the suite's own
      // origin has to be declared or every mutating route answers 403.
      ALLOWED_ORIGINS: BASE_URL,
      // Blank, not absent: a developer's .env.local would otherwise put the run
      // on their real Supabase project. `supabaseUrl()` trims, so "" is unset.
      NEXT_PUBLIC_SUPABASE_URL: "",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "",
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "",
      SUPABASE_SERVICE_ROLE_KEY: "",
      // Chat is stubbed in the browser; this keeps a stray key from being spent
      // if a test ever reaches the real route.
      ANTHROPIC_API_KEY: "",
      // Both pinned so a developer's .env.local cannot flip what `/` renders or start
      // metering the chat; specs that need a balance stub `/api/billing` instead.
      NEXT_PUBLIC_DASHBOARD_SHELL: "",
      BILLING_ENABLED: "",
    },
  },
});
