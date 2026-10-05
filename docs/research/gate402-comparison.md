# ASH ↔ Gate402 / Metera — Comparative Analysis

**Date:** 2026-09-14
**Subject repo:** `https://github.com/joaopco8/gate402_` (cloned to `/home/dev0xcf02/projects/solana/gate402_`, `master` @ `fa183d3`)
**Our repo:** `ash`, branch `feature/ts-sdk` @ `95ec615`
**Scope:** read-only analysis. No code was changed in either repository.

---

## 0. TL;DR

Both projects sit in the same market — *money rails for autonomous AI agents on Solana* — and both converge on the same two interface choices: **USDC on Solana** as the settlement asset and **MCP** as the agent-facing surface. Beyond that they are near-opposites in architecture and in what they are actually trying to guarantee.

| | **ASH (ours)** | **Gate402 / Metera (theirs)** |
|---|---|---|
| Core question | *"Can this agent be trusted to spend?"* | *"Can this API get paid by an agent?"* |
| Direction of money | Treasury → agent → vendor (**outbound spend control**) | Agent → API provider (**inbound revenue collection**) |
| Enforcement | **On-chain Anchor program** (`4qjD6vSgYa3o…`) | **Off-chain Express + Postgres + Redis**, on-chain only for verification |
| Trust model | Trust-minimized: limits, allowlists, idempotency, kill switch are program-enforced | Trusted operator: the Metera server is the policy authority |
| Protocol | Custom `PaymentIntent` instruction | [x402](https://x402.org) HTTP 402 standard |
| Product shape | Library / protocol (SDK, MCP, CLI). Explicit non-goal: "no hosted service, no dashboard" | Full SaaS: Next.js dashboard, marketplace, billing, Stripe, auth, blog |
| Revenue model | None encoded — it is a framework | Subscription tiers ($0 / $29 / $99 / custom) + credit metering + per-call markup |
| Size | ~12.5k Rust + ~3k hand-written TS (+13.6k generated) | ~102k TS/TSX |
| Maturity | Program surface complete (22 ix, 150 tests), SDK/MCP in progress | Shipping product, live at gate402.dev / metera.xyz, npm packages published |
| License | Apache-2.0 (LICENSE present) | MIT per README + 4 package.jsons — **but no LICENSE file in the repo** |

**Verdict:** they are *complements, not competitors*. Gate402 is a plausible **consumer** of ASH: an agent paying x402 invoices is exactly the workload that wants a policy-bounded treasury behind it. Nothing in their codebase threatens ours, and about **eight discrete pieces are worth stealing ideas from** (§9) — mostly in operational hardening, DX, and the off-chain layers we deliberately left thin.

---

## 1. What each project is

### 1.1 ASH

A guardrail and treasury framework. Owners deposit into a program-owned vault; an *operator* defines a `Policy` (per-tx / short-window / long-window / lifetime limits, destination allowlists, mint allowlists) bounded by owner-set *ceilings*; agents receive time-boxed `AgentSession`s and pay through a single `execute_payment` instruction that the program refuses unless every rule holds.

The distinguishing claim, from `ARCHITECTURE.md` §1: *a fully compromised agent — leaked key, prompt injection, buggy retry loop — can lose at most what the policy allows in the current windows.* That guarantee is produced by the chain, not by a proxy. Four principals (owner / operator / guardian / session) with **loosening flowing downhill only**; a per-session SHA-256 audit hash chain; idempotency by `IntentReceipt` PDA `init`; zero external program dependencies beyond SPL Token / ATA / System.

Current state: Anchor program complete (22 instructions, LiteSVM tests across `admin/budget/layout/lifecycle/operator/payments/treasury`), pure `ash-policy` crate with proptests + audit vectors, Codama-generated Kit client, and a TS SDK + stdio MCP server mid-build (`get_session`, `get_policy`, `check_payment`, `execute_payment` landed).

### 1.2 Gate402 / Metera

Billing infrastructure for AI agents — the *provider* side. Drop-in Express middleware returns HTTP 402 with a Solana payment request; the agent pays USDC; the middleware verifies on-chain and forwards the request. Two npm packages (`gate402` provider middleware, `gate402-agent` paying client) plus a full commercial platform around them.

Note the repo is **mid-rebrand**: the code, README and npm names say *Gate402*; the assets, env vars, comments and newer packages say *Metera* (`metera.xyz`, `METERA_TREASURY_WALLET`, `MeteraMiddleware`, `@metera/m1`). `apps/dashboard/_legacy/` holds three superseded generations of the marketing site (`v2/`, `v3/`), so a meaningful fraction of the 102k LOC is dead weight.

What is actually in there, beyond the README's three-box story:

- `apps/server` — Express API: x402 middleware, 50+ route modules, 26 Prisma models, Redis caching, BullMQ workers, Stripe billing, Supabase auth, Privy wallets, Squads v4 multisig provisioning, OFAC screening, SSRF guard, proof anchoring, a Merkle batcher, an agent planner/interviewer, and ~10 white-labelled MCP proxies (Apify, Exa, Firecrawl, Serper, Tavily, ElevenLabs, Gemini…).
- `apps/dashboard` — Next.js 15 marketing site + dashboard + docs + blog + careers + marketplace.
- `packages/m1` — a separate research engine ("Metera M1"): Bayesian posterior estimation, multi-source consensus/verification levels (L1/L2/L3), adversarial simulation, independence measurement. Frozen (`FREEZE.md`). Unrelated to payments; it is a *data-truth* product.
- `packages/{sdk, sdk-agent, mcp-server, mcp-client, create-gate402-mcp}` — the published surface.

---

## 2. Structure — repository layout side by side

### 2.1 ASH

```
ash/                       pnpm@10.6.5 workspace + Cargo workspace + turbo
├── Anchor.toml                    anchor 1.1.2, localnet, test = cargo test --workspace
├── Cargo.toml                     workspace: crates/*, programs/*
│                                  release profile: overflow-checks, lto=fat, codegen-units=1
├── ARCHITECTURE.md                the frozen v1 design baseline
├── docs/
│   ├── adr/ADR-001..011           one decision per file, the reasoning of record
│   └── spec/accounts-and-instructions.md   byte-level account + instruction contract
├── idl/ash.json           built artifact, checked in, source for codegen
├── programs/ash/          Anchor program — 22 instructions, thin handlers
│   ├── src/{state,args,error,events,validation,constants}.rs
│   ├── src/instructions/*.rs      one file per instruction
│   └── tests/{admin,budget,layout,lifecycle,operator,payments,treasury}.rs  (LiteSVM)
├── crates/ash-policy/     pure no_std policy arithmetic
│   ├── src/{engine,audit,types,error}.rs
│   └── tests/{proptests,audit_vectors}.rs
└── packages/
    ├── contract/                  Zod schemas, reason codes, events — the shared truth
    ├── client/src/generated/      Codama output, never hand-edited (13.6k LOC)
    ├── sdk/                       Kit plugin: intent builder, preflight, hooks, errors
    └── mcp/                       stdio MCP server: 4 tools, handlers + schemas split
```

Planned but **not yet present**: `packages/{indexer,cli,adapters/*}`, `python/`, `trident-tests/`, `examples/`, `audits/`, `.github/`, `THREAT_MODEL.md`, `GOVERNANCE.md`, `SECURITY.md`.

### 2.2 Gate402 / Metera

```
gate402_/                          npm workspaces (apps/*, packages/*)
├── apps/
│   ├── server/                    Express API — the whole system really lives here
│   │   ├── prisma/schema.prisma   26 models + hand-written SQL migrations
│   │   ├── src/routes/            ~52 route modules
│   │   ├── src/lib/               ~80 modules — the de-facto domain layer
│   │   ├── src/middleware/        x402, auth, plan, rateLimiter, metrics, requireAdmin
│   │   ├── src/services/          spendingLimits, agentKill, collector
│   │   ├── src/mcp/               8 white-label MCP servers
│   │   ├── src/workers/           BullMQ collectWorker
│   │   ├── src/__tests__/         ~40 Jest files
│   │   └── scripts/               ~40 one-shot devnet / probe / seed scripts
│   ├── dashboard/                 Next.js 15 App Router
│   │   ├── src/app/               ~110 route + component files (marketing, docs, dash)
│   │   ├── src/components/ui/     ~35 components
│   │   └── _legacy/               ~60 files: three dead generations of the site
│   └── mcp-demo/                  Claude Desktop demo server
├── packages/
│   ├── sdk/                       `gate402` — provider middleware
│   ├── sdk-agent/                 `gate402-agent` — paying client
│   ├── mcp-server/                MeteraMiddleware for MCP tool calls
│   ├── mcp-client/                paying MCP client
│   ├── create-gate402-mcp/        `npx` scaffolder
│   └── m1/                        frozen research engine (unrelated to payments)
├── docker-compose.yml             postgres only
├── vercel.json / railway.toml     dashboard deploy config
└── .github/workflows/e2e.yml      the only workflow
```

### 2.3 What the layouts tell you

| Dimension | ASH | Gate402 |
|---|---|---|
| Organising principle | **By trust boundary** — program / pure core / generated client / SDK / agent surface | **By deployment unit** — server app, web app, published packages |
| Where the rules live | `crates/ash-policy` (one crate, ~1.5k LOC, fuzzed) | Spread across `lib/`, `services/`, `middleware/`, Prisma defaults, and Supabase RPCs |
| Generated vs. hand-written | Hard line: `src/generated/` is Codama output, `codegen:check` enforces it in CI | None; all hand-written against web3.js v1 |
| Spec artefacts | ADRs + byte-level spec + IDL, all versioned | `DESIGN.md` is a *visual* design token file, not a system spec |
| Dead code | None | `_legacy/` (~60 files), `_disabled.page.tsx`, `minha-api/`, loose CSVs and PNGs at repo root |
| Docs location | In-repo (`docs/`) | In the product (`apps/dashboard/src/app/docs/*`) — docs are a shipped page, not a file |
| Test placement | Colocated per layer, Rust-first | `src/__tests__/` in the server only, plus Python Selenium in `tests/e2e/` |

The instructive contrast: **their structure optimises for shipping a product, ours optimises for auditing a guarantee.** Their `lib/` folder with 80 flat modules is what a domain layer looks like without a spec to anchor it; our ADR-per-decision layout is what a spec looks like without a product to pull it. Each is the other's blind spot.

---

## 3. Architecture

### 3.1 Layer-by-layer

| Layer | ASH | Gate402 / Metera |
|---|---|---|
| **Agent-facing** | `@ash/mcp` (stdio), 4 tools, no privilege-escalating tool exists | `packages/mcp-client`, `sdk-agent`, plus 8 hosted MCP proxies; `x402Middleware` on every route |
| **Contract / schema** | `@ash/contract` — Zod, single source for MCP tools, events, reason codes | None. Types are duplicated per package (`PaymentProof` in `mcp-server/types.ts`, again in `mcp-client/types.ts`) |
| **Client** | `@ash/client` — Codama-generated from the IDL | Hand-written `@solana/web3.js` v1 calls scattered through `lib/` |
| **Policy / decision** | `ash-policy` crate — pure, `no_std`, `forbid(unsafe_code)`, proptested | `services/spendingLimits.ts` + `lib/planPolicy.ts` + `middleware/plan.ts` + Prisma columns |
| **State** | PDAs: `Treasury`, `Policy`, `AllowlistEntry`, `AgentSession`, `IntentReceipt` | Postgres (26 models) + Redis (counters, caches, rate limits) + Supabase (credits via RPC) |
| **Custody** | None. Vault is a program-owned PDA + ATAs; `sol_vault` for native SOL | Server holds keys (`SOLANA_WALLET_PRIVATE_KEY`); Privy provisions agent wallets |
| **Settlement** | `transfer_checked` CPI to SPL Token / Token-2022, or System transfer from `sol_vault` | Agent sends USDC directly; server *verifies* the tx hash after the fact |
| **Audit** | `emit_cpi!` events + per-session SHA-256 hash chain (`seq`, `audit_head`) | Postgres tables (`AgentCall`, `RevenueLog`, `AdminAuditLog`, `DepositAuditLog`) + Merkle-batched on-chain anchoring of proof leaves |
| **Kill switch** | `pause` (owner or guardian) blocks `execute_payment` only; `revoke_session` (operator) | `killAgent()` — terminal status + key-hash null, one Postgres statement |

### 3.2 The payment path, contrasted

**ASH** — one transaction, one program instruction, one CPI:

```
agent → check_payment (simulate)      … no state change, no signature
agent → execute_payment(PaymentIntent)
          program: not paused? session signer, active, unexpired?
          program: mint ∈ treasury? limit slot ∈ policy? destination allowed?
          program: init IntentReceipt ← fails on duplicate intent_id
          policy crate: rollover windows, check per-tx / short / long / lifetime
          CPI: transfer_checked(vault → destination ATA)
          program: counters += , seq += 1, audit_head = H(…)
          emit_cpi PaymentExecuted
```

Budget targets: ≤40k CU, ≤600 bytes legacy addressing. Every refusal is an Anchor error code the SDK maps to a stable `reason_code`.

**Gate402** — request/response across two systems, verification *after* payment:

```
agent → GET /api/x           (no X-Payment-Payload header)
server → 402 { price, payTo, network, splits, quickstart }
agent → sends USDC on Solana itself (its own key, its own tx)
agent → GET /api/x           (X-Payment-Payload: <txHash>)
server: resolveAgentWalletId(header) → checkEndpointAccess → checkSpendingLimits
server: checkIdempotency(txHash) → verifyPayment(txHash, amount, recipient, recency)
server: markUsed(txHash) → recordSpending() → logRevenue() → next()
handler → 200
```

Three structural consequences:

1. **The money moves before the policy is checked.** Their limit check runs on the *retry*, against a payment that already landed on-chain. A blocked call means the agent has paid and been refused — recoverable only by an off-chain refund. Our program checks *then* transfers, atomically, in one instruction.
2. **A tx hash is a bearer token.** `verifyPayment` + `checkIdempotency` is exactly the right defence, and they implement it carefully (including the check→mark race), but the security rests on that pair being correct in application code. Ours rests on `init` failing on a duplicate PDA.
3. **Verification is retrospective and network-dependent.** They must re-read the chain per call; we never leave the transaction.

### 3.3 The enforcement boundary — the fundamental split

Ours is the whole point of the project: **the program refuses.** A compromised ASH operator key cannot raise a ceiling, cannot withdraw, cannot unpause. In Gate402, `checkSpendingLimits()` is a function in a Node process reading Redis; anyone with access to that process, that Redis, or that Postgres can raise any limit.

This is not a criticism of them — a billing SaaS legitimately *is* the trusted party for its own revenue. But it means their limit code is **reference material, never an implementation we can adopt into the enforcement path.** Anything we borrow from it lands in the SDK's soft `PolicyHook` layer (ARCHITECTURE §6, "defense in depth"), which is explicitly documented as *not the guarantee*.

The one exception is `lib/squads.ts`, which does exactly what our ARCHITECTURE §3 anticipates ("owners who want M-of-N control set `owner` to a Squads or Realms PDA"): a 4-transaction setup that creates a Squads v4 multisig, adds an on-chain USDC spending limit, raises the threshold to 2, then **nulls the config authority** (`PublicKey.default` as the impossible-to-sign sentinel) so neither the agent nor Metera can unilaterally change it. That is their one genuinely trust-minimized path — and it is essentially a hand-rolled, single-mint version of what our program does natively. Read it as validation of the thesis.

### 3.4 Failure semantics

| Situation | ASH | Gate402 |
|---|---|---|
| Redis down | N/A — no Redis in the enforcement path | `checkSpendingLimits` **silently skips** the hour/day/month checks (`if (redis)`); `slidingWindowRateLimit` returns `allowed: true`. Fails **open** |
| Postgres down | N/A | Nothing works; the policy authority is unreachable |
| RPC down | Payment fails to submit — no money moves | `verifyPayment` fails → the agent's already-sent payment is not credited |
| Duplicate intent / tx | Account `init` fails before the transfer | `checkIdempotency` catches it; the unique-constraint race is handled as a replay |
| Policy hook unavailable | **Currently unspecified** — see §9.4 | `unavailable` is an explicit fourth state in their OFAC matcher, but not in `spendingLimits` |

Fail-open under Redis loss is the sharpest architectural difference in operational terms, and it is inherent to putting the counters in a cache instead of in consensus.

---

## 4. Business rules

### 4.1 ASH — the rules *are* the product, and they are all on-chain

There is **no monetisation logic anywhere in the repo**. ASH does not take a fee, does not meter, and has no notion of a plan, a customer, or a balance owed. Its "business rules" are the authorization rules the program enforces:

**Roles and separation of powers** (`ARCHITECTURE.md` §3)

| Role | Temperature | Can | Cannot |
|---|---|---|---|
| Owner | Cold | Withdraw anything, anywhere, **even while paused**; rotate owner/operator; manage guardians; add/remove mints; set ceilings; pause; unpause; close treasury | Execute agent payments |
| Operator | Warm | Create/update/close policies **within the ceiling**; manage allowlist entries; create/revoke/close sessions | Withdraw; raise ceilings; add mints; change roles; pause; unpause |
| Guardian (≤5) | Hot | Pause | Everything else — notably cannot unpause |
| Session | Hot | `execute_payment` within policy + session window | Any configuration change |

Invariants: **loosening flows downhill only**; **pause is an agent kill switch, not an owner lock** (owner withdrawal always works — it is the emergency exit); **two independent stops** (any guardian pauses, the operator revokes) with only the owner able to clear a pause.

**Limit rules, per policy, per mint slot (max 4 mints)**

| Rule | Field | Semantics |
|---|---|---|
| Single payment cap | `per_tx_max` | Hard ceiling on one payment |
| Velocity | `short_window_max` / `short_window_seconds` | e.g. per hour |
| Budget | `long_window_max` / `long_window_seconds` | e.g. per day |
| Task allowance | `lifetime_max` | Total a *session* may ever spend of this mint. `u64::MAX` = unlimited, still ceiling-bounded |
| Reserved v1.1 | `approval_threshold`, `cooldown_seconds` | Must be zero in v1 |

Windows are **fixed epoch buckets** — `window_start` advances by whole multiples of `window_seconds`; rolling windows were rejected in ADR-005 as needing ring buffers that cost CU and resist fuzzing.

**The ceiling partial order** — `update_policy` asserts `Policy ≤ Ceiling` per mint slot: all four caps `≤`, both window durations `≥` (a longer window at the same cap is *tighter*), `destination_mode == Any` only if `treasury.allow_any_destination`, `create_destination_ata` only if the treasury permits it.

**Hard-coded bounds** (`programs/ash/src/constants.rs`)

| Constant | Value | Rule it encodes |
|---|---|---|
| `MAX_GUARDIANS` | 5 | |
| `MAX_MINTS` | 4 | Per treasury and per policy |
| `MAX_MEMO_LEN` | 64 bytes | |
| `MAX_NAME_LEN` | 32 bytes | Policy names and allowlist labels, zero-padded UTF-8 |
| `MIN_INTENT_TTL_SECONDS` | 5 | No pre-expired intents |
| `MAX_INTENT_TTL_SECONDS` | 3600 | A stale intent cannot be retried later |
| `RECEIPT_GRACE_SECONDS` | 3600 | `close_receipt` is permissionless after expiry + grace; rent → `fee_payer` |
| `MAX_SESSION_TTL_SECONDS` | 31 536 000 | 365-day cap on `create_session` |

**Token surface rules** (ADR-010): Token-2022 extensions **rejected** — `TransferHook`, `ConfidentialTransfer`, `NonTransferable`. **Allowed** — `TransferFee` (limits apply to the amount *debited from the vault*), `MetadataPointer`/`TokenMetadata`, `InterestBearing`, `DefaultAccountState`, `PermanentDelegate` (CLI warns). The token program id is stored per mint and asserted at payment time.

### 4.2 Gate402 / Metera — the rules are commercial, and they are all off-chain

Four distinct and partly overlapping rule systems:

**(a) Subscription tiers** — `apps/server/src/lib/plans.ts`, a frozen object read by the gateway, Stripe, and the pricing page:

| | Free | Starter $29 | Pro $99 | Enterprise |
|---|---|---|---|---|
| Proxy endpoints | 3 | 10 | ∞ | ∞ |
| Agent wallets | 1 | 5 | 20 | ∞ |
| Calls visible | 5 | 20 | 50 | ∞ |
| Analytics retention | 7d | 30d | 90d | ∞ |
| CSV export / MRR / percentiles | ✗ | ✗ | ✓ | ✓ |
| MCP servers / tool calls per month | 1 / 100 | 5 / 500 | ∞ / ∞ | ∞ / ∞ |
| **Squads protection** | ✗ | ✓ | ✓ | ✓ |
| White-label / verified badge | ✗ | ✗ | ✗ | ✓ |

Notable as a business rule: **on-chain multisig protection is a paid feature**, gated behind $29/mo. In our model the equivalent guarantee is unconditional and free, because it is the program.

**(b) Credit metering** — `lib/planPolicy.ts`, described in-file as "the SINGLE source of truth for pricing, credit grants, rate limits, and the fan-out / L3 gates … so the page can never promise something the code does not enforce."

- `CREDIT_USD = 0.001` — one credit is a tenth of a cent, fixed; everything derives from it.
- Debit is **cost-based, not flat**: `sourceUsdCost(sourceId, nativeCredits)` looks up the real upstream price (SocialCrawl $0.0031/credit, Webacy $0.005/CU, Apify $0.0002/call, head sources $0.0001), applies `MARKUP = 1.3`, and `creditsForUsd()` does `max(1, ceil(usd * 1.3 / 0.001))`.
- The `ceil` and the floor of 1 are deliberate: "never charges below cost", and "a projection that ignores [the floor] understates an hourly price agent by three orders of magnitude."
- `SOURCE_WEIGHT = { head: 1, tail: 3 }` — consensus across paid/scraped sources costs more because it costs *them* more. Fan-out sums the weight of every independent source consulted.
- Upstream prices that are not publicly published are **env vars with a deliberately high default** (`WEBACY_USD_PER_CU`), because guessing low charges below cost on every call.

**(c) Per-agent spending limits** — `services/spendingLimits.ts`, Redis-counted, calendar-bucketed:

| Rule | Code | Enforcement |
|---|---|---|
| Wallet inactive | `WALLET_INACTIVE` | DB flag |
| Per-call cap | `MAX_PER_CALL_EXCEEDED` | DB column, checked directly |
| Hourly / daily / monthly | `MAX_PER_HOUR/DAY/MONTH_EXCEEDED` | Redis `incrbyfloat` on `agent:{id}:spent:{bucket}` with TTL 2h / 48h / 62d |
| Endpoint blocklist | `ENDPOINT_BLOCKED` | prefix match, checked **before** the allowlist |
| Endpoint allowlist | `ENDPOINT_NOT_ALLOWED` | prefix match, only applied when non-empty |

Limits are cached in Redis for 5 minutes, so a tightened limit takes up to 5 minutes to bite. There is **no lifetime/task allowance** — `maxPerMonth` is the longest horizon, which cannot express "give this agent $500 for this one job."

**(d) Automatic kill rules** — `services/agentKill.ts`, evaluated after each call, never blocking the response:

| Trigger | Condition |
|---|---|
| `onBudgetExhausted` | `spent ≥ budgetTotalCredits` |
| `onErrorRate` | ≥10 recent calls and ≥50% errors |
| `onAnomalousSpend` | `spentToday ≥ 3 × budgetPerDayCredits` — "the day budget is already a hard 402 at the gate; 3× only happens if something upstream is broken — that anomaly is a kill, not a wait" |

`killed` is **terminal by design** — no reactivation route exists anywhere in the codebase; resurrecting means cloning into a new agent.

**(e) Revenue split** — currently `platformFee = 0`, "fee disabled — 100% goes to provider" (`middleware/x402.ts`). Revenue comes from subscriptions and credit markup, not from a cut of each payment. `revenueLog.ts` carries a frank "REVENUE DEBT (2/3)" comment: `RevenueLog` and `ProxyEndpoint.totalEarned` can diverge and are reconciled later — two ledgers of the same money, a classic consequence of accounting in an application database.

### 4.3 Business-rule comparison

| Axis | ASH | Gate402 |
|---|---|---|
| Who the rules protect | The **treasury owner**, from their own agent | The **platform**, from underpriced usage; and the provider, from unpaid calls |
| Where the rules live | Program + one pure crate | `plans.ts` + `planPolicy.ts` + `spendingLimits.ts` + `agentKill.ts` + Prisma + Supabase RPC |
| Who can change them | Owner (ceilings) → operator (policy). Never the agent | Anyone with server/DB access |
| How fast a tightening applies | Next transaction | Up to 5 min (Redis limit cache) |
| Monetisation | None | Tiers + credits + 1.3× markup |
| Longest budget horizon | **Lifetime, per session** | Month, per wallet |
| Rule expressible in one place? | Yes — `Policy ≤ Ceiling` is a single partial order | No — plan gate, credit debit, spending limit and kill rules are four independent systems |
| Reconciliation risk | Nil — the chain is the ledger | Acknowledged in-code ("REVENUE DEBT") |

**Where each is stronger.** Their credit engine is genuinely better thought-out than anything we have on the economic side: cost-based debit with a documented markup, a floor that prevents below-cost calls, and a single file that the pricing page reads so the marketing cannot outrun the enforcement. We have nothing comparable — and arguably need nothing, since we are a framework. But if ASH ever grows a hosted indexer or relayer with a price attached, `planPolicy.ts` is the pattern to copy: *one file, cost-derived, read by every surface.*

Our side is stronger everywhere the rule must survive a compromised operator, which is the entire point.

---

## 5. Infrastructure

### 5.1 Runtime and dependency stack

| | ASH | Gate402 / Metera |
|---|---|---|
| Languages | Rust (program + policy crate), TypeScript (SDK/MCP); Python planned | TypeScript everywhere; Python only for Selenium E2E |
| Node | ≥22 | 20 |
| Package manager | **pnpm 10.6.5** + workspace protocol (`workspace:*`) | **npm** workspaces + a 557 KB `package-lock.json` |
| Build orchestration | **Turborepo** (`build`, `test`, `codegen` tasks, cached) | `concurrently` running two `npm run dev`s |
| TS bundler | `tsdown` per package, ESM-only (`"type": "module"`) | `tsc` → CJS; `ts-node-dev` in development |
| Lint/format | **Biome** (single tool, `biome check`) | ESLint (server only), none elsewhere |
| Test runners | `cargo test` + **Vitest 4** | **Jest 29** + `ts-jest`; pytest/Selenium for E2E |
| Solana stack | **`@solana/kit` v8** + Codama + Anchor 1.1.2 | **`@solana/web3.js` v1.98** + `@project-serum/anchor` 0.26 + `@sqds/multisig` 2.1.4 |
| Schema/validation | **Zod 4** in `@ash/contract` | Ad-hoc; no shared schema package |
| MCP SDK | `@modelcontextprotocol/sdk` ^1.30 | `@modelcontextprotocol/sdk` ^1.29 |

Two of these matter beyond taste. **Kit v8 vs. web3.js v1** means no code can be lifted verbatim in either direction. **Codama + `codegen:check`** means our client cannot silently drift from the IDL; they have no equivalent invariant, so a schema change is caught by a test or by production.

### 5.2 Stateful infrastructure

| | ASH | Gate402 |
|---|---|---|
| Database | **None.** Solana accounts are the database | PostgreSQL (Supabase, pooled `DATABASE_URL` + `DIRECT_URL` for migrations), 26 Prisma models |
| Cache | None | Redis (ioredis) — counters, limit cache, rate limits, idempotency, user/API-key caches |
| Queue | None | BullMQ (`bullmq` at the repo root and in the server) + `workers/collectWorker.ts` |
| Auth | Keys are signers; there is no login | Supabase Auth (GitHub + email), plus API keys, plus an OAuth consent flow, plus admin auth |
| Secrets | Keypair file paths via env (`ASH_SIGNER`, `ASH_FEE_PAYER`) | `SOLANA_WALLET_PRIVATE_KEY` (bs58 or JSON array) in env, read at call time by `getMeteraKeypair()` |
| Background jobs | None | `startSpotSampler`, `startProofAnchor`, `startNoiseRefresh`, `startCollectWorker` — all started inside the HTTP process |
| Third-party services | RPC only | Stripe, Supabase, Privy, Resend, Transak, Apify, Exa, Firecrawl, Serper, Tavily, ElevenLabs, Anthropic, Helius, Chainlink, Webacy, DefiLlama, Squads |

The count in that last row is the infrastructure story. ASH has **one** external dependency at runtime (an RPC endpoint) by explicit design — "zero external program dependencies" on-chain, and effectively zero off-chain too. Gate402 has roughly twenty, each a key to rotate, a bill to pay, a status page to watch, and a failure mode to handle.

### 5.3 Deployment and operations

| | ASH | Gate402 |
|---|---|---|
| Deploy targets | Solana devnet → mainnet-beta; npm for packages | Vercel (dashboard) + Railway (API, NIXPACKS) + Docker (`apps/server/Dockerfile`, multi-stage node:20-alpine) |
| Local dev | `anchor test` / `cargo test --workspace`; LiteSVM needs no validator | `docker-compose up` (Postgres only — Redis is assumed external), then two dev servers |
| Config | 3 env vars for the MCP server (`ASH_RPC`, `ASH_SIGNER`, `ASH_FEE_PAYER`) | `.env.example` lists 4; the README documents 10; the real count across `lib/env.ts`, `planPolicy.ts` and the proxies is well past 40 |
| Health/observability | Program events + planned `@ash/indexer` + `ash doctor` | `/health`, `middleware/metrics.ts`, `lib/shutdown.ts` (graceful), console logging |
| Rate limiting | None (not applicable) | `globalRateLimit` 500/min per IP and per user, sliding-window per API key, unpaid-route limiter; payment requests bypass IP limits |
| Security middleware | N/A | `helmet`, `cors`, `lib/ssrf.ts` (proxy target guard), `publicFormGuard.ts`, PoW on the contact form (`contact/pow.ts`) |
| Upgrade governance | Staged trust (ADR-011): maintainer multisig → Squads 3-of-5 with 72h timelock → **frozen** after audit | `git push` |

### 5.4 CI/CD

**Gate402** has one workflow, `.github/workflows/e2e.yml`:
- `unit` job — `npm install --ignore-scripts && npm test` for `apps/server`, `packages/sdk`, `packages/sdk-agent`.
- `e2e` job — installs Python 3.13, Chrome and Selenium, writes real credentials into `tests/e2e/.env.test`, and runs pytest **against `https://www.gate402.dev`**, with the logout test segregated to run last and screenshots uploaded on failure.

That second job is a genuine anti-pattern worth naming: CI is coupled to production uptime, to production data, and to a live login. A red build can mean "someone deployed" rather than "the code is wrong". The `--ignore-scripts` on install also means Prisma's `postinstall generate` is skipped, so the unit job tests against whatever client happens to be generated.

**ASH** has **no `.github/` directory at all.** `ARCHITECTURE.md` §11 specifies the intended gate matrix in detail — fmt, clippy `-D warnings`, cargo-deny/audit, verifiable build hash, CU regression (>10% fails), account-layout snapshot, IDL diff comment, short Trident run, tsc/Biome/vitest, coverage thresholds (policy ≥95%, SDK core ≥85%), CodeQL, semgrep, pinned Actions; nightly long-Trident, Kani, Surfpool E2E, `cargo-mutants` — and none of it exists. Measured against our own spec this is the single largest infrastructure gap in the repo, and it is larger than the gap Gate402 has against theirs.

### 5.5 Testing infrastructure

| Layer | ASH | Gate402 |
|---|---|---|
| Pure logic | `proptest` + `cargo-fuzz` + Kani (planned, ADR-008) | — |
| Unit | Vitest per TS package; `cargo test` per crate | ~40 Jest files, concentrated in data/verification/OFAC, **thin on the payment path** |
| Integration | LiteSVM Rust tests — 7 files covering every instruction and adversarial path, clock warps | — |
| Stateful fuzzing | Trident with invariants (vault balance vs. receipts, counters ≤ limits, `Policy ≤ Ceiling`, paused ⇒ no payment, receipts never re-init) — planned | — |
| E2E | Surfpool nightly with mainnet-forked USDC; devnet smoke on release tags — planned | Selenium against production |
| Contract tests | MCP in-memory transport + tool-schema snapshots | — |

Their coverage is deepest exactly where their differentiated product is (multi-source data verification); ours is deepest exactly where ours is (the program). Both are, in that sense, correctly allocated — but their payment middleware being under-tested is a real weakness given it is the load-bearing part of the README.

---

## 6. What we have in common

Real overlaps, not superficial ones.

**6.1 Same thesis, same primitives.** Autonomous agents need to move money; USDC on Solana is the settlement rail; MCP is how the capability is handed over. Both repos independently landed on identical mint constants, the same devnet/mainnet split, and `@modelcontextprotocol/sdk` as the server framework.

**6.2 Spending limits with the same shape.** Their `spendingLimits.ts` and `sdk-agent/src/agent.ts` both implement `maxPerCall / maxPerHour / maxPerDay (/ maxPerMonth)` plus endpoint allow/block lists — structurally our `MintLimit` plus `destination_mode: Allowlist`. Both also chose **fixed calendar buckets** over rolling windows, independently arriving at the tradeoff ADR-005 records.

**6.3 Idempotency as a first-class concern.** `lib/idempotency.ts` is a Redis-fronted, Postgres-backed `checkIdempotency`/`markUsed` pair with 24h TTL, so a tx hash buys exactly one request. Same threat as our `IntentReceipt` — the agent retry, not the duplicate transaction — and `noncustodial.ts` even treats the check→mark race as a replay, the off-chain analogue of `init`-fails-on-duplicate.

**6.4 Kill switch with the same reasoning.** `agentKill.ts`: terminal by design, key revoked in the same atomic statement, hot flag written *after* the truth store so a racing request that misses the cache still sees `killed`. That is our `pause`/`revoke_session` split, argued the same way.

**6.5 Simulate before acting.** `lib/solanaSimulate.ts` is a preflight simulator with a sharp note on what a simulation does *not* claim ("an answer about the state at ONE slot"). We do the same in `sdk/src/simulate.ts` + `preflight.ts` behind `check_payment`.

**6.6 Hash-committed audit trails.** `merkle.ts` + `proofLeaf.ts` + `proofAnchor.ts` batch records into a Merkle tree and anchor the root on-chain; we commit payments into a per-session hash chain. Different structure, identical intent: make the off-chain log tamper-evident against on-chain state.

**6.7 Structured denial reasons.** They return `{ reason, code, limit, current }` from every check; we have `REASON_CODES` mirroring Anchor errors 6000–6041. Same instinct: an agent needs a machine-readable *why*.

**6.8 Monorepo + npm distribution + MCP scaffolding.** Both are workspace monorepos publishing a client SDK, a server/middleware package, and an MCP entry point.

---

## 7. Where we differ — summary

Detail is in §2 (structure), §3 (architecture), §4 (business rules) and §5 (infrastructure). The short list:

1. **Enforcement boundary** — program vs. Node process (§3.3). Everything else follows from this.
2. **Custody** — none vs. server-held keys and Privy-provisioned wallets.
3. **Protocol** — a canonical `PaymentIntent` the program adjudicates vs. x402's HTTP 402 handshake. Orthogonal, not competing.
4. **Transaction stack** — Kit v8 + Codama vs. web3.js v1 + Serum Anchor 0.26. No code is liftable; logic is.
5. **Testing posture** — Rust-first pyramid with fuzzing and model checking vs. Jest + production Selenium.
6. **Scope discipline** — one frozen ADR-backed baseline vs. a marketplace, a blog, a careers page, a token page, a Bayesian research engine, three dead site generations and ten MCP proxies. That is a product finding its market; it is also a warning about what accretes without a frozen design baseline.
7. **CI/CD** — they have one imperfect workflow; we have none.
8. **Monetisation** — absent by design vs. four interacting commercial rule systems.

---

## 8. Their design notes worth reading regardless of reuse

Several files carry unusually good reasoning in comments and are worth reading as prior art:

- `apps/server/src/lib/merkle.ts` — domain separation (`0x00` leaf / `0x01` node) explained as a second-preimage defence; odd node **promoted, not duplicated**, citing CVE-2012-2459. If we ever batch-anchor, this is the correct construction.
- `apps/server/src/lib/proofLeaf.ts` — "what the proof proves and what it does not": anchoring shows a record existed and was not edited; it does *not* show the datum was correct. Plus a canonical-JSON spec (sorted keys, no whitespace, `undefined` dropped, `null` kept) written once and shared by writer and verifier. Directly relevant to how we document `verifyChain`.
- `apps/server/src/lib/ofacMatcher.ts` — **four outcomes, not two**: `match / possible_match / no_match / unavailable`, because collapsing "we checked and it's clear" into the same shape as "our index never loaded" is the confusion with real consequences. Exactly the argument for why a `PolicyHook` failure must not silently read as `allowed`.
- `apps/server/src/lib/executability.ts` — a third axis next to corroboration: *does this answer's age still fit what I'm about to do with it?* `executable: null` means "nobody declared a threshold and we will not invent one".
- `apps/server/src/lib/planPolicy.ts` — cost-derived pricing in one file that every surface reads, "so the page can never promise something the code does not enforce."
- `apps/server/src/services/agentKill.ts` — the write-ordering argument (truth store before hot flag) in three lines.

---

## 9. What we could take — ranked

Everything here is **additive to layers we already planned**; none of it touches the program or the policy crate.

### Tier 1 — clear wins, low risk

**9.1 A CI workflow, today.**
*Theirs:* `.github/workflows/e2e.yml`. *Gap:* we have zero CI despite ARCHITECTURE §11 specifying a full gate matrix (§5.4).
*Action:* don't copy theirs — it's thin and pins CI to a live production URL. Use it as the prompt to land a minimal `ci.yml` now: `cargo fmt --check`, `cargo clippy -D warnings`, `cargo test --workspace`, `pnpm lint`, `pnpm build`, `pnpm test`, `pnpm codegen:check`. That last one already exists in our root `package.json` and is exactly the kind of gate that rots without CI.

**9.2 `create-ash` scaffolder.**
*Theirs:* `packages/create-gate402-mcp/` — a `prompts`-driven generator that writes a runnable MCP server, `package.json`, `tsconfig`, and a Claude Desktop config block.
*Why:* our v1 onboarding is "run the CLI, then hand-edit `claude_desktop_config.json` with three env vars". A `npx create-ash` that scaffolds a session keypair path, RPC and a paste-ready config block is half a day of work and removes the most error-prone step in our DX.
*Maps to:* `packages/cli`'s `init` command — possibly just a subcommand rather than a new package.

**9.3 Ship a Claude Desktop config example + MCP README.**
*Theirs:* `apps/mcp-demo/claude-desktop-config.json` + two package READMEs.
*Why:* trivially cheap, and `packages/mcp/README.md` currently carries no copy-pasteable block for `ASH_RPC` / `ASH_SIGNER` / `ASH_FEE_PAYER`.

**9.4 Four-state results for soft policy hooks.**
*Theirs:* `ofacMatcher.ts`'s `match / possible_match / no_match / unavailable`.
*Why:* our `PolicyHook` interface (`packages/sdk/src/policy-hooks.ts`) must not be able to fail open silently — a hook that throws, times out, or can't reach its backend has to produce a distinguishable `unavailable`, with a documented default (deny) and a configurable override. Note that *their own* `spendingLimits.ts` gets this wrong (§3.4): `if (redis)` silently skips every window check when the cache is down. Take the pattern from their matcher, not from their limiter.
*Action:* review `runPolicyHooks` before the SDK freezes its public types.

### Tier 2 — worth adopting, moderate effort

**9.5 The `executability` / staleness concept for `check_payment`.**
*Theirs:* `lib/executability.ts` — publish the slot a simulation ran at, plus a per-type freshness budget, plus `executable: true | false | null`.
*Why:* `check_payment` returns `{ allowed, reasons[], remaining_after, intent_id }` and says nothing about how stale that answer is. Agents *will* cache a check and execute a minute later. Adding `simulated_at_slot` (+ an optional staleness verdict) makes check-then-execute honest.
*Maps to:* `@ash/contract`'s `mcp-tools.ts` response schema. Cheap now, breaking later.

**9.6 Sliding-window rate limiting at the MCP/SDK boundary.**
*Theirs:* `lib/rateLimit.ts` — Redis sorted-set sliding window, "no burst at window boundary", with an explicit no-Redis fallback.
*Why:* our on-chain windows are fixed epoch buckets — correct for the chain (cheap, verifiable, fuzzable) but they permit the classic boundary burst: the full short-window cap at 13:59 and again at 14:00. A soft sliding-window hook in the SDK closes that without touching program CU. Textbook `PolicyHook`.
*Caveat:* defense in depth only, and the docs must say so. Also fix the fallback direction — theirs fails open; ours should fail closed (§9.4).

**9.7 Destination screening as a shipped `PolicyHook`.**
*Theirs:* `lib/ofacIndex.ts` + `ofacMatcher.ts` + `scripts/ofac-index.ts` — SDN indexing, tokenised fuzzy matching, weak-alias down-weighting, a versioned matcher (`MATCHER_VERSION`), explicit thresholds.
*Why:* any enterprise evaluating ASH will ask "can the agent pay a sanctioned address?" On-chain we answer with `destination_mode: Allowlist`; for `Any` mode there is no answer. A reference screening hook — even a thin one over a maintained address list rather than their full name-matching engine — turns a hard question into a documented one.
*Scope note:* they screen *names* (KYC-style); we'd screen *addresses*. The reusable part is the four-state contract and the versioned-matcher discipline, not the algorithm.

**9.8 An x402 bridge — the strategic one.**
*Theirs:* `packages/sdk-agent/src/agent.ts` (parse 402 → pay → retry), `packages/mcp-client/src/payment.ts` (base64 `X-Payment` proof), `packages/mcp-server/src/middleware.ts` (the 402 response shape).
*Why:* an `@ash/adapters/x402` that intercepts HTTP 402, routes the payment through `execute_payment` instead of a raw transfer, and returns the proof header would make ASH the **policy layer under the entire x402 ecosystem** — Gate402 included. It turns a potential competitor into a downstream consumer.
*Effort:* small. The 402 payload is ~30 lines (`{ version, accepts: [{ scheme, network, amount, token, payTo }] }`); the rest is our existing `executePayment`.
*Fit:* `packages/adapters/*`, alongside langchain / ai-sdk / openai-agents. Arguably v1.1, but the highest-leverage idea in this report.

### Tier 3 — read, don't copy

**9.9 Squads integration pattern.** `lib/squads.ts` shows the concrete mechanics: Squads v4 multisig creation, an on-chain USDC spending limit, `PublicKey.default` as the "no config authority" sentinel, threshold raised to 2, and a `SquadsSetupAttempt` table for orphan recovery. Reference for the v2 "Squads spending-limit adapter" on our roadmap and for documenting `owner = <Squads vault PDA>`.

**9.10 Merkle batching.** `lib/merkle.ts` is correct and well-argued. Our hash chain is the right primitive for per-session ordering; a Merkle batch is the right primitive if we ever want cheap third-party proof of inclusion for a *single* payment without replaying the chain. File under future indexer work, not v1.

**9.11 Cost-derived pricing in one file.** `lib/planPolicy.ts` (§4.2b). Irrelevant to v1 — we sell nothing. Directly relevant the day a hosted indexer or relayer gets a price.

**9.12 Operational scaffolding.** Their `apps/server/scripts/` (~40 one-shot devnet/e2e/probe scripts) is a reminder of how much throwaway tooling a live system needs. Our `ash doctor` / `audit` commands should absorb the durable subset of that instinct rather than accumulating loose scripts.

---

## 10. What we should explicitly *not* take

- **The off-chain limit engine.** Redis counters as the enforcement boundary is the exact architecture ASH exists to replace. Adopting it anywhere near the payment path would undermine the project's only differentiated claim — and it fails open when the cache is down (§3.4).
- **Custodial wallets / server-held keys.** `getMeteraKeypair()`, `privy.ts`, `/agent/:key/pay-mcp`. Non-custodial is a stated design invariant, not a preference.
- **The dashboard / SaaS layer.** ARCHITECTURE §1 lists "a hosted service or a web dashboard" as a v1 non-goal. Their `_legacy/` directory is the cautionary tale.
- **`@solana/web3.js` v1 / `@project-serum/anchor` 0.26 code.** We are Kit v8 + Codama. Port logic, never files.
- **`packages/m1`.** Excellent work, entirely orthogonal (multi-source data verification, not payments). Frozen on their side too.
- **E2E-against-production CI.** Selenium against `https://www.gate402.dev` with real credentials in secrets couples CI to uptime and to production data. Our Surfpool/devnet plan is better.
- **Two ledgers for the same money.** Their own "REVENUE DEBT" comment names the problem. If we ever add off-chain accounting, the chain stays the single ledger.

---

## 11. Legal / provenance caveat

The README badge and four `package.json` files declare **MIT**, but **there is no `LICENSE` file in the repository**. MIT is compatible with our Apache-2.0 and would require preserving the copyright notice on any copied code. Given the ambiguity:

- Treat everything in §9 as **ideas and patterns to reimplement**, not source to copy.
- If any file is ever lifted substantially, resolve the license question with the author first and add proper attribution.
- Nothing in this report requires copying a single line to act on.

---

## 12. Recommended next steps

Ordered by value-per-hour, all compatible with the current `feature/ts-sdk` work:

1. **Land a minimal `.github/workflows/ci.yml`** (§9.1). Biggest gap against our own spec; blocks nothing; prevents `codegen:check` drift.
2. **Add `simulated_at_slot` to the `check_payment` response schema** (§9.5) while `@ash/contract` is still unfrozen. Cheap now, breaking later.
3. **Audit `runPolicyHooks` for fail-open behaviour** and introduce a distinguishable `unavailable` outcome (§9.4).
4. **Write the MCP README + Claude Desktop config example** (§9.3). An hour's work, disproportionate DX payoff.
5. **Prototype the x402 adapter** (§9.8) as a spike — even a 100-line proof that `execute_payment` can settle an x402 invoice is a strong story for the README and for positioning against exactly this repo.
6. **Defer** sliding-window hooks (§9.6), destination screening (§9.7), the scaffolder (§9.2), Squads (§9.9), Merkle batching (§9.10) and cost-derived pricing (§9.11) to post-v1 — but record them as ADR candidates so the reasoning isn't re-derived.
