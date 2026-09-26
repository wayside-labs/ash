# Agent Rails Dashboard — the Metrics page

**Created:** 2026-09-25
**Package:** `packages/dashboard` (`@agent-rails/dashboard`)
**Route:** `/metrics` · **Nav group:** `nav.money`
**Status:** Phase A implemented (2026-09-25). Phase B implemented (2026-09-25). Phase C not started.

> **Amended 2026-09-25, after Phase A landed.** Three things the implementation
> needed that §F did not anticipate, now folded into it: `policies[]` on the
> summary (§3's `Any`-mode empty state needs `destinationMode`, and nothing else
> carried it), `payments.lifetimeOnly` (a `seq` count is lifetime whatever period
> is selected, and the tile has to say so), and `policy`/`policyName` on a
> headroom row so a meter can name the policy it belongs to. `metricsPeriodSchema`
> also dropped `custom` rather than carrying a value the UI rejects. One thing §C
> specified and Phase A deliberately does not emit: a `per-tx` headroom row, which
> is a cap on one payment rather than a budget that accumulates, so a progress bar
> against it would always read zero. `/limits` shows it in its proper context.

The CFO view. `/treasury` is the cashier: it holds balances and the one write the
dashboard is allowed to make. `/metrics` answers the four questions a cashier
screen cannot: where did the money go, are we on budget, did value move, who did
we pay.

Read alongside [dashboard-handoff.md](./dashboard-handoff.md) and
[dashboard-page-flows.pt-BR.md](./dashboard-page-flows.pt-BR.md).

<details>
<summary>Where each requested deliverable lives</summary>

The brief asked for nine sections (A–I) but its stop conditions ask for thirteen
things — TypeScript contracts, the route plan, the phased rollout and the
non-goals have no slot in A–I. Sections were added rather than merged, so:

| Asked for | Here |
|---|---|
| One-liner + user story | §A |
| Information architecture, drill-down paths | §B |
| Metric catalogue (definitions, formulas, source) | §C |
| Filters and state | §D |
| Component file plan | §E |
| TypeScript contracts / Zod schemas | §F |
| API and route plan | §G |
| Nav entry + i18n keys, copy deck, empty states | §H |
| Sample mock data | §I |
| Phased rollout A/B/C | §J |
| Acceptance tests | §K |
| Non-goals and risks | §L |
| Effort estimate and dependencies | §M |

</details>

---

## 0. Five corrections to the brief, before anything is built

The brief describes work that is partly already done and partly impossible as
stated. These five facts change the design, so they come first.

**0.1 `PaymentRecord` already exists. Do not define a second one.**
`packages/contract/src/events.ts` exports `paymentRecordSchema` and
`PaymentRecord`, published as `@agent-rails/contract/events`. It is snake_case
and it already carries `outcome`, `reason_code`, `source`, `destination`,
`destination_label`, `mint`, `amount`, `signature`, `receipt`, `logs`,
`units_consumed`, `detail`. It is *the* operator-sink shape — the thing the MCP
server and CLI already write. The Metrics page extends it for display; it does
not fork it, and it does not camelCase it. Keeping one spelling end to end is
what lets the CSV export columns match the sink an operator may already be
tailing.

**0.2 Receipts are not the history.** `close_receipt` is *permissionless* once
`now ≥ receipt.expires_at + RECEIPT_GRACE_SECONDS` (3600s —
`programs/agent_rails/src/constants.rs:33`). The upstream F2a `IntentReceipt`
reader answers "did *this* payment land?" and can never answer "what happened
last month", because the accounts are gone and someone else has the rent. The
durable record is the `PaymentExecuted` event stream (spec §8), recovered as
`getSignaturesForAddress(session)` → `getTransaction` → log parse, and that is
bounded by RPC log retention — days on public devnet, not months.

  Consequence: **itemized history is best-effort and windowed, forever, until
  there is an indexer.** Every widget fed by it must say so. This is not a
  polish item; it is the central honesty constraint of the page.

**0.3 The totals, however, are exact today — with no indexer and no history.**
`TreasuryView.sessions[]` (already in `src/lib/server/solana.ts`) carries `seq`
and the three spend counters (`shortSpent`, `longSpent`, `lifetimeSpent`) per
mint. `seq` is an exact count of settled payments for the session's life;
the counters are exact spend for the program's own buckets. So "how many
payments" and "how much spent" need no new infrastructure at all — only the
*line items* do.

  Consequence, and it is the phasing decision: **Phase A is not a mock.** It
  ships real, exact headline numbers. Only the ledger below them waits.

**0.4 The period selector cannot be `24h / 7d / 30d` in Phase A.** A counter is
exact for *the program's* bucket and says nothing about an arbitrary range.
Rendering `lifetimeSpent` under a label that reads "Last 7 days" is a lie the
operator cannot detect. So in Phase A the selector offers the buckets the chain
actually tracks — the policy's short window, its long window, session lifetime —
labelled with their real duration read from `policy.limits[].shortWindowSeconds`
(`formatWindow()` already renders these). `Custom` is rendered disabled with a
tooltip until Phase B lands the event replay that can honour it.

**0.5 `DestinationContact` is `AllowlistEntry`, and the reader exists.**
`destination_owner` + a 32-byte `label` + `per_tx_max_override`, read by
`loadDestinationIndex()` in `packages/sdk/src/destinations.ts` (already exported
from `@agent-rails/sdk`, already used by `packages/cli`). Contacts come from
chain. The dashboard does not get a contacts table.

**Also worth knowing before you start:**

- `packages/dashboard/package.json` has **no chart library**. Every chart here is
  inline SVG or a CSS grid. `@xyflow/react` is for the canvas and is not a
  charting escape hatch.
- `src/i18n/locales/en.json` is a **flat dot-key object** — 541 keys, no nesting.
  `pt-BR.json` mirrors it exactly, key for key, at the same count. A key added to
  one and not the other is a bug the type of `MessageKey` will catch.
- `/limits` already ships `CeilingMeter` with the owner-ceiling / operator-policy
  / agent-spend three-band legend. Metrics **links there**; it does not grow a
  second limits UI.
- `src/lib/server/privileged-surface.test.ts` mechanically fails the build if any
  dashboard source file names a privileged instruction builder.
  `getCloseReceiptInstruction` is on that list — so however tempting "reclaim
  $12.80 of rent from 41 expired receipts" looks on a CFO page, it does not go
  here. It is a CLI concern.
- There is now a Playwright suite (`packages/dashboard/e2e/`, `scripts/verify.sh
  ui`) with `privilege.spec.ts` asserting that browsing the money pages issues
  no chain write. Two things follow, and the second is a trap:
  1. `/metrics` joins that spec's browse loop in Phase A, not later.
  2. **`stubChain` intercepts `**/api/solana/**` only.** A page that calls
     `/api/metrics/summary` therefore escapes the stub, reaches the real route
     handler, and tries to open a real RPC — exactly what `playwright.config.ts`
     exists to prevent. So `e2e/fixtures.ts` needs `**/api/metrics/**` stubbed
     too (extend `stubChain`, or add a `stubMetrics` beside it) **before**
     `/metrics` is added to any spec. Skip this and the suite either hangs or
     goes green against devnet, and the second is worse.

---

## A. One-liner and user story

**One-liner:** one read-only page that turns capped agent spend into a CFO's
four answers — holdings, budget, value, and who got paid — with every number
labelled by how exactly it is known.

**User story**

> As an operator, I open Metrics to see, in one screen: how much is in the
> vaults, how much my agents have actually spent against what they are allowed
> to spend, whether the dollar value moved because of price or because of
> payments, and the list of destinations money went to — so that I can answer
> "are we on budget?" without reading a policy account or a block explorer.

**Non-story, deliberately.** As an operator I do *not* raise a limit, create a
session, unpause a treasury, or reclaim receipt rent from this page. Those are
CLI verbs. Metrics is the page that tells you a limit is nearly spent and then
hands you the command.

---

## B. Page map, top to bottom

