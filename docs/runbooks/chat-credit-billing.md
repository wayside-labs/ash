# Chat credit billing (hosted assistant)

**Status:** implemented on `feat/chat-credit-billing`, stacked on `feat/openrouter-chat` (PR #80).
**Scope:** `packages/dashboard` only. Nothing here touches `programs/agent_rails`, the MCP
server or the SDK, and the program still charges no fee of any kind.

## What it is

A prepaid, usage-priced meter on the one chat path where the operator pays: the
`openrouter-platform` provider. There is no subscription and no bundle of tokens. Each org
holds a balance. Each reply debits:

```
total = raw_cost + ceil(raw_cost × BILLING_MARKUP_BPS / 10 000)
```

Here `raw_cost` is what OpenRouter says it charged (`usage.cost` on the stream's last
chunk). The markup is the service fee, 20% by default. A subscription tier for teams or an
SLA can come later on top of this. It should not be the only way to buy tokens.

| Path | Metered? | Why |
|---|---|---|
| `openrouter-platform` | yes | operator's key, operator's money |
| `anthropic-api`, `claude-cli` | no | the user's own key or subscription |
| `demo` | no | costs nothing |

## Relation to on-chain treasuries

These are two separate meters, and they should stay separate:

- **Agent Rails treasuries** govern what *agents* pay *vendors*. That money sits in a
  program-owned vault and moves only under policy, session and ceiling rules.
- **This ledger** is what the *dashboard* charges for its own assistant. It is off-chain,
  the program never sees it, and it holds no user funds on-chain.

A future deposit rail (Solana Pay, PIX) may fund both from one wallet. Even then, a chat
debit must never become an instruction in the program.

## Money

- Everything is **integer micro-USD** (`bigint` in Postgres, safe integers in TS). No float
  ever touches a balance. `src/lib/billing.ts` holds all the arithmetic, and it is pure and
  unit-tested.
- The markup **rounds up**, so no reply is fee-free by rounding.
- `BILLING_MARKUP_BPS` above 10000 refuses to parse. This catches the "20000 for 20%" typo,
  which would otherwise bill 3× the model cost.

## The turn

1. `/api/chat` resolves `openrouter-platform` and checks platform access, as in PR #80.
2. **Scope:** the caller's org (hosted) or the single local ledger. A hosted session with no
   org gets **401**.
3. **Balance:** the ledger sum. If the org has never received the starter credit and its
   balance is not positive, the grant is inserted first. It is idempotent on
   `starter:<org>`.
4. **Pre-flight:** the turn is refused with **402** `{code: "insufficient_credit"}` unless
   the balance covers the *worst case*. That is the full `max_tokens` output (8192) plus the
   prompt sized at 2 characters per token, with markup, at the model's list price
   (`OPENROUTER_PRICES`).
5. **One turn per payer at a time.** A second concurrent turn gets **409**.
6. Stream. When the stream ends for any reason (done, upstream error, client abort), the
   `finally` block prices the turn and appends a `chat_debit` *before* the response closes,
   so a serverless function cannot freeze before the write.
   - A `usage.cost` was reported: that value is charged, marked measured.
   - Token counts came without a cost: list price is charged, marked `estimated`.
   - No usage chunk arrived but text was produced (an abort): list price on
     characters ÷ 3, marked `estimated`. OpenRouter still bills us for those tokens.
   - Nothing was produced and nothing was reported: no charge.
7. If the ledger can't be read, the route returns **503** and fails closed. If the debit
   write fails after the reply went out, it is logged as `turn not charged`.

### The overdraft bound

The pre-flight check and the single-turn lock are both **per instance**, like
`rate-limit.ts`. On serverless, N warm instances can each run one turn for the same org at
once. So the worst overdraft is one worst-case turn (about $0.12 on Sonnet 5.5) per
concurrent instance. It is recorded honestly as a negative balance, and that blocks the next
turn. The fix for a tighter bound is an atomic hold (reserve, then settle) in a Postgres
function. That is deferred until deposits make real money flow.

## Storage

Migration `packages/dashboard/supabase/migrations/20260930020000_credit_ledger.sql`:

- `credit_ledger` is append-only. The kinds are `starter_grant | deposit | chat_debit |
  adjustment`, and a check constraint ties the sign of `amount_micros` to the kind.
- `idempotency_key` is unique. A replay is a no-op, not a second row.
- **RLS gives org members select access only.** There is no insert, update or delete
  policy, which means a user session cannot mint credit. All writes go through the service
  role (`SUPABASE_SERVICE_ROLE_KEY`, which is already required for bootstrap).
- `credit_balance(org_id)` sums the ledger in the database.

Local JSON mode (`BILLING_ENABLED=true`) writes `~/.agent-rails/billing.json`, next to
`dashboard.json` rather than inside it, because the state document is editable through
the UI.

**Apply the migration before deploying.** Hosted chat on the platform key returns 503
without it. Use `supabase db push` (migrations only), not `supabase config push`, which
applies everything `config.toml` declares.

## Environment

| Variable | Default | Notes |
|---|---|---|
| `BILLING_ENABLED` | off locally | Ignored when Supabase is configured: hosted is always metered. |
| `BILLING_MARKUP_BPS` | `2000` | Integer from 0 to 10000. |
| `BILLING_STARTER_CREDIT_USD` | none | Granted once per org. Below one worst-case reply (~$0.06 on Haiku 4.5, ~$0.12 on Sonnet 5.5) it grants credit no message can use. Every new Google account farms it, so keep it small. |
| `SOLANA_PAY_RECIPIENT` | none | The operator's own wallet; its USDC token account receives deposits. Unset turns the deposit rail off (the modal says so). |
| `SOLANA_PAY_CLUSTER` | `mainnet-beta` | `devnet` takes Circle's devnet USDC, which has no value — for trying the flow only. |
| `SOLANA_PAY_RPC_URL` | public RPC | A dedicated RPC for the deposit check (`getSignaturesForAddress` + `getTransaction`). |
| `SOLANA_PAY_FEE_PAYER_KEY` | none | The platform's fee wallet, as `solana-keygen`'s 64-byte JSON array. Set: **Pay with &lt;wallet&gt;** appears and the platform pays that payment's network fee, and the fee wallet opens the recipient's USDC account on the first deposit request. Unset: the QR alone, where the customer's wallet pays the fee, and the recipient's USDC account must exist already. Keep a few dollars of SOL in it and nothing else — it is a hot key. |

## Deposits (Solana Pay USDC)

The top bar's **Deposit** opens a modal whose rails follow the viewer's region: `CF-IPCountry`
from the Cloudflare tunnel, else the browser's time zone and language. Brazil sees PIX (listed
as coming soon: no PSP is integrated) and USDC; everyone else sees USDC.

