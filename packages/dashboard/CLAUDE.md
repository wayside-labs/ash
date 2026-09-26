# packages/dashboard

The hosted operator surface (ADR-017, ADR-021). It reads the chain and submits transactions
the connected wallet is allowed to sign — starting with owner vault transfer and operator
session lifecycle (wave 1).

## Rules specific to this package

- **This is an operator surface, not the agent surface.** Privileged instructions belong here
  and in `packages/cli`, never in `packages/mcp`. `src/lib/server/privileged-surface.test.ts`
  allowlists which instruction builders this tree may import; expanding it is deliberate and
  ADR-backed.
- **MCP must not escalate.** Chat tools stay read-only. Session creation in the dashboard is
  for humans with an operator/owner wallet connected, not for the model.
- **Session keys are client-held.** Generate in the browser, deliver via download + MCP snippet.
  Never persist a session private key in `dashboard.json`, Supabase, or API responses.
- **The program decides who may act, not the workflow row.** Withdraw is gated on the
  *on-chain* owner from `/api/solana/vault-balances`. Session create is gated on operator or
  owner from the treasury account, same as CLI.
- **Every mutating route calls `assertSameOrigin` itself.** `route-guard.test.ts` enumerates
  the routes and fails on one that forgot; a `middleware.ts` would not hold for the handler
  tests, which call `POST(new Request(...))` directly.
- **Secrets leave the server masked or not at all.** `maskState` is applied on every read
  *and* on the echo of a create. Two Playwright tests watch the wire for the raw value.
- Two storage backends behind one switch: Supabase when the public env vars are set,
  `~/.agent-rails/dashboard.json` otherwise. The JSON branch cannot work on serverless — see
  `docs/runbooks/deploy-vercel.md`.

### Wave 1 scope (ADR-021)

- Import/sync on-chain `AgentSession` into agent cards (`sessionAddress`, `walletAddress`).
- `POST /api/solana/create-session` — build unsigned tx; browser signs; confirm.
- Post-create modal: download keypair + copy MCP config.
- Full treasury bootstrap wizard is **out of scope** until after 2026-10-10; point at CLI
  `init` when `treasuryAddress` is missing.

## Tests

Two layers, both offline:

```bash
pnpm --filter @agent-rails/dashboard test        # vitest: route handlers, guards, pure helpers
scripts/verify.sh ui                             # playwright: the browser against a real Next server
```

`scripts/verify.sh ui` builds the workspace dependencies, then `next build && next start` on
port 3210. For iteration, `PW_DEV=1 pnpm --filter @agent-rails/dashboard test:e2e` swaps in
the dev server; leaving one running on 3210 is reused rather than restarted.

### What the UI suite may and may not touch

- **No cluster.** `e2e/fixtures.ts` fulfils every `/api/solana/*` call inside the browser.
  A test that needs a validator belongs in `packages/e2e`, on surfpool.
- **Not your store.** `AGENT_RAILS_HOME` points at `packages/dashboard/.playwright/home`, and
  the `freshStore` fixture resets it before each test. Never remove that redirect: the suite
  deletes state, and the default path is the operator's own workflows and API keys.
- **No Supabase.** The config blanks the public env vars so `store.ts` takes the JSON branch
  even when a developer has a `.env.local`.
- Selectors come from `src/i18n/locales/en.json` through `t()`, so a reworded button fails at
  the key instead of silently matching nothing. Ids (`#wf-name`) and `data-testid` are the
  handles for anything a name alone cannot address; a bare `getByText` usually also matches
  the toast that announced it.
- Pages are server-rendered, so a button exists before React attaches its handler. Click
  through `clickUntil` / `openDialog` rather than adding a sleep.