Answers first, evidence below. A non-crypto operator should get value from §1–§4
without scrolling into an address.

```
┌─ Metrics ──────────────────────────────────────── [devnet] [◐] [⟳ refresh] ─┐
│ Where the money went, and whether you are on budget.                        │
│                                                                             │
│ Scope   [ All workflows ▾ ] [ All agents ▾ ] [ All tokens ▾ ]               │
│ Period  ( 24h window )( 30d window )( Session lifetime )( Custom ⓘ disabled)│
└─────────────────────────────────────────────────────────────────────────────┘

§1  HEADLINE — the four numbers
┌────────────────────┬────────────────────┬───────────────┬──────────────────┐
│ In the vaults      │ Spent · 24h window │ Payments      │ Refused          │
│ $4,812.55          │ 1,500.00 USDC      │ 47            │ —                │
│ 2.41 SOL           │ $1,500.00          │               │                  │
│ + 1,500.00 USDC    │                    │               │                  │
│ ▸ live · 1 partial │ ▸ on-chain counter │ ▸ exact, life │ ▸ needs history  │
└────────────────────┴────────────────────┴───────────────┴──────────────────┘
   The ▸ line is the exactness footnote. It is never omitted.

§2  ON BUDGET?
┌─────────────────────────────────────────────────────────────────────────────┐
│ Headroom                                        legend: ▬spend ▭policy │ceil│
│                                                                             │
│ My Online Store · USDC · 24h    ███████░░░░░░░░│  1,500 / 5,000   [ 30% ]  │
│ My Online Store · USDC · 30d    ███░░░░░░░░░░░░│  4,100 / 50,000  [  8% ]  │
│ DeFi Trading · SOL · 24h        ██████████████░│  9.1 / 10 SOL    [ 91% ]  │
│                                     ↑ Tightest constraint: 0.9 SOL left    │
│                                                                             │
│ Full ceilings and policy bands →  /limits                                    │
└─────────────────────────────────────────────────────────────────────────────┘

§3  WHERE IT WENT
┌──────────────────────────────────┬──────────────────────────────────────────┐
│ By token                         │ Destinations                             │
│                                  │                                          │
│ USDC ████████████████████ 78%    │ Acme Hosting     1,200.00 USDC   14 pmts │
│ SOL  █████░░░░░░░░░░░░░░░ 22%    │ Cloud GPU          820.00 USDC    9 pmts │
│                                  │ Data Vendor        410.00 USDC    6 pmts │
│ 5,320.00 USDC · 9.14 SOL         │ Payroll Ops      2.50 SOL         2 pmts │
│ ▸ on-chain counter, lifetime     │ Superteam Earn         — never paid      │
│                                  │ ▸ roster exact · amounts need history    │
└──────────────────────────────────┴──────────────────────────────────────────┘

§4  VALUE  (informational)
┌─────────────────────────────────────────────────────────────────────────────┐
│ Holdings marked to market           $4,812.55                               │
│ SOL spot $182.40 (−1.20%) · coingecko · 14s ago                             │
│ Price move on today's SOL holdings   −$5.34                                 │
│                                                                             │
│ ⓘ Mark-to-market on what the vaults hold right now. Not profit and loss:    │
│   holdings changed during the period too, and there is no cost basis here.  │
│   Tokens without a known peg are excluded — 1 asset excluded.               │
└─────────────────────────────────────────────────────────────────────────────┘

§5  PAYMENTS  (Phase B)
┌─────────────────────────────────────────────────────────────────────────────┐
│ [ All outcomes ▾ ] [ All destinations ▾ ]        [ Export CSV ] [ JSON ]    │
│                                                                             │
│ When       Agent      To              Amount       Outcome    Ref           │
│ 14:02:11   CFO Bot    Acme Hosting    120.00 USDC  settled    #47 ↗         │
│ 13:51:03   CFO Bot    Cloud GPU        80.00 USDC  settled    #46 ↗         │
│ 13:44:55   AP Asst    (unlisted)      300.00 USDC  denied     DESTINATION_… │
│ 13:30:02   Trader     Payroll Ops       1.25 SOL   indeterm.  resolve →     │
│ …                                                                           │
│ ⚠ Showing 20 of 47 known payments. Older than slot 302,118,004 is past this │
│   RPC's log retention and is not recoverable without an indexer.            │
└─────────────────────────────────────────────────────────────────────────────┘
      row click → payment detail sheet (intent_id, receipt PDA, memo hash,
      reason code, CU consumed, explorer link, "retry is not safe" note when
      the outcome is indeterminate)

§6  INTEGRITY
┌─────────────────────────────────────────────────────────────────────────────┐
│ Audit chain                                                                 │
│ cfo-bot-sept   seq 47   head 9c4e17bb…d1a5   verified through 47  ✓         │
│ ap-assistant   seq 12   head 41ba09f3…7e02   not verified (no history) ○    │
│ trader-bot     seq  3   head 77de2c18…9ab4   REVOKED · terminus recorded    │
│                                                                             │
│ Refused, by reason (Phase B)                                                │
│ DESTINATION_NOT_ALLOWED ████████ 8   EXCEEDS_SHORT_WINDOW ███ 3             │
└─────────────────────────────────────────────────────────────────────────────┘

§7  GOALS  (Phase C)
┌─────────────────────────────────────────────────────────────────────────────┐
│ Hosting under 1,500 USDC / 30d      1,200 / 1,500   ████████████░░░  80% ⚠ │
│ ⓘ A goal is a note to yourself. The policy is the limit that stops a        │
│   payment — set it with `agent-rails policy set`.                           │
└─────────────────────────────────────────────────────────────────────────────┘
```

**Drill-down path.** `/metrics` (all workflows) → `?workflowId=w_x` (one
workflow, its sessions) → `?agentId=a_y` (one agent, resolved to its session
PDA) → row click in §5 → payment sheet keyed by `intent_id`. Each step narrows
the same seven sections rather than navigating to a different page, and the
breadcrumb lives in `PageHeader`'s `description` slot.

---

## C. Widget catalogue

`summary` = the `MetricsSummary` folded server-side (§E, `lib/metrics/fold.ts`).
Amounts are base-unit strings throughout; `decimals` comes from
`TreasuryView.decimals[mint]`, never from the mint registry.

| Widget | Formula | Source | Phase |
|---|---|---|---|
| §1 In the vaults | `Σ asset.money.usd` over every `VaultAsset` in scope; `partial = true` if any asset has `usd === null` | `/api/solana/vault-balances` + `/api/solana/price` (both exist) | **A** |
| §1 Spent | `Σ session.spend[mint].{short,long,lifetime}Spent` over sessions in scope, per mint, ÷ `10**decimals`; USD only for pegged mints and native at spot | `readTreasury()` counters — exact | **A** |
| §1 Payments | `Σ Number(session.seq)` over sessions in scope | `SessionView.seq` — exact, lifetime | **A** |
| §1 Payments, period-scoped | count of `PaymentExecuted` in range | event replay | B |
| §1 Refused | `count(records where outcome ∈ {denied, review_required})` | event replay for program denials; pre-chain denials are off-chain only (spec §8) and unreachable from a browser — renders `—` + "how to enable", never `0` | B (partial, permanently) |
| §2 Headroom bar | `spent / policyMax` per (mint, window); ceiling band from `MintCeilingView.max*`; `u64::MAX` → unlimited | `readTreasury()` — exact. Reuses `CeilingMeter` verbatim | **A** |
| §2 Tightest constraint | `argmin over (mint,window) of (policyMax − spent)`, skipping unlimited | derived from the above | **A** |
| §3 By token, share | `lifetimeSpent[mint] / Σ lifetimeSpent` | counters — exact | **A** |
| §3 By token, period-scoped | `Σ amount` of records in range grouped by mint | event replay | B |
| §3 Destination roster | every `AllowlistEntry` for the policies in scope, with `perTxMaxOverride` when non-zero | `loadDestinationIndex()` — exact | **A** |
| §3 Destination amounts + count + last paid | group records by `destination_owner` | event replay | B |
| §4 Marked to market | `Σ (asset.amount × price)` — spot for native, 1:1 for `knownMint().stable`, excluded otherwise, with the exclusion count shown | vault balances + price | **A** |
| §4 Price move on holdings | `solAmount × usd × (1 − 1/(1 + change24h/100))`. Explicitly "price move on current holdings", **not** P&L | `SolPrice.change24h` | **A** |
| §4 Cost basis / realised P&L | — | needs price history at payment time; no source exists. **Non-goal** (§I) | — |
| §5 Payments table | `PaymentRecord[]`, newest first, paginated by signature cursor | event replay, mocked in A | A (mock) / **B** (real) |
| §5 Completeness banner | `complete = false` whenever the cursor hit retention or the page limit; names the oldest slot reached | replay metadata | B |
| §5 Export CSV / JSON | `paymentRecordSchema` field order, one row per record; blob download | `lib/metrics/csv.ts`, same download pattern as `useExportRunnerConfig` | B |
| §6 Session seq + audit head | read straight off `AgentSession` | needs `auditHead` added to `SessionView` — one field, dashboard-local | **A** |
| §6 Verified through seq N | replay `PaymentExecuted` ordered by `seq` through `next_audit_head`, compare terminus with `AgentSession.audit_head` | upstream F2a `verifyAuditChain` | B |
| §6 Refused by reason | `count(records) group by reason_code` | event replay | B |
| §7 Goal progress | `spent(scope, mint, period) / goal.targetRaw` | §1 counters + `/api/state/goals` | C |
| §7 Goal breach alert | `progress ≥ 1` → `Badge variant="destructive"`; `≥ 0.8` → `serious` | derived, client-side | C |

