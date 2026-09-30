# Simple shell: sign in → add balance → ask

> **Superseded (2026-10-01).** `/` is chat beside the workflows panel again, and the top bar
> carries only the client's money: balance (BRL in Brazil, USD elsewhere), **Deposit** and
> **Withdraw**. The simple/operator shell modes and `NEXT_PUBLIC_DASHBOARD_SHELL` are gone;
> `/advanced` redirects to `/`. Deposits and withdrawals are in
> `docs/runbooks/chat-credit-billing.md`. Kept below as the record of what shipped in #86.

Status: implemented on `feat/simple-shell` (2026-09-30). Prompt 4 of the hosted-chat series:
Prompt 1 metering is billing, #81. Prompt 3 covers deposit rails and is not built yet.

## Why

The hackathon story has a single happy path: *entrar → colocar dinheiro → perguntar*. The
dashboard's old `/` opened on a chat next to a workflows panel. Its header carried a cluster
picker, a payment-mode switch, the SOL price and a wallet button, which is operator framing
someone who came to ask a question does not need. The whiteboard draws a chat with a model
selector, and puts the power features (WORKFLOWS, AGENTS, WALLETS, ACCOUNT) behind navigation. This
change makes that the default. It removes nothing: every operator route is still in the
sidebar, one click away.

## Before / after

| | Before | After |
|---|---|---|
| `/` | Chat + workflows split, resizable | Balance strip, chat, and the last 5 ledger movements |
| Operator home | `/` | `/advanced` (and `/` again with `NEXT_PUBLIC_DASHBOARD_SHELL=operator`) |
| Header on `/` | Cluster, payment mode, SOL ticker, wallet button | Signed-in label, credit balance, **Add balance** |
| Header elsewhere | Same as above | Unchanged: the operator controls are all still there |
| Sidebar | 5 flat groups (Home, Operation, Money, Tools, Account) | **Simple** (Chat, Balance, Account), then a collapsible **Advanced** section (Workflows, Agents, Wallets, Settings) |
| Wallet required for first use | No, but the header offered it first | No, and it is not offered on the simple routes |
| Chat out of credit | Error text: "add credit on the Account page" | Error text and an **Add balance** button inside the refused reply |
| Where to see the balance | Account page card | `/balance`: balance, deposit section, full statement. The Account card is kept and links to it |
| Empty balance | Nothing until a message was refused | "Add balance to get started" banner above the chat, linking to the deposit section |

Details:

- **The Advanced section** starts collapsed. The open/closed state is persisted (`advancedNavOpen`).
  It opens by itself, and cannot be collapsed, while the current route is one of its pages, so
  the page you are on never disappears from the nav.
- **Pro badges** appear on Treasury and Wallets. Both need an external wallet, which ADR-024 makes
  a Pro feature on hosted accounts. The badge shows only when `/api/account/wallet` says the
  viewer is *not* entitled. It is hidden while that is loading, for Pro accounts, and in local
  mode. The routes stay open; the badge informs, it does not gate.
- **Billing off** (local JSON mode, where `/api/billing` answers `enabled: false`): `/` is just the
  chat. No balance strip, no header pill, no extrato. `/balance` says billing is off on this server.
- **Deposit section** (`/balance#add`): PIX and Solana Pay (USDC) are listed, disabled, and marked
  "Soon". Until Prompt 3 lands, credit comes from the starter grant or a manual operator top-up
  (`docs/runbooks/chat-credit-billing.md`). No route a user can call adds credit, and that is
  deliberate: a rail must arrive as a verified callback that appends a `deposit` row.
- **"Magic happens" copy**: the balance strip says each reply is paid from the balance and that
  on-chain agent payments stay within the limits you set. This is stub copy for the future slice.
  Nothing on-chain is wired to the chat balance.

## Branch shape