1. `POST /api/billing/deposits {amountUsd}` stores an intent in `credit_deposit_intents` with a
   random one-time `reference` and returns a `solana:` transfer request (shown as a QR and an
   "open in wallet" link).
2. The modal polls `POST /api/billing/deposits/<id>/check`. The server finds transactions by the
   reference (`finalized` only) and measures what reached `SOLANA_PAY_RECIPIENT`'s USDC token
   accounts from the token balances, not from the instructions.
3. What arrived is appended as a `deposit` row keyed `solana-pay:<signature>`, and the intent
   is marked confirmed with that signature (unique). A second poll, a second tab or a second
   intent citing the same transaction credits nothing more.

USDC has 6 decimals, so one base unit is one micro-USD: no price is read at deposit time.

**The QR is always a transfer request.** It used to be a transaction request
(`solana:https://<host>/api/billing/deposits/<id>/tx`) so the platform could pay the fee.
Phantom's in-app scanner answers one with "not a valid address" — encoded or not — and never
fetches the link: Phantom opens transaction requests only from a tapped link or the phone's
camera app. The route logged no wallet GET at all while devnet deposits were being tried
(2026-10-01). A transfer request is read by every wallet's scanner; the payer's wallet pays a
network fee of a fraction of a cent.

**Network fee covered: Pay with &lt;wallet&gt;.** With `SOLANA_PAY_FEE_PAYER_KEY` set, the modal
offers the connected wallet. The order is the one Phantom asks for when a transaction has more
than one signer — the wallet first, everyone else after — because a wallet may add instructions
(Lighthouse assertions, a compute budget) and a signature taken earlier would no longer match:

1. `POST /api/billing/deposits/<id>/pay {account}` returns the transfer **unsigned**, with the
   fee wallet as fee payer: create the recipient's USDC account if missing, then
   `transferChecked` of exactly the intent's amount with the reference attached.
2. The browser has the wallet sign it through the Wallet Standard (`solana:signTransaction`),
   without sending it.
3. `POST /api/billing/deposits/<id>/submit {transaction}` checks what came back before the fee
   wallet signs anything (`verifySponsoredDeposit`): exactly two signers, the fee wallet first and
   still unsigned, a valid customer signature, the two instructions above and nothing else
   except a compute budget under a priority-fee cap and Lighthouse assertions that never name
   the fee wallet. Then it adds the fee wallet's signature and sends it with preflight on, to
   the deposit's own cluster — whatever network the wallet happens to be set to.

Both routes take the session and the caller's own pending intent; no route signs anything for a
caller without one. Credit still lands only through `check`. Each deposit costs the fee wallet
~0.00001 SOL (two signatures), plus ~0.002 SOL once for the recipient's USDC account.

**Customer-facing wording.** The customer path (top bar, deposit, withdraw, chat, balance,
account) never names a chain: the option reads "Crypto wallet", the currency USDC. Wallet
cards live on Advanced › Wallets.

## Withdrawals (paid by hand)

**Withdraw** records a request in `credit_withdrawal_requests` and, in the same step, appends a
`withdrawal` ledger row for the amount, so held credit cannot also be spent in chat. Nothing is
sent automatically. The operator pays out and closes the request in the SQL editor:

```sql
-- Paid: send the USDC or the PIX, then:
update public.credit_withdrawal_requests
set status = 'paid', resolved_at = now(), note = '<tx signature or PIX end-to-end id>'
where id = '<request uuid>' and status = 'pending';

-- Declined: give the held amount back, then close it.
insert into public.credit_ledger (org_id, kind, amount_micros, note, idempotency_key)
select org_id, 'adjustment', amount_micros, 'withdrawal declined: ' || id, 'withdrawal-refund:' || id
from public.credit_withdrawal_requests where id = '<request uuid>' and status = 'pending';
update public.credit_withdrawal_requests
set status = 'rejected', resolved_at = now(), note = '<reason>'
where id = '<request uuid>' and status = 'pending';
```

Pending requests: `select * from public.credit_withdrawal_requests where status = 'pending' order by created_at;`

## Granting credit by hand

No HTTP route mints credit. An operator can still grant it in the Supabase SQL editor, which
runs as the service role:

```sql
insert into public.credit_ledger (org_id, kind, amount_micros, note, idempotency_key)
values ('<org uuid>', 'adjustment', 5000000, 'manual top-up: $5', 'manual:<org>:<yyyymmdd>:<n>');
```

To find an org by email, join `profiles.email → memberships.account_id → org_id`.

## Test plan

- [x] `pnpm --filter @agent-rails/dashboard exec vitest run src/lib/billing.test.ts
      src/lib/server/billing src/app/api/chat src/lib/server/llm/openrouter-api.test.ts`
      covers the math, pricing fallbacks, the starter grant, idempotency, 402/401/409/503,
      a debit after a completed stream and after a failed one, and that every
      allowlisted model is priced.
- [x] Local smoke with a fake key: a starter credit of $0.05 gets a 402 on both models with a
      localized amount; at $1 an upstream failure before any output charges nothing and
      does not lock the next turn.
- [ ] With a real `OPENROUTER_API_KEY`: set `BILLING_ENABLED=true
      BILLING_STARTER_CREDIT_USD=1`, send one message, and check that Account → Assistant
      credit shows a debit with tokens and a "model + fee" breakdown matching the OpenRouter
      activity page × 1.2.
- [ ] Hosted: apply the migration, grant credit with the SQL above, send one message, and
      confirm the row as the signed-in user through the Supabase REST API (RLS read works,
      insert is refused).

## Deferred

- An atomic hold / settle in Postgres, to close the cross-instance overdraft.
- A fallback to the `/api/v1/generation?id=` lookup for aborted streams, instead of the
  character estimate.
- PIX deposits and payouts through a PSP (Mercado Pago, Efí, …): a verified webhook appending a
  `deposit` row keyed by the end-to-end id.
- Automatic withdrawal payouts.