**On `exactness`.** Every metric above carries one of four values, and the UI
renders it as a footnote under the number:

| value | means | ink |
|---|---|---|
| `counter` | read from an on-chain counter — exact, no gaps | `text-foreground` |
| `events` | replayed from logs — complete only within retention | `text-muted-foreground` |
| `demo` | seeded row, no on-chain counterpart | `text-subtle-foreground` + `DemoBadge` |
| `unavailable` | nothing to read yet — renders `—`, never `0` | `text-faint-foreground` |

This mirrors the existing `moneyTone()` convention: provenance rides ink level,
colour stays reserved for status. It is the single mechanism that keeps the page
honest, so it goes in `fold.ts` (one place) rather than being decided per widget.

---

## D. Filters and state

| State | Lives in | Why |
|---|---|---|
| `period` | URL: `?period=short-window` | A metrics view is a link you send a colleague. Default `short-window`. |
| `workflowId`, `agentId`, `mint` | URL | Same. Also makes the drill-down path a real back-button. |
| `outcome`, `destination` (§5) | URL | Same. |
| `cluster`, `customRpc` | `useAppStore` (existing) | Already global; duplicating it would let two pages disagree about which chain they are on. |
| `balancesHidden` | `useBalancesHidden()` (existing) | Hidden amounts must not flash before persist rehydrates. Every `num` on this page respects it. |
| server cache | React Query | `["metrics-summary", cluster, customRpc, treasuries, period, mint]`, `staleTime` and `refetchInterval` 30s to match `useVaultBalances`. `["metrics-destinations", cluster, customRpc, policy]` at 60s. `["metrics-history", …, cursor]` at 15s, `placeholderData: keepPrevious`. |

Drill-down reuses the existing `["treasury", cluster, rpc, address]` key, so
opening a workflow on Metrics warms `/limits` and vice versa.

`period` values are `metricsPeriodSchema`: `short-window`, `long-window`,
`session-life`, `custom`. The first three render their real duration
(`formatWindow(policy.limits[0].shortWindowSeconds)` → "24h") rather than a
hardcoded label, because a policy may well use a 6h short window.

---

## E. Component and file plan

```
packages/dashboard/src/
├── app/(dashboard)/metrics/
│   ├── page.tsx                    "use client"; composes §1–§7, reads URL params
│   └── loading.tsx                 PageSkeleton, mirrors (dashboard)/loading.tsx
├── app/api/metrics/
│   ├── summary/route.ts            GET → MetricsSummary          [A]
│   ├── destinations/route.ts       GET → DestinationContact[]    [A]
│   ├── history/route.ts            GET → { records, complete, … }[B]
│   └── history/export/route.ts     GET → text/csv | application/json [B]
├── components/metrics/
│   ├── period-selector.tsx         segmented control; Custom disabled + tooltip
│   ├── scope-selector.tsx          workflow → agent → mint cascade (ui/select)
│   ├── exactness-note.tsx          the ▸ footnote — one renderer, four states
│   ├── kpi-tile.tsx                Card + .num + ExactnessNote
│   ├── kpi-row.tsx                 §1
│   ├── headroom-panel.tsx          §2 — wraps CeilingMeter + link to /limits
│   ├── token-split.tsx             §3 left — stacked bar, inline SVG
│   ├── destination-list.tsx        §3 right — bar list
│   ├── valuation-card.tsx          §4 — mark-to-market + disclaimer
│   ├── payments-table.tsx          §5                            [B]
│   ├── payment-detail-sheet.tsx    §5 drill-down (ui/sheet)      [B]
│   ├── integrity-panel.tsx         §6
│   └── goals-panel.tsx             §7                            [C]
├── lib/metrics/
│   ├── schema.ts                   the Zod contracts (§F)
│   ├── fold.ts                     PURE: TreasuryView[] + VaultBalances + SolPrice → MetricsSummary
│   ├── fold.test.ts                where the real test value is
│   ├── mock.ts                     the fixture (§G)
│   ├── history.ts                  signature → log → PaymentRecord  [B]
│   ├── history.test.ts                                              [B]
│   └── csv.ts                      PaymentRecord[] → CSV            [B]
├── hooks/use-metrics.ts            useMetricsSummary / useDestinationContacts / usePaymentHistory
└── e2e/metrics.spec.ts             Playwright, and add "/metrics" to
                                    privilege.spec.ts's page loop
```

**Why `fold.ts` is pure and separate.** It is the dashboard's echo of the split
that CLAUDE.md makes load-bearing on the Rust side: the arithmetic that decides
what a number *means* lives away from the I/O that fetched it. It takes plain
data in and returns `MetricsSummary`, so every exactness decision, every
`u64::MAX` sentinel, every "this mint has no peg so the USD total is partial" is
unit-testable with no RPC and no browser. That is the one module in this feature
that genuinely needs tests, and it is where layer-4 coverage should go.

**Files edited, not created:**

- `components/layout/nav-items.ts` — add to the `nav.money` group.
- `i18n/locales/en.json`, `pt-BR.json` — §H keys.
- `lib/server/solana.ts` — add `auditHead: string` to `SessionView` (hex) and
  populate it in `readTreasury`. Pure addition; `/limits` ignores it.
- `lib/schema.ts` — Phase C only: `goalSchema` + `goals` in `RESOURCE_SCHEMAS`.
- `e2e/privilege.spec.ts` — add `/metrics` to the browse loop and the new
  `/api/metrics/*` paths to `READ_ONLY_CHAIN_ROUTES`.

**No new npm dependencies.** §3's stacked bar and §6's histogram are ~40 lines
of inline SVG each; §2 reuses `CeilingMeter` as-is. A charting library would be
~40kB gzipped to draw four bars, and `artifact`-grade interactivity is not what
this page needs.

---

## F. TypeScript contracts

`packages/dashboard/src/lib/metrics/schema.ts`. These live in the dashboard, not
in `@agent-rails/contract`: contract is the cross-surface compatibility anchor
that `client`, `sdk`, `mcp` and `cli` all pin, and `MetricsSummary` / `PeriodGoal`
are hosted-dashboard view concepts with no counterpart on any other surface.
Adding them upstream would put a UI shape on the package that gates MCP
transport compatibility. `PaymentRecord` is the exception, and it is already
there.