The work needs both stacks, so `feat/simple-shell` is cut from `feat/email-login-platform-wallet`
(#85, email sign-in without a wallet). It then merges:

1. `feat/workstation-shell` (#84's HEAD, fd3d9b1). #85 was cut before that commit.
2. `feat/chat-credit-billing` (#81, which brings #80 OpenRouter). This merge had conflicts in
   `account/page.tsx` and both locale files. They were resolved by keeping #85's account layout,
   adding the credit card to it, and dropping #81's `account.walletSeparateNote`, which #85
   had removed.

One **semantic conflict** did not show up as a text conflict: #85 changed
`resolvePostgresContext()` to return `{ kind: "ok" | "anonymous" | "unprovisioned" }`, while
#81's `resolveBillingScope()` still read `ctx.orgId`. That broke the typecheck.
`meter.ts` now bills only `kind: "ok"`; an unprovisioned account is refused the same way as a
signed-out one. Whichever of #81 / #85 merges second needs this fix.

The PR's base is #85's branch, so its diff includes #84's last commit, #80 and #81 until those
merge.

## Constraints kept

- No change to `programs/agent_rails`, the policy crate, the IDL, or `packages/mcp`. The agent
  tool surface is untouched.
- This is presentation, not privilege. Every advanced route is reachable by URL, as before, and
  keeps its own server checks. The simple shell only stops *showing* operator controls first.
- The operator flows did not regress. `/advanced` is the old `/` (same component). The flag
  restores the old `/`, and every other route renders exactly as before. The full Playwright
  suite passes.

## Configuration

| Var | Values | Effect |
|---|---|---|
| `NEXT_PUBLIC_DASHBOARD_SHELL` | unset / `simple` (default), `operator` | What `/` renders; `operator` also drops the redundant "Overview" nav entry. **Inlined at build time**: reading it per request would make every dashboard route dynamic just to pick a nav layout. |

The Playwright config pins both `NEXT_PUBLIC_DASHBOARD_SHELL` and `BILLING_ENABLED` to blank, so a
developer's `.env.local` cannot change what the suite sees.

## Files

New:

- `packages/dashboard/src/lib/shell.ts` (+ `shell.test.ts`): shell mode, `isSimpleRoute`,
  `balanceState` (`off | empty | negative | funded`), `LEDGER_PREVIEW = 5`
- `packages/dashboard/src/components/home/simple-home.tsx`: the new `/`
- `packages/dashboard/src/app/(dashboard)/advanced/page.tsx`: the old `/`
- `packages/dashboard/src/app/(dashboard)/balance/page.tsx`: Saldo: balance, deposit section, statement
- `packages/dashboard/src/components/billing/ledger-list.tsx`: extrato rows, extracted from `credit-card.tsx`; `compact` for home
- `packages/dashboard/src/components/billing/balance-pill.tsx`: header balance for simple routes
- `packages/dashboard/src/components/billing/add-balance-button.tsx`: the one CTA, always `/balance#add`
- `packages/dashboard/src/components/layout/nav-items.test.ts`
- `packages/dashboard/e2e/simple-shell.spec.ts`

Changed:

- `components/layout/nav-items.ts`: two tiers, `navTierDefs(mode)`, `isActiveHref` (segment match), `isAdvancedPath`
- `components/layout/sidebar.tsx`: Simple, then the collapsible Advanced section, plus Pro badges
- `components/layout/header.tsx`, `dashboard-shell.tsx`: shell-aware header
- `components/chat/chat-panel.tsx`: Add-balance button on a 402 `insufficient_credit` reply
- `components/billing/credit-card.tsx`: uses `LedgerList`; links to add balance
- `app/(dashboard)/page.tsx`: picks `SimpleHome` or `HomeLayout`
- `stores/app-store.ts`: `advancedNavOpen`
- `lib/server/billing/meter.ts`: the merge fix above
- `i18n/locales/{en,pt-BR}.json`: `nav.*` tier keys and `balance.*`; `chat.error.addCredit` now points at the balance; unused `nav.home/operation/money/tools` removed
- `e2e/fixtures.ts` (`stubBilling`), `e2e/smoke.spec.ts` (`/` → no wallet needed, `/advanced`, `/balance`), `playwright.config.ts`
- `.env.example`, `docs/product/dashboard-page-flows.pt-BR.md`

## Verification

- `tsc --noEmit`, Biome: clean.
- Vitest (dashboard): 49 files / 441 tests pass, including 13 new ones in `shell` and `nav-items`.
- Playwright (`scripts/verify.sh ui` equivalent, production build): the full suite passed, 56
  tests including the 5 new `simple-shell` specs. One smoke spec was fixed during the run: its
  sidebar walk must start on routes under Advanced.

## Manual QA and screenshots

Run `pnpm dashboard` (or the hosted build). For the balance surfaces, local mode needs
`BILLING_ENABLED=true`; for a starter credit, add `BILLING_STARTER_CREDIT_USD=0.50`.

1. **Signed-out** (hosted): open `/`. You are sent to sign in, and the email form is the first option.
   Screenshot: `01-sign-in.png`.
2. **Fresh account, no starter credit**: `/` shows a red $0.00 balance, the "Add balance to get
   started" banner, and the header pill with a filled **Add balance** button. There is no cluster
   badge and no Connect button. Screenshot: `02-empty.png` (desktop 1280px) and
   `02-empty-mobile.png` (390px; the extrato column is hidden and the header pill remains).
3. Click **Add balance**. It lands on `/balance#add`, with the PIX / Solana Pay rows marked
   "Soon". Screenshot: `03-deposit.png`.
4. **Top up by hand** (runbook SQL), then reload `/`. The balance is green, the banner is gone,
   and the extrato shows the deposit. Send a message; after the reply the balance drops and a
   new "Assistant reply" row appears at the top. Screenshot: `04-after-reply.png`.
5. **Drain the balance** (or top up only a few cents) and send a message. The reply shows the error and an
   **Add balance** button. Screenshot: `05-refused.png`.
6. **Advanced**: the section is collapsed on `/`. Open it and go to Treasury. The header switches
   back to cluster / mode / SOL / wallet, and on a free hosted account Treasury and Wallets show a
   "Pro" badge. Screenshot: `06-advanced.png`.
7. **`/advanced`**: the old chat + workflows split, with the resize toolbar working.
   Screenshot: `07-overview.png`.
8. **Operator build**: rebuild with `NEXT_PUBLIC_DASHBOARD_SHELL=operator`. `/` is the split
   again, and the "Overview" nav entry is gone.
9. **pt-BR**: switch the locale in Settings and repeat 2–3. The copy should read "Adicionar saldo",
   "Adicione saldo para começar", "Extrato".

## Open follow-ups

- Prompt 3: the deposit rails (PIX, Solana Pay), which replace the disabled rows in `/balance#add`.
- An unprovisioned account gets a 401 from `/api/billing`, rather than the missing-account
  response `requirePostgresContext` gives. The same holds for chat.
- The model selector is still the chat panel's footer select. The whiteboard puts it at the top.
