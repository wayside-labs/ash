# DeFi intents — product plan (v0)

Status: **implemented (advisory layer)** · on-chain program unchanged · devnet only

Agent Rails remains a **payment floor** (`execute_payment` / `execute_payment_sol`). DeFi intents describe how curated Solana protocols would flow through the existing 5-phase pipeline before any executor MCP exists.

## Problem

Users ask the dashboard chat for yield strategies ("50% in 48h", "deposit on Kamino if APY > 8%"). Today:

- Chat is read-only (no tools, no signing).
- MCP agents can only pay allowlisted destinations under policy caps.
- There is no generic DeFi CPI orchestrator in the program — by design.

We need a **structured intent layer** that refuses guaranteed yield, surfaces protocol risk, and outputs owner checklists — without widening agent privilege.

## Curated Solana protocols (v0 catalog)

| Protocol | Category | Typical intents | Risk |
|----------|----------|-----------------|------|
| **Jupiter** | Aggregator | swap | medium |
| **Meteora** | DLMM | swap, LP | medium |
| **Kamino** | Lending / vaults | lend, LP | medium |
| **Marginfi** | Lending | lend, borrow | medium |
| **Solend** | Lending | lend, borrow | medium |
| **Raydium** | AMM | swap, LP | medium |
| **Orca** | CLMM (Whirlpools) | swap, LP | medium |
| **Drift** | Perpetuals | perp, lend | **high** |
| **Phoenix** | Order book | swap, perp | **high** |
| **Marinade** | Liquid staking | stake | low |
| **Jito** | Liquid staking | stake | low |
| **Sanctum** | LST routing | stake, swap | medium |
| **Tensor** | NFT marketplace | swap (NFT) | **high** |

Source of truth: `packages/contract/src/defi-intents.ts` (`SOLANA_DEFI_PROTOCOLS`).

## 5-phase pipeline (unchanged from system prompt)

```text
Discover → Evaluate → Mandate → Owner Approve → Execute (executor agent only)
```

- **Discover**: read MCP — APY, TVL, utilization, `data_age_s` (TTL 5 min).
- **Evaluate**: risk card (all fields required).
- **Mandate**: owner-signed strategy doc (caps, min APY, stop conditions).
- **Approve**: allowlist + policy/session on-chain.
- **Execute**: executor agent reconfirms live data; chat never runs this phase.

## Blocked request patterns

Autonomous execution is refused when text matches:

- Guaranteed / risk-free yield language
- Short-horizon profit framing ("50% in 48h")
- Very high APY thresholds without explicit mandate (≥ 30% flag)

Reason codes: `DEFI_REASON_CODES` in `@agent-rails/contract/defi-intents`.

## What shipped in v0

| Layer | Deliverable |
|-------|-------------|
| Contract | `defi-intents.ts` — catalog, parser, preflight, proposal builder |
| Dashboard API | `POST /api/defi/analyze` — treasury-aware preflight |
| Dashboard UI | `/defi` — intent analyzer + result cards |
| Chat context | Protocol catalog injected into read-only snapshot |
| Tests | `defi-intents.test.ts` |

## What is intentionally not in v0

- On-chain DeFi CPI recipes (requires ADR + audit)
- Protocol read MCPs (Jupiter quote, Kamino APY) — `CAPABILITY_GAP` until installed
- Allowlist read in preflight (TreasuryView does not expose labels yet)
- Executor agent auto-routing to Jupiter/Kamino instructions
- Canvas blueprint tool for DeFi (lives on canvas branch)

## Roadmap

### Phase 1 — Read integrations (next)

- Jupiter quote MCP (read-only, no sign)
- Kamino / Marginfi APY + utilization MCP
- Surface on-chain allowlist labels in `TreasuryView` for accurate preflight

### Phase 2 — Mandate artifacts

- Signed mandate JSON stored off-chain, hash referenced in session memo
- Dashboard draft `bulk_add_allowlist` for protocol vault PDAs
- Canvas nodes: Treasury → Analysis → Action → Executor

### Phase 3 — Executor recipes (program ADR required)

Each recipe is a **bounded payment path**, not arbitrary CPI:

- Jupiter swap = allowlisted router + max slippage in policy hook
- Kamino deposit = allowlisted vault ATA + capped amount
- Drift / Tensor default **quarantine** until owner release

### Phase 4 — Mainnet + audit

- Immutable guarantees unchanged
- External audit before mainnet custody
- Devnet smoke on release tags (ADR-015 deferred item)

## Invariants preserved

- No MCP tool may call `update_policy`, `create_session`, or `withdraw`.
- Chat assistant never executes payments.
- No role widens its own limit.
- Indeterminate outcomes never reported as denials.

## Usage

```bash
pnpm --filter @agent-rails/contract test
pnpm dashboard   # open http://localhost:3000/defi
```

Example API:

```bash
curl -s localhost:3000/api/defi/analyze -H 'content-type: application/json' \
  -d '{"text":"Deposit USDC on Kamino if APY > 8%","treasuryAddress":"<TREASURY>","cluster":"devnet"}' | jq .
```