```ts
import { paymentRecordSchema } from "@agent-rails/contract/events";
import { z } from "zod";
import { solanaClusterSchema } from "@/lib/schema";

const addressSchema = z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
/** Base units. A u64 does not survive JSON as a number. */
const baseUnitsSchema = z.string().regex(/^\d+$/);

/**
 * How well a number is known. The load-bearing field on this page: a metric
 * without it is a number an operator cannot calibrate against.
 */
export const exactnessSchema = z.enum([
  /** An on-chain counter. Exact, no gaps. */
  "counter",
  /** Replayed from PaymentExecuted logs. Complete only within RPC retention. */
  "events",
  /** A seeded row with no on-chain counterpart. */
  "demo",
  /** Nothing to read yet. Renders as an em dash, never as zero. */
  "unavailable",
]);
export type Exactness = z.infer<typeof exactnessSchema>;

/**
 * The buckets the program itself tracks. `custom` needs the event replay, so it
 * is offered only once Phase B lands — a counter cannot answer an arbitrary
 * range, and labelling one as though it could is the failure mode this enum
 * exists to prevent.
 */
export const metricsPeriodSchema = z.enum(["short-window", "long-window", "session-life"]);
export type MetricsPeriod = z.infer<typeof metricsPeriodSchema>;
```

`custom` is absent from the enum rather than present-and-rejected. A value the
parser accepts is a value some caller will eventually pass, and the disabled chip
in the UI is what explains the gap to a reader. Phase B adds it to both at once.

```ts

export const metricsScopeSchema = z.object({
  /** null = every workflow the operator can see. */
  workflowId: z.string().nullable(),
  agentId: z.string().nullable(),
  mint: addressSchema.nullable(),
});

/** One amount, carried the way every other Agent Rails surface carries one. */
export const metricAmountSchema = z.object({
  raw: baseUnitsSchema,
  mint: addressSchema,
  /** From the owner-configured MintConfig, never from the mint registry. */
  decimals: z.number().int().min(0).max(18),
  symbol: z.string(),
  /** Spot for native, 1:1 for a known peg, null otherwise. Never guessed. */
  usd: z.number().nullable(),
});

export const headroomSchema = z.object({
  mint: addressSchema,
  decimals: z.number().int(),
  symbol: z.string(),
  /** Which policy this limit belongs to, so a row can name it. */
  policy: addressSchema,
  policyName: z.string(),
  window: z.enum(["short", "long", "lifetime", "per-tx"]),
  /** Real duration, so the UI can label "6h" when the policy says 6h. */
  windowSeconds: z.number().int().nullable(),
  spentRaw: baseUnitsSchema,
  policyMaxRaw: baseUnitsSchema,
  /** The owner ceiling, when the treasury has one configured. */
  ceilingRaw: baseUnitsSchema.nullable(),
  /** True when policyMaxRaw is the u64::MAX sentinel. */
  unlimited: z.boolean(),
});

export const integrityRowSchema = z.object({
  session: addressSchema,
  label: z.string(),
  /** Exact count of settled payments for this session's life. */
  seq: baseUnitsSchema,
  /** AgentSession.audit_head, hex. */
  auditHead: z.string().length(64).regex(/^[0-9a-f]+$/),
  /** Phase B: the seq the replay reached before the head stopped matching. */
  verifiedThroughSeq: baseUnitsSchema.nullable(),
  revoked: z.boolean(),
  expiresAt: z.number().int(),
});

export const metricsSummarySchema = z.object({
  asOf: z.string(),
  cluster: solanaClusterSchema,
  scope: metricsScopeSchema,
  period: z.object({
    kind: metricsPeriodSchema,
    /** null for session-life, which has no fixed length. */
    seconds: z.number().int().nullable(),
    /** Unix seconds; the bucket's own start, from SpendCounter.shortWindowStart. */
    startedAt: z.number().int().nullable(),
  }),
  holdings: z.object({
    assets: z.array(metricAmountSchema),
    usd: z.number().nullable(),
    /** True when at least one asset has no peg, so the USD total is a floor. */
    partial: z.boolean(),
    /** How many assets were excluded from the USD total. */
    excluded: z.number().int(),
  }),
  spend: z.object({
    byMint: z.array(metricAmountSchema),
    usd: z.number().nullable(),
    exactness: exactnessSchema,
  }),
  payments: z.object({
    count: z.number().int(),
    /**
     * `seq` counts a session's whole life whatever period is selected, because
     * the program keeps no per-window counter of *attempts*. The UI says so
     * rather than letting the number sit under a window label unqualified.
     */
    lifetimeOnly: z.boolean(),
    exactness: exactnessSchema,
  }),
  denials: z.object({
    /** null, not 0, while there is nothing to read. */
    count: z.number().int().nullable(),
    byReason: z.record(z.string(), z.number().int()),
    exactness: exactnessSchema,
  }),
  headroom: z.array(headroomSchema),
  /**
   * The policies in scope. `destinationMode` is what tells §3 whether there is a
   * roster to show at all: a policy in `Any` mode has none, and an empty list
   * rendered under that mode reads as "nobody may be paid", which is the
   * opposite of the truth.
   */
  policies: z.array(
    z.object({
      address: addressSchema,
      name: z.string(),
      /** 0 = DestinationMode::Any, 1 = Allowlist. */
      destinationMode: z.number().int(),
      requireMemo: z.boolean(),
    }),
  ),
  price: z
    .object({
      usd: z.number(),
      change24h: z.number().nullable(),
      source: z.enum(["coingecko", "coinbase"]),
      asOf: z.string(),
    })
    .nullable(),
  integrity: z.array(integrityRowSchema),
  /** Treasuries the fold could not read. Surfaced, not swallowed. */
  unreadable: z.array(z.object({ treasury: addressSchema, detail: z.string() })),
});
export type MetricsSummary = z.infer<typeof metricsSummarySchema>;

/**
 * An allowlist entry, plus what was paid to it once history exists.
 * `paid: null` means "not known", which is not "never paid" — the roster is
 * exact but the amounts are not, and the UI has to say which.
 */
export const destinationContactSchema = z.object({
  label: z.string(),
  normalizedLabel: z.string(),
  owner: addressSchema,
  /** The AllowlistEntry PDA. */
  entry: addressSchema,
  policy: addressSchema,
  /** "0" means no override; otherwise it caps this destination below the policy. */
  perTxMaxOverrideRaw: baseUnitsSchema,
  paid: z
    .object({
      count: z.number().int(),
      byMint: z.array(metricAmountSchema),
      lastAt: z.string().nullable(),
    })
    .nullable(),
  demo: z.boolean().default(false),
});
export type DestinationContact = z.infer<typeof destinationContactSchema>;

/**
 * A `PaymentRecord` with the few fields a table needs resolved. Deliberately
 * an `.extend()` on the contract schema and deliberately still snake_case:
 * one spelling from the MCP sink through this table to the CSV column headers.
 * `amount` stays the base-unit string of record; `decimals` is for rendering.
 */
export const paymentRecordViewSchema = paymentRecordSchema.extend({
  decimals: z.number().int().nullable(),
  symbol: z.string().nullable(),
  workflow_id: z.string().nullable(),
  agent_id: z.string().nullable(),
  agent_name: z.string().nullable(),
  demo: z.boolean().default(false),
});
export type PaymentRecordView = z.infer<typeof paymentRecordViewSchema>;

export const paymentHistorySchema = z.object({
  records: z.array(paymentRecordViewSchema),
  /** False whenever the walk hit retention or the page limit. */
  complete: z.boolean(),
  /** The oldest slot the walk actually reached, for the banner's wording. */
  oldestSlot: z.string().nullable(),
  truncatedBy: z.enum(["retention", "limit", "rpc-error"]).nullable(),
  /** Signature cursor for the next page. */
  before: z.string().nullable(),
});

/**
 * A soft target the operator sets on themselves.
 *
 * A goal is not a limit: nothing here can refuse a payment, and the page says
 * so next to every bar. The limit that stops a payment is the policy, and it is
 * writable only from the CLI (ADR-002). Keeping goals in the dashboard's own
 * store rather than on-chain is what keeps that true — there is no instruction
 * this page could call even by accident.
 */
export const periodGoalSchema = z.object({
  id: z.string(),
  scope: metricsScopeSchema,
  /** Judged against the program's own buckets, so progress is exact. */
  period: z.enum(["short-window", "long-window", "session-life"]),
  mint: addressSchema,
  targetRaw: baseUnitsSchema,
  direction: z.enum(["at-most", "at-least"]),
  label: z.string().max(64),
  createdAt: z.string(),
  demo: z.boolean().default(false),
});
export type PeriodGoal = z.infer<typeof periodGoalSchema>;
```

