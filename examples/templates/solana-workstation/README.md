# Solana agent workstation

Multi-agent setup for **doing work on Solana** while **Agent Rails** remains the spend authority.
Orchestrators plan and quote; only the executor pays, under policy, through `execute_payment`.

Raydium, Orca, and most AMM volume are reached through **Jupiter** routing — one integration
surface instead of N protocol SDKs. Agent Rails still does not CPI into those programs; it funds
a **desk wallet** you control, then the desk signs the swap Jupiter returns.

## Roles

| Role | MCP | Pays |
|---|---|---|
| **Orchestrator** | Agent Rails readonly + workflow Jupiter | No |
| **Analyst** | Jupiter (via workflow export) | No |
| **Executor** | Agent Rails full + Jupiter | Yes — desks and vendors only |

```
  Analyst / Orchestrator          Executor                    Treasury
  jupiter_quote ───────────────▶ plan + reference id
                                  agent_rails_execute_payment ──▶ swap-desk ATA
                                  sign jupiter_swap_transaction from desk key
```

## Setup (devnet)

```bash
pnpm install && pnpm build

pnpm agent-rails init \
  --out ~/.agent-rails/workstation \
  --name workstation-usdc \
  --mock-mint --mock-mint-decimals 6 \
  --token-per-tx 50 --token-daily 200 --token-lifetime 1000 --token-deposit 1000 \
  --per-tx 0.01 --daily 0.05 --lifetime 0.2 \
  --session-ttl 2 \
  --yes

pnpm agent-rails dest add --out ~/.agent-rails/workstation \
  --label swap-desk --owner <SWAP_DESK_WALLET> --yes

# Optional: vendor pay_to wallets (oracle, compute, …) from packages/vendors
```

Create sessions after you approve a plan:

```bash
pnpm agent-rails session create --out ~/.agent-rails/workstation \
  --label plan-<id> --session-ttl 2 --yes
```

## Runner config

From the dashboard **Templates → Solana agent workstation**, or wire MCP manually:

- `agent-rails-mcp` with `AGENT_RAILS_TOOLS=full` on the executor only.
- `agent-rails-integrations mcp jupiter` on the workflow (shared by orchestrator and analyst).

See `mcp/executor.cursor.json` and `mcp/orchestrator.cursor.json` in this folder.

## Monetization (operators)

This template is the free spine. Revenue lines that fit the architecture:

| Layer | What you sell |
|---|---|
| **Hosted workstation** | Dashboard tenancy, runner export, ingest alerts (braço 1 off-chain) |
| **Paid connectors** | Premium data, faster Jupiter lane, simulation — BUSL adapters |
| **Vendor rail** | Pay-per-quote APIs (`packages/vendors` pattern) settled via `execute_payment` |
| **Mandate (later)** | Capital-under-mandate fee on braço 2 once envelope program ships |

Agents never get tools that raise limits or edit allowlists.

## Out of scope for v1

- On-chain swaps from the treasury program (no DEX CPI in `agent_rails`).
- Unattended mainnet execution without audit and guardian runbooks.
- Letting the model pick arbitrary pool addresses as payment destinations.
