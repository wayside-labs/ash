# Session log — 2026-09-30: prepaid credit billing for the hosted assistant

This log records what was built and the decisions made along the way that a reader would
otherwise have to reconstruct from the diff. The branch is `feat/chat-credit-billing` in
worktree `../ash-wt-billing`. It is cut from `feat/openrouter-chat` (PR #80) and is
**uncommitted** at the time of writing. The operator reference is
`docs/runbooks/chat-credit-billing.md`. The last section is a handoff for the next prompt
(deposits: Solana Pay + PIX).

## The question that started it

A hackathon mentor call reviewed every accelerated Colosseum company and found that all of
them earn from *intermediation*: sitting in a flow and taking a spread, not a flat SaaS
fee. Applied to the hosted chat, that means no subscription with a token cap. Instead the
user holds a prepaid balance, pays the model cost plus about 20% per request, and can set
everything up for free until the first paid run. The same call proposed two more things.
The first is to hide Web3: email login by default, with wallet connect as a Pro feature,
in the style of conta.vc. The second is funding the balance through **Solana Pay and
PIX**.

The user turned the call into four Claude Code prompts in the Role → Task → Context →
Reasoning → Stop conditions → Output format:

1. Usage billing + prepaid balance (**this session**)
2. Email-first login + embedded wallet, with wallet connect as Pro
3. Add balance: Solana Pay + PIX, two rails into one balance (**next, in another agent**)
4. A Conta-simple shell: login → balance → chat

## Where the work lives, and why there

- The main checkout (`feat/adr021-wave2a-bootstrap`) carries a large amount of unrelated
  uncommitted work (connector layer, workstation templates). Billing was kept out of it.
- Metering only makes sense on the path where the operator pays, which is the
  `openrouter-platform` provider from PR #80. That PR is not merged into `main`, so the new
  branch is **stacked on `feat/openrouter-chat`**. Merge #80 first. Retarget the child PR
  before deleting the parent branch, because `--delete-branch` closes stacked children.

## What was built

| Layer | File | What |
|---|---|---|
| Pure math | `packages/dashboard/src/lib/billing.ts` | micro-USD units, `parseMarkupBps`, `chargeFor` (fee rounds up), `worstCaseChargeMicros`, `creditsToMicros`, `formatMicros`. Client-safe. |
| Ledger | `src/lib/server/billing/ledger.ts` | `LedgerStore` with a Postgres backend (service role) and a JSON backend (`~/.ash/billing.json`); `append` is idempotent |
| Meter | `src/lib/server/billing/meter.ts` | `billingConfig`, `resolveBillingScope`, `currentBalance` (lazy starter grant), `preflight`, `claimTurn`, `priceTurn`, `debitTurn` |
| OpenRouter | `src/lib/server/llm/openrouter-api.ts` | `OPENROUTER_PRICES` (list prices from live `/api/v1/models`), `OPENROUTER_MAX_TOKENS`, and an `onUsage` callback for the final usage chunk |
| Chat route | `src/app/api/chat/route.ts` | pre-flight 402/401/409/503 before the model runs; a `metered()` wrapper debits in `finally` before the response closes |
| Read API | `src/app/api/billing/route.ts` | `GET` balance + last 50 entries. Read-only: no route adds credit |
| UI | `src/components/billing/credit-card.tsx`, `src/hooks/use-billing.ts`, `account/page.tsx`, `chat-panel.tsx` | "Assistant credit" card on Account; a chat hint on 402; the balance refetches after each turn |
| DB | `supabase/migrations/20260930020000_credit_ledger.sql` | `credit_ledger` (append-only), `credit_balance(org_id)`, RLS select-only |
| i18n | `en.json`, `pt-BR.json` | `billing.*`, `llm.error.insufficientCredit` / `turnInProgress` / `billingUnavailable`, `chat.error.addCredit` |
| Docs | `docs/runbooks/chat-credit-billing.md`, dashboard `README.md` § Credit billing, `.env.example` | design, env, manual top-up SQL, test plan |

## Decisions, and why

### Meter only the platform key

`anthropic-api` and `claude-cli` spend the user's own key or subscription, and demo costs
nothing. Charging a markup on those would be taking a fee on someone else's bill.

### Hybrid, not subscription-only

Variable cost (tokens) is charged as usage + margin. A subscription can come later for
stable value (teams, SLA, compliance), but not as the only way to get tokens. The
defaults are a markup of 2000 bps and **no** starter credit, so the operator has to opt in
to giving money away.

### Integer micro-USD everywhere

That is `bigint` in Postgres and safe integers in TS. OpenRouter's per-token prices for
both allowlisted models are whole micros (Sonnet 5.5: 2 in / 10 out; Haiku 4.5: 1 / 5).
The fee is rounded **up**, so a stream of tiny turns cannot each round its fee to zero.
`BILLING_MARKUP_BPS` above 10000 throws, which catches the "20000 for 20%" typo that
would bill 3× the model cost.

### The org pays, not the account

The tenancy schema already hangs work off the org ("if two members would need to see it,
it is the org's"), and a shared team balance is what multi-member exists for.
`account_id` records who spent.

### Pre-flight against the worst case, not just `balance > 0`

Prompt 1 only asked to block at `balance ≤ 0`. That still allows an overdraft of one full
turn every time. The route refuses unless the balance covers the full 8192-token output
plus the prompt sized pessimistically at 2 characters per token, with markup. The cost is
that a small balance cannot send a message: $0.05 was refused on both models in the smoke
test, because the worst case is about $0.06 on Haiku and $0.11–0.12 on Sonnet. This is
documented next to `BILLING_STARTER_CREDIT_USD`.

### One metered turn per payer at a time

Without this, N parallel requests each pass the pre-flight against the same balance. The
lock is in-process, like `rate-limit.ts`, so on serverless the bound is one worst-case turn
per warm instance. That overdraft shows up as a negative balance that blocks the next turn.
The real fix is an atomic hold/settle in a Postgres function, deferred until deposits make
real money flow.

### Charge what OpenRouter charged us

OpenRouter now always sends `usage` (with `cost` in credits) on the last SSE chunk. The
`usage: {include: true}` flag is deprecated and a no-op, so it is not sent. The fallbacks
are ordered:

1. `usage.cost` present → measured.
2. Token counts but no cost → list price, `estimated`.
3. No usage chunk but text was produced (client abort, mid-stream error) → list price on
   characters ÷ 3, `estimated`. OpenRouter still bills us for those tokens.
4. Nothing produced and nothing reported → no charge.

The `/api/v1/generation?id=` lookup was considered for case 3 and deferred: more network
code, and the result is not immediately available.

### Debit before the response closes

The `metered()` generator awaits the debit in its `finally`, inside `textStream`'s loop, so
a serverless function cannot freeze between "reply sent" and "debit written". A failed
debit write is logged as `turn not charged` rather than surfaced, because the reply
already went out.

### Fail closed

If the ledger cannot be read, the route returns 503 instead of serving. An allowlisted
model with no entry in `OPENROUTER_PRICES` also gets a 503, and a test asserts that every
allowlisted model is priced.

### The ledger is not user-writable

RLS grants org members select only. There are no insert, update or delete policies, the
same pattern as the tenancy tables' "no insert policy" rule. All writes go through the
service role. The check constraint ties the sign of `amount_micros` to the `kind`, and
`idempotency_key` is unique, so a replay returns `23505` and is treated as a no-op. There
is no HTTP route that mints credit. Until deposits exist, the operator tops up by SQL
(runbook).

### Hosted is always metered; local is opt-in

With Supabase configured, billing cannot be switched off: the platform key serves
strangers there. In local JSON mode it is the operator's own key, so `BILLING_ENABLED=true`
opts in. That is also how the flow is tested without Supabase.

### Separate from on-chain treasuries

ASH treasuries govern what agents pay vendors, in the vault, under program rules.
This ledger is what the dashboard charges for its own assistant. Nothing touches
`programs/ash`, MCP or the SDK, and the program remains fee-free, which keeps the
open-source/grant story intact.

## Verification

- `tsc --noEmit` and `biome check` are clean, and `next build` succeeds.
- `pnpm --filter @ash/dashboard exec vitest run`: **209 passed**, including the new
  tests:
  - `src/lib/billing.test.ts`: markup parsing and typo refusal, exact decimal conversion,
    fee rounding, float-noise handling, worst case, formatting.
  - `src/lib/server/billing/meter.test.ts`: `priceTurn` fallbacks, `preflight`, `claimTurn`,
    `billingConfig`, and the JSON ledger end to end (the starter grant happens once, the
    debit is idempotent, a zero-cost turn writes nothing, a negative balance is not
    re-granted).
  - `src/app/api/chat/route.test.ts`: 402 on empty and on insufficient balance, 401 with no
    org, 503 on ledger failure, a debit after a completed stream and after a failed one,
    the lock released after a turn, 409 on a concurrent turn, and non-platform paths
    unmetered.
  - `openrouter-api.test.ts`: the usage chunk is reported once, never without one, and every
    allowlisted model is priced.
- Local smoke against `next start` with a fake key (`BILLING_ENABLED=true`, scratch
  `ASH_HOME`):
  - $0.05 of starter credit got a 402 on Haiku ("up to $0.06") and on Sonnet ("up to
    $0.11").
  - $1 of credit with an upstream 401 got a localized error, no debit, and a second turn
    that was not locked.
  - An orphaned `next-server` from a first attempt ran without `ALLOWED_ORIGINS` and
    produced misleading 403s. Kill the child process, not just the `env` wrapper.
- **Not verified:**
  - A real debit from a live OpenRouter call (no account yet).
  - The migration against Supabase (not applied).
  - `scripts/verify.sh ui` was not run.

## Open after this session

- [ ] Commit and open a PR stacked on #80.
- [ ] Apply `20260930020000_credit_ledger.sql` (`supabase db push`, **not** `config push`).
      Hosted platform chat returns 503 until this is done.
- [ ] Live smoke with a real key: one message, then check that the debit ≈ OpenRouter
      activity × 1.2.
- [ ] Atomic hold/settle in Postgres, to close the cross-instance overdraft.
- [ ] `complete.ts` (wave 2A canvas generator) is neither on the platform provider nor
      metered.
- [ ] A balance in the chat header (prompt 4).

## Handoff: prompt 3 (Solana Pay + PIX deposits)

What the deposit work can build on, and the constraints already settled here:

- **Branch from `feat/chat-credit-billing`**, not `main` and not the wave-2A checkout. The
  ledger, meter and Account card exist only there. Run `pnpm install` in any new worktree,
  since worktrees do not share `node_modules`.
- **A deposit is one ledger row.** Call
  `ledgerFor(scope).append(scope, { kind: "deposit", amountMicros, note, idempotencyKey })`
  from `src/lib/server/billing/ledger.ts`. The `deposit` kind and its `amount_micros >= 0`
  check already exist in the migration. Do not add a second balance table.
- **Idempotency key = the rail's own transaction id**: `solana-pay:<signature>` for Solana
  Pay, `pix:<endToEndId or PSP tx id>` for PIX. `append` returns `false` on a replay, which
  makes webhook retries safe for free.
- **Credit only from a verified source.** That means the on-chain transaction confirmed
  and validated server-side (Solana Pay `reference` key → `findReference` →
  `validateTransfer` for recipient, amount and mint), or a PIX webhook whose signature is
  verified. Never credit from a client request: the migration's security model is "no user
  session can write the ledger", and a deposit route that trusts the body would undo it.
- **Resolve the org from the session** (`resolveBillingScope()`) when the deposit intent is
  created, and store it on a pending-deposit record keyed by the Solana Pay `reference` or
  the PIX charge id. A webhook has no session, so it must look the org up from that
  record, never from the payload.
- **Every new mutating route calls `assertSameOrigin(req)`**, which
  `route-guard.test.ts` enforces. A PIX webhook is cross-origin by nature, so it needs a
  deliberate, documented exception (signature verification in place of the origin check)
  and an edit to that test.
- **Currency.** The ledger is USD micros. A BRL deposit needs an explicit conversion rate
  recorded on the row, for example in `note` or a new column added by a new migration.
  Never edit `20260930020000`.
- **i18n** in both `en.json` and `pt-BR.json`. The user-facing label is "Adicionar saldo".
- **Docs the user asked the next agent to read in full before implementing Solana Pay:**
  `https://docs.hel.io/docs/introduction`. Note that Helio is a hosted payments provider
  built on Solana Pay, not the protocol spec itself. Compare it with the open Solana Pay
  spec (`https://docs.solanapay.com`) and choose on purpose: Helio brings hosted checkout
  and webhooks, while raw Solana Pay means no third party but self-verification on-chain.
- **Out of scope for deposits:** nothing touches `programs/ash`, MCP tools or the
  SDK. Funding an agent's treasury vault is a different flow from funding chat credit.