---

## G. API and route plan

| Route | Method | Returns | Phase |
|---|---|---|---|
| `/api/metrics/summary` | GET | `MetricsSummary` | **A** |
| `/api/metrics/destinations` | GET | `{ contacts: DestinationContact[] }` | **A** |
| `/api/metrics/history` | GET | `paymentHistorySchema` | B |
| `/api/metrics/history/export` | GET | `text/csv` or `application/json` attachment | B |
| `/api/solana/vault-balances` | POST | reused unchanged | **A** |
| `/api/solana/price` | GET | reused unchanged | **A** |
| `/api/solana/treasury` | GET | reused unchanged, for drill-down cache sharing | **A** |
| `/api/state/goals` | CRUD | reuses the generic `[resource]` routes | C |

**`GET /api/metrics/summary`**

```
?cluster=devnet
&rpc=<optional custom>
&treasuries=<comma-separated>     # from the caller's own workflow rows
&period=short-window
&mint=<optional>
```

Server-side: `Promise.all` of `readTreasury()` per treasury, one
`getVaultBalances()`, one `getSolUsdPrice()`, then `foldMetrics()`. Response is
`metricsSummarySchema.parse`d before it is sent, so a shape drift fails on the
server rather than rendering `NaN` in a browser.

**Why a server route instead of composing existing hooks client-side.** Three
reasons, in order of weight: (1) the custom-RPC allowlist is enforced
server-side and the browser never holds an RPC URL — that is an existing
invariant of this dashboard, not a preference; (2) the page needs three fan-outs
across N treasuries, and doing it client-side is an N-deep waterfall that
re-runs on every period change; (3) `exactness` has to be decided in exactly one
place, and a server route is the only place all the inputs are present at once.

**`GET /api/metrics/destinations?cluster&rpc&policy=`** wraps
`loadDestinationIndex()` from `@agent-rails/sdk`. Read-only; it calls
`getProgramAccounts` with a discriminator + policy memcmp, exactly as
`packages/cli/src/chain/read.ts` already does.

**`GET /api/metrics/history?cluster&rpc&session=&before=&limit=`** (Phase B)
walks `getSignaturesForAddress(session)`, fetches transactions, parses
`PaymentExecuted` / the Anchor error out of each, and maps to
`PaymentRecordView`. It sets `complete: false` and `truncatedBy: "retention"` the
moment the walk returns fewer signatures than asked for *and* the oldest slot is
at the retention edge. `limit` is capped at 100 server-side; the existing
`rate-limit.ts` bucket applies.

**Export** reuses the blob-download pattern already proven in
`useExportRunnerConfig`: fetch as an opaque blob, `URL.createObjectURL`,
synthetic `<a download>`. Counts ride back in `X-Metrics-Records` and
`X-Metrics-Complete` headers so the toast can say "47 payments, history
incomplete".

**Privilege.** Every route above is a read. None may import an instruction
builder, and `privileged-surface.test.ts` enforces that mechanically by scanning
every `.ts`/`.tsx` file under `src/`.

Note what that test does *not* cover: it proves no builder is imported, not that
no request is made. The Playwright half proves the behaviour, and it needs the
fixture work in §0 first — `stubChain`'s `**/api/solana/**` pattern does not
reach `/api/metrics/*`. Once the metrics routes are stubbed, add them to
`READ_ONLY_CHAIN_ROUTES` so the set-difference assertion covers them as reads
rather than ignoring them.

---

## H. Nav and i18n

**`components/layout/nav-items.ts`** — into the existing `nav.money` group.
Placed first: it is the page that sends you to the other three.

```ts
import { ChartNoAxesColumn } from "lucide-react";   // add to the icon import
{
  labelKey: "nav.money",
  items: [
    { href: "/metrics", labelKey: "nav.metrics", icon: ChartNoAxesColumn },
    { href: "/treasury", labelKey: "nav.treasury", icon: CreditCard },
    { href: "/limits", labelKey: "nav.limits", icon: Gauge },
    { href: "/wallets", labelKey: "nav.wallets", icon: Wallet },
  ],
},
```

**i18n keys.** Flat dot-keys appended to both `en.json` and `pt-BR.json` — both
files currently hold 541 keys and must still match after this lands. EN copy
below is the deck; PT-BR uses the identical keys.

