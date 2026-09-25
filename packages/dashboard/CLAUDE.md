# packages/dashboard

The hosted operator surface (ADR-017). It reads the chain, and writes to it in exactly one
place: the owner moving funds in and out of their own vault.

## Rules specific to this package

- **This is the operator surface's read half, plus `withdraw`.** Ceilings, policy, sessions,
  allowlists and pause belong to `packages/cli`. `src/lib/server/privileged-surface.test.ts`
  enumerates the instruction builders this tree may import and fails on any other — adding a
  "raise the limit" button here means editing that list, which is the point.
- **The program decides who may withdraw, not the workflow row.** The button is gated on the
  *on-chain* `owner` returned by `/api/solana/vault-balances`, never on the address the
  dashboard stored when the workflow was created.
- **Every mutating route calls `assertSameOrigin` itself.** `route-guard.test.ts` enumerates
  the routes and fails on one that forgot; a `middleware.ts` would not hold for the handler
  tests, which call `POST(new Request(...))` directly.
- **Secrets leave the server masked or not at all.** `maskState` is applied on every read
  *and* on the echo of a create. Two Playwright tests watch the wire for the raw value.
- Two storage backends behind one switch: Supabase when the public env vars are set,
  `~/.agent-rails/dashboard.json` otherwise. The JSON branch cannot work on serverless — see
  `docs/runbooks/deploy-vercel.md`.

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