```jsonc
// navigation
"nav.metrics": "Metrics",

// page chrome
"metrics.title": "Metrics",
"metrics.description": "Where the money went, and whether you are on budget.",
"metrics.emptyTitle": "No vault to measure yet",
"metrics.emptyDescription": "Metrics reads from a treasury on chain. Bootstrap one and this page fills in by itself.",
"metrics.emptyCta": "Set up a vault",
"metrics.aria.refresh": "Refresh metrics",

// scope + period
"metrics.scope.allWorkflows": "All workflows",
"metrics.scope.allAgents": "All agents",
"metrics.scope.allTokens": "All tokens",
"metrics.period.shortWindow": "{window} window",
"metrics.period.longWindow": "{window} window",
"metrics.period.sessionLife": "Session lifetime",
"metrics.period.custom": "Custom",
"metrics.period.customDisabled": "A custom range needs payment history. Available once history is indexed.",
"metrics.period.startedAt": "Bucket opened {time}",

// exactness footnotes — the four states, one string each
"metrics.exactness.counter": "on-chain counter",
"metrics.exactness.events": "from payment history",
"metrics.exactness.demo": "demo figure",
"metrics.exactness.unavailable": "not available yet",
"metrics.exactness.counterHint": "Read straight off the program's spend counter. Exact.",
"metrics.exactness.eventsHint": "Replayed from transaction logs. Complete only as far back as this RPC keeps them.",
"metrics.exactness.unavailableHint": "Nothing to read yet — this is not a zero.",

// section 1
"metrics.headline.holdings": "In the vaults",
"metrics.headline.spent": "Spent",
"metrics.headline.payments": "Payments",
"metrics.headline.refused": "Refused",
"metrics.headline.holdingsPartial": "{count} asset without a known price is not counted",
"metrics.headline.holdingsPartialPlural": "{count} assets without a known price are not counted",
"metrics.headline.refusedEmpty": "Refusals are recorded by the agent's own runner, not on chain.",
"metrics.headline.refusedEnable": "See how to collect them",

// section 2
"metrics.headroom.title": "Headroom",
"metrics.headroom.tightest": "Tightest constraint: {amount} left on {label}",
"metrics.headroom.openLimits": "Full ceilings and policy bands",
"metrics.headroom.emptyTitle": "No policy to measure against",
"metrics.headroom.emptyDescription": "This treasury has no open policy, so there is no limit to spend against yet.",
"metrics.headroom.emptyCommand": "pnpm agent-rails policy set --help",

// section 3
"metrics.byToken.title": "By token",
"metrics.byToken.emptyTitle": "Nothing spent yet",
"metrics.byToken.emptyDescription": "The moment an agent makes its first payment, the split appears here.",
"metrics.destinations.title": "Destinations",
"metrics.destinations.neverPaid": "never paid",
"metrics.destinations.override": "capped at {amount} per payment",
"metrics.destinations.amountsPending": "Roster is exact. Amounts need payment history.",
"metrics.destinations.anyMode": "This policy allows any destination, so there is no roster to show.",
"metrics.destinations.emptyTitle": "No destination registered",
"metrics.destinations.emptyDescription": "An allowlist policy pays only labelled destinations. Add one from the CLI.",
"metrics.destinations.emptyCommand": "pnpm agent-rails dest add --label \"Acme Hosting\" --owner <address>",

// section 4
"metrics.value.title": "Value",
"metrics.value.marked": "Holdings marked to market",
"metrics.value.priceMove": "Price move on today's SOL holdings",
"metrics.value.spot": "SOL spot {price} ({change}) · {source} · {age} ago",
"metrics.value.disclaimer": "Mark-to-market on what the vaults hold right now. Not profit and loss: holdings changed during the period too, and there is no cost basis here.",
"metrics.value.priceUnavailable": "No price feed reachable, so amounts are shown in their own token only.",
"metrics.value.priceStale": "Price is {age} old.",

// section 5
"metrics.payments.title": "Payments",
"metrics.payments.colWhen": "When",
"metrics.payments.colAgent": "Agent",
"metrics.payments.colTo": "To",
"metrics.payments.colAmount": "Amount",
"metrics.payments.colOutcome": "Outcome",
"metrics.payments.colRef": "Ref",
"metrics.payments.unlistedDestination": "(unlisted)",
"metrics.payments.incomplete": "Showing {shown} of {known} known payments. Anything older than slot {slot} is past this RPC's log retention and cannot be recovered without an indexer.",
"metrics.payments.loadMore": "Load older",
"metrics.payments.exportCsv": "Export CSV",
"metrics.payments.exportJson": "Export JSON",
"metrics.payments.exported": "Exported {count} payments",
"metrics.payments.exportedIncomplete": "Exported {count} payments — history is incomplete",
"metrics.payments.emptyTitle": "No payment history yet",
"metrics.payments.emptyDescription": "This page reads payments back from transaction logs. Once an agent pays, the ledger fills in — or run the CLI to see the same records now.",
"metrics.payments.emptyCommand": "pnpm agent-rails status --json",
"metrics.payments.outcome.settled": "settled",
"metrics.payments.outcome.denied": "denied",
"metrics.payments.outcome.indeterminate": "unresolved",
"metrics.payments.outcome.reviewRequired": "held for review",

// payment detail sheet
"metrics.payment.title": "Payment {ref}",
"metrics.payment.intentId": "Intent",
"metrics.payment.receipt": "Receipt account",
"metrics.payment.receiptClosed": "Reclaimed — receipts are closeable an hour after the intent expires.",
"metrics.payment.memoHash": "Memo hash",
"metrics.payment.units": "Compute units",
"metrics.payment.reason": "Reason",
"metrics.payment.source": "Refused by",
"metrics.payment.indeterminateWarning": "Nobody knows whether this landed. Do not pay again — resolve it by receipt first.",
"metrics.payment.openExplorer": "Open in explorer",

// section 6
"metrics.integrity.title": "Audit chain",
"metrics.integrity.seq": "seq {seq}",
"metrics.integrity.head": "head {head}",
"metrics.integrity.verified": "verified through {seq}",
"metrics.integrity.notVerified": "not verified — no history available",
"metrics.integrity.broken": "chain breaks after {seq}",
"metrics.integrity.revoked": "revoked, terminus on record",
"metrics.integrity.explain": "Each payment hashes the one before it. A dropped or forged record breaks the chain.",
"metrics.integrity.refusedByReason": "Refused, by reason",

// section 7 (Phase C)
"metrics.goals.title": "Goals",
"metrics.goals.new": "New goal",
"metrics.goals.notALimit": "A goal is a note to yourself. The limit that stops a payment is the policy — set it with the CLI.",
"metrics.goals.breached": "over goal",
"metrics.goals.nearing": "nearing goal",
"metrics.goals.emptyTitle": "No goal set",
"metrics.goals.emptyDescription": "Set a soft target and this page will tell you before you reach the hard one.",

// errors
"api.error.metricsReadFailed": "Could not read metrics for this treasury.",
"api.error.unreadableTreasury": "{count} treasury could not be read and is not in these totals.",
"api.error.historyUnavailable": "Payment history is not available on this RPC.",
```

Two copy rules worth holding to. **Human labels:** "Vault", not "Treasury PDA";
"Refused", not "Denied" in headline position; "Payments", not "Transactions".
**Honest empties:** every empty state names the CLI command that would produce
the data, because "no data" plus a dead end reads as a broken page. The
`*.emptyCommand` keys render in the `<code>` block style `/treasury` already uses
for `pnpm agent-rails init`.

---

## I. Sample mock data

`packages/dashboard/src/lib/metrics/mock.ts`. Three workflows, two agents each,
twenty payments, five destinations — reusing the workflow and agent ids the
existing seed (`lib/server/seed.ts`) already creates, so the fixture joins onto
real demo rows instead of inventing a parallel universe.

Every row is `demo: true`. Demo destination owners are syntactically valid base58
but are not real accounts, so `destination-list.tsx` and the payment sheet must
suppress the explorer link whenever `demo` is set — a dead Solscan tab is worse
than no link.

```ts
// Leaf imports, matching lib/utils.ts: the barrel reaches `intent-id`, which pulls in
// `node:crypto` and cannot be bundled for the browser. NATIVE_MINT is in constants.
import { NATIVE_MINT } from "@agent-rails/contract/constants";
import { USDC_MINT_DEVNET } from "@agent-rails/contract/mints";
import type { DestinationContact, PaymentRecordView } from "./schema";

/** 28 hex chars; the row index supplies the last 4, so every id is valid by construction. */
const INTENT_PREFIX = "9c4e17bb5af2408da6013e7cd1a5";
const intentId = (n: number) => `${INTENT_PREFIX}${n.toString(16).padStart(4, "0")}`;

const SESSION = {
  cfo: "7v5FqEj8DaCbvJPEqpUtZXKyLBtrHuxhG2tWayTaJd4C",
  ap: "HN7cABqLq46Es1jh92dQQpjKrpPbvbYmGxzYcRZvkzVP",
  trader: "3nMFwZXwY1s1M5s8vYAHqd4wGs4iSxXE4LRoUMMYqEgF",
} as const;
const TREASURY = "2xbbqA1KvP7znHHk59tCbyN85cyHTy5hcwpQnwTKGc1i";
const POLICY = "5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1";

export const MOCK_DESTINATIONS: DestinationContact[] = [
  { label: "Acme Hosting",   normalizedLabel: "acme hosting",   owner: "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM", entry: "BPFLoaderUpgradeab1e11111111111111111111111", policy: POLICY, perTxMaxOverrideRaw: "0",         paid: null, demo: true },
  { label: "Cloud GPU",      normalizedLabel: "cloud gpu",      owner: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", entry: "6XU36wCxWobLx5Rtsb58kmgAKKJYoGkGfqALcW1JTBWY", policy: POLICY, perTxMaxOverrideRaw: "100000000", paid: null, demo: true },
  { label: "Data Vendor",    normalizedLabel: "data vendor",    owner: "AC5RDfQFmDS1deWZvFJkQeDot3EnGXNytj8fN8Pu1cM7", entry: "BdYTTV5sJVnKcQDTGKtCTsNwJKnBQZ1xjA2mF2vNiwHF", policy: POLICY, perTxMaxOverrideRaw: "0",         paid: null, demo: true },
  { label: "Payroll Ops",    normalizedLabel: "payroll ops",    owner: "GDDMwNyyx8uB6zrqwBFHjLLG3TBYk2F8Az4yrQC5RzMp", entry: "CzMHCrWhbCqVMDTNDriaMAcJ1mS5LLKGKGKpTLtHnGTW", policy: POLICY, perTxMaxOverrideRaw: "0",         paid: null, demo: true },
  { label: "Superteam Earn", normalizedLabel: "superteam earn", owner: "5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9", entry: "DjVE6JNiYqPL2QXyCUUh8rNjHrbz9hXHNYt99MQ59qw1", policy: POLICY, perTxMaxOverrideRaw: "0",         paid: null, demo: true },
];

/** [minutesAgo, workflow, agent, session, destIndex, mint, amountRaw, outcome, reason?] */
const ROWS: [number, string, string, string, keyof typeof SESSION, number, string, string, PaymentRecordView["outcome"], string?][] = [
  [   2, "w_demo_fornec", "a_demo_cfo",      "CFO Bot",      "cfo",    0, USDC_MINT_DEVNET, "120000000", "settled"],
  [  13, "w_demo_fornec", "a_demo_cfo",      "CFO Bot",      "cfo",    1, USDC_MINT_DEVNET,  "80000000", "settled"],
  [  20, "w_demo_fornec", "a_demo_ap",       "AP Assistant", "ap",     2, USDC_MINT_DEVNET, "300000000", "denied", "DESTINATION_NOT_ALLOWED"],
  [  34, "w_demo_defi",   "a_demo_trader",   "Trader Bot",   "trader", 3, NATIVE_MINT,     "1250000000", "indeterminate"],
  [  47, "w_demo_fornec", "a_demo_cfo",      "CFO Bot",      "cfo",    0, USDC_MINT_DEVNET, "120000000", "settled"],
  [  61, "w_demo_loja",   "a_demo_maria",    "Maria",        "cfo",    2, USDC_MINT_DEVNET,  "45500000", "settled"],
  [  88, "w_demo_fornec", "a_demo_ap",       "AP Assistant", "ap",     1, USDC_MINT_DEVNET, "220000000", "denied", "EXCEEDS_SHORT_WINDOW"],
  [ 104, "w_demo_defi",   "a_demo_trader",   "Trader Bot",   "trader", 3, NATIVE_MINT,       "750000000", "settled"],
  [ 133, "w_demo_loja",   "a_demo_joao",     "João",         "cfo",    0, USDC_MINT_DEVNET,  "18000000", "settled"],
  [ 150, "w_demo_fornec", "a_demo_cfo",      "CFO Bot",      "cfo",    1, USDC_MINT_DEVNET, "160000000", "settled"],
  [ 187, "w_demo_defi",   "a_demo_research", "Researcher",   "trader", 2, USDC_MINT_DEVNET,  "12000000", "settled"],
  [ 210, "w_demo_fornec", "a_demo_ap",       "AP Assistant", "ap",     0, USDC_MINT_DEVNET,  "95000000", "settled"],
  [ 264, "w_demo_loja",   "a_demo_maria",    "Maria",        "cfo",    2, USDC_MINT_DEVNET,  "60000000", "review_required"],
  [ 301, "w_demo_fornec", "a_demo_cfo",      "CFO Bot",      "cfo",    0, USDC_MINT_DEVNET, "120000000", "settled"],
  [ 355, "w_demo_defi",   "a_demo_trader",   "Trader Bot",   "trader", 3, NATIVE_MINT,       "500000000", "settled"],
  [ 402, "w_demo_fornec", "a_demo_ap",       "AP Assistant", "ap",     1, USDC_MINT_DEVNET, "140000000", "settled"],
  [ 468, "w_demo_loja",   "a_demo_joao",     "João",         "cfo",    0, USDC_MINT_DEVNET,  "22500000", "denied", "MEMO_REQUIRED"],
  [ 540, "w_demo_fornec", "a_demo_cfo",      "CFO Bot",      "cfo",    2, USDC_MINT_DEVNET, "410000000", "settled"],
  [ 611, "w_demo_defi",   "a_demo_research", "Researcher",   "trader", 2, USDC_MINT_DEVNET,   "8000000", "settled"],
  [ 720, "w_demo_fornec", "a_demo_cfo",      "CFO Bot",      "cfo",    1, USDC_MINT_DEVNET, "260000000", "settled"],
];

export const MOCK_PAYMENTS: PaymentRecordView[] = ROWS.map(
  ([minutesAgo, workflowId, agentId, agentName, session, destIndex, mint, amount, outcome, reason], i) => {
    const dest = MOCK_DESTINATIONS[destIndex] as DestinationContact;
    const settled = outcome === "settled";
    return {
      ts: new Date(Date.now() - minutesAgo * 60_000).toISOString(),
      treasury: TREASURY,
      session: SESSION[session],
      policy: POLICY,
      intent: intentId(i),
      outcome,
      ...(reason ? { reason_code: reason, source: "program" as const } : {}),
      destination: dest.owner,
      destination_label: dest.label,
      mint,
      amount,
      ...(settled ? { signature: `demo${i.toString().padStart(2, "0")}` } : {}),
      // Decimals come from the treasury's MintConfig in real data; the fixture
      // hardcodes what devnet uses for these two mints.
      decimals: mint === NATIVE_MINT ? 9 : 6,
      symbol: mint === NATIVE_MINT ? "SOL" : "USDC",
      workflow_id: workflowId,
      agent_id: agentId,
      agent_name: agentName,
      demo: true,
    } satisfies PaymentRecordView;
  },
);
```

Totals the fixture produces, to assert against in `fold.test.ts`:

- 20 payments across 3 workflows and 6 agents.
- By outcome: **15 settled, 3 denied, 1 indeterminate, 1 review_required** — all
  four outcomes represented, so every branch of the outcome badge is exercised.
- Settled spend: **1,588.50 USDC and 1.25 SOL**. Refused spend: 542.50 USDC,
  which must *not* appear in any spend total — a denial moved nothing.
- Only settled rows carry a `signature`, which is what the detail sheet keys its
  explorer link off.
- One destination — Superteam Earn — is registered and never paid. That row is
  the case that makes "the roster is exact, the amounts are not" visible on
  screen, and it is why the fixture has five destinations rather than four.

---

## J. Phased rollout

Phase A ships a page that is complete and honest about a narrower question.
It is not a mock with real styling.

**Phase A — holdings, budget, value, roster (no history).** Sections §1–§4 and
§6's `seq`/`auditHead` rows, all from on-chain counters and all exact. §5 renders
`MOCK_PAYMENTS` behind a visible `DemoBadge` on the section header, or the honest
empty state when the fixture is off — Lucas's call, but the badge must be at
section level, not per row, or a screenshot of the page reads as real history.
Period selector offers the three real buckets; `Custom` is disabled with its
tooltip. Ships independently of anything upstream.

**Phase B — real history and export.** F2a (`IntentReceipt` reader,
`verifyAuditChain` in `packages/sdk`) is done; remaining work is F2b (history
table + export). Adds
`lib/metrics/history.ts`, the two history routes, §5 for real, §6's "verified
through seq N" and the refused-by-reason histogram, and unlocks `Custom` periods
plus period-scoped versions of §1's Spent/Payments and §3's amounts. The
completeness banner is not optional here: it is what makes the difference between
a ledger and a lie.

**Phase C — goals and alerts.** `goalSchema` into `lib/schema.ts` +
`RESOURCE_SCHEMAS`, §7, and threshold badges. Alerts are in-page badges only —
email and webhooks need the notification infrastructure `settings.json` gestures
at and does not have, so promising them here would be a nav-entry-shaped
promise.

---

## K. Acceptance tests

Ten steps each, manual, on devnet. They are also the outline for
`e2e/metrics.spec.ts` under `stubChain`.

**Test 1 — the headline is exact and the provenance is legible (Phase A)**

1. `pnpm agent-rails init --rpc <devnet>`; note the treasury address.
2. Deposit 10 USDC and 0.5 SOL into the vault from the connected wallet on `/treasury`.
3. Create a policy and a session from the CLI with a 24h short window.
4. Make two payments through the MCP server, 1 USDC each.
5. `pnpm dashboard`, open `/metrics`.
6. §1 "In the vaults" reads 8.00 USDC + ~0.5 SOL with a USD total, footnote "on-chain counter".
7. §1 "Payments" reads exactly **2** — matching `session.seq`, not an estimate.
8. §1 "Refused" reads `—` with the "recorded by the agent's own runner" note. **It must not read 0.**
9. §1 "Spent" reads 2.00 USDC with footnote "on-chain counter"; the period chip says "24h window", not "Last 24 hours".
10. Toggle the hidden-balance eye in the header: every amount in §1–§4 becomes `••••`, and the footnotes stay readable.

**Test 2 — the page refuses to escalate privilege (Phase A)**

1. Open `/metrics` with a wallet connected that is **not** the on-chain owner.
2. Confirm no button anywhere on the page submits a transaction — every control is a link, a filter, or a download.
3. §2 shows headroom at 91% on some mint; confirm there is no "raise limit" affordance, only the `/limits` link.
4. Click through to `/limits`; confirm it is read-only too.
5. Search the page DOM for the words "pause", "withdraw", "revoke": absent.
6. §6 shows expired receipts implicitly via seq; confirm there is no "reclaim rent" button (`getCloseReceiptInstruction` is forbidden).
7. Run `pnpm --filter @agent-rails/dashboard exec vitest run src/lib/server/privileged-surface.test.ts` — green.
8. Confirm `e2e/fixtures.ts` stubs `**/api/metrics/**`, then run `scripts/verify.sh ui` with `/metrics` in `privilege.spec.ts`'s browse loop — green, and the run reaches no cluster (check the stub recorded every metrics call).
9. Confirm `chain.calls` for the `/metrics` visit contains only paths present in `READ_ONLY_CHAIN_ROUTES`.
10. Grep `app/api/metrics/` for `getWithdrawInstruction`: absent — Metrics has no write at all, not even the owner's.

**Test 3 — history tells the truth about what it does not know (Phase B)**

1. With ~40 payments on a session, open `/metrics` and scroll to §5.
2. Confirm the table shows the newest 20, newest first.
3. Confirm the banner names a slot and says older records are past retention.
4. Cross-check: §1 "Payments" (from `seq`) is **larger** than the row count in §5, and the page does not contradict itself about it.
5. Click a settled row: the sheet shows `intent_id`, receipt PDA, CU consumed, and an explorer link that resolves.
6. Click a row whose receipt has been closed: the sheet says "Reclaimed — receipts are closeable an hour after the intent expires" rather than showing an error.
7. Click an `indeterminate` row: the sheet warns against paying again and offers resolve-by-receipt.
8. Export CSV; open it — column order matches `paymentRecordSchema`, and the toast said "history is incomplete".
9. Switch the period chip to `Custom`, pick a range older than retention: §5 shows the honest empty state, not zero rows presented as zero payments.
10. Point the dashboard at a custom RPC that rejects `getSignaturesForAddress`: §5 shows `api.error.historyUnavailable` and §1–§4 still render from counters.

---

## L. Non-goals and risks

**Non-goals for v1.** Mainnet-only indexer. A custom backend. Billing or SaaS
tenancy. Cost-basis or realised P&L — there is no price-at-payment-time source,
and a dashboard that invents one is worse than one that says it cannot. Receipt
rent reclamation (CLI; forbidden here by
`privileged-surface.test.ts`). Any write at all: unlike `/treasury`, Metrics has
no write path, not even the owner's own withdraw. Email or webhook alerts.
Charting a time series of holdings — there is no historical balance source
either, and a two-point line through "now" and "24h ago via `change24h`" is not a
chart.

**Risks, in order of how likely each is to bite.**

*History is structurally incomplete, not temporarily so.* Receipts get closed
and logs age out. Without an indexer there is no version of this page where §5
is a complete ledger. Mitigation is editorial: the exact numbers live in §1–§3
off counters, §5 is explicitly a recent-activity view with a named cutoff, and no
total is ever computed by summing §5's rows. If a total in §1 and a sum of §5
ever disagree — and they will — the page must already have explained why.

*RPC lag and partial reads.* `readTreasury` can fail for one treasury while
succeeding for others. `MetricsSummary.unreadable[]` exists so a partial read is
reported rather than silently producing a smaller total. Never fold a failed
treasury in as zero.

*USD staleness and absence.* `getSolUsdPrice` caches 8s, falls back CoinGecko →
Coinbase, and returns `null` when both fail. §4 must render with
`price === null`, showing token amounts only. Show the feed's age; do not round
it away.

*Unpegged tokens silently shrinking the total.* A token with no known peg
contributes `null`, so a naive sum under-reports. Hence `holdings.partial` and
`holdings.excluded`, surfaced as copy rather than kept in the type.

*`seq` is per session, not per treasury.* Sessions come and go. "Payments,
lifetime" scoped to a workflow means "summed over the sessions that currently
exist" — a closed session takes its count with it, though `SessionClosed` carries
the terminal `seq` and `audit_head`. Say "across open sessions" in the tooltip;
do not imply an all-time figure the chain does not retain.

*Demo rows reading as real.* Three workflows in the default seed are demo rows
with `demoBalanceUsd` figures. Mixing them into a "total in the vaults" would
produce a confident wrong number. `fold.ts` must exclude `demo` rows from every
on-chain total and count them separately, and the fixture in §I is the test case
for exactly that.

*Period semantics drifting from the program's.* If someone later relabels
`short-window` as "Last 24 hours" to look more like a normal analytics product,
every number under it becomes wrong for any policy that does not use 86400s.
`formatWindow()` on the real `shortWindowSeconds` is the guard; keep it.

---

## M. Effort

Hours are Lucas's, on the assumption he has the dashboard running locally and a
bootstrapped devnet treasury to read.

| Phase | Work | Hours |
|---|---|---|
| A | `lib/metrics/schema.ts` + `fold.ts` + `fold.test.ts` | 5 |
| A | `/api/metrics/summary` and `/api/metrics/destinations` | 3 |
| A | `hooks/use-metrics.ts`, period + scope selectors, URL state | 3 |
| A | §1–§4 and §6 components, `exactness-note.tsx` | 6 |
| A | nav entry, ~90 i18n keys × 2 locales, `mock.ts` | 3 |
| A | `e2e/metrics.spec.ts`, `**/api/metrics/**` stub in `fixtures.ts`, wiring into `privilege.spec.ts` | 3 |
| A | `auditHead` onto `SessionView` in `lib/server/solana.ts` | 0.5 |
| **A total** | | **~23 h — 3 days** |
| B | `lib/metrics/history.ts` (signature walk, log parse) + tests | 7 |
| B | history + export routes, `csv.ts` | 4 |
| B | §5 table, detail sheet, completeness banner | 5 |
| B | §6 verification + refused histogram, `Custom` period unlock | 3 |
| **B total** | | **~19 h — 2.5 days** |
| C | `goalSchema` + `RESOURCE_SCHEMAS`, §7, threshold badges, i18n | 9 |
| **C total** | | **~9 h — 1.5 days** |

Phase A is a touch over the brief's 2–3 days at 23h, and the overage is mostly
`fold.ts` and its tests. That is the right place to spend it: it is the module
every number on the page passes through, and it is the only one that can be
tested without a cluster.

**Dependencies on 0xcf02**

| Needed | Blocks | Notes |
|---|---|---|
| Nothing | Phase A | A is self-contained in `packages/dashboard`. Start now. |
| F2a — `IntentReceipt` reader + `verifyAuditChain` in TS | §6 verification | **Done** in `packages/sdk`; wire into §6 when Phase B starts. |
| F2b — payment history reader + export | §5, `Custom` periods | If F2b lands as an SDK reader, `lib/metrics/history.ts` shrinks to a mapper and Phase B drops ~5h. **Worth agreeing the boundary before B starts.** |
| Decision: does `PaymentRecordView` stay in the dashboard or move to `@agent-rails/contract`? | Phase B shape | Recommendation: stays in the dashboard. Contract gates MCP transport compatibility and should not carry UI view types. |
| Decision: is `goals` a `/api/state` resource, or dropped? | Phase C | Recommendation: `/api/state`, off-chain, never an instruction. Keeps the privilege split true by construction. |
| A devnet treasury with a real policy, a live session, and ≥5 settled payments | Test 1 and 3, and the Colosseum demo | The most likely schedule risk on this whole list: none of §1–§6 can be reviewed against anything but zeros without it. |
