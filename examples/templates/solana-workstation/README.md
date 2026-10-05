# Solana agent workstation

Multi-agent setup for **doing work on Solana** while **ASH** remains the spend authority.
Orchestrators plan and quote; only the executor pays, under policy, through `execute_payment`.

Raydium, Orca, and most AMM volume are reached through **Jupiter** routing — one integration
surface instead of N protocol SDKs. ASH still does not CPI into those programs; it funds
a **desk wallet** you control, then the desk signs the swap Jupiter returns.

## Roles

| Role | MCP | Pays |
|---|---|---|
| **Orchestrator** | ASH readonly + workflow Jupiter | No |
| **Analyst** | Jupiter (via workflow export) | No |
| **Executor** | ASH full + Jupiter | Yes — desks and vendors only |

```
  Analyst / Orchestrator          Executor                    Treasury
  jupiter_quote ───────────────▶ plan + reference id
                                  ash_execute_payment ──▶ swap-desk ATA
                                  sign jupiter_swap_transaction from desk key
```

## Setup (devnet)

```bash
pnpm install && pnpm build

pnpm ash init \
  --out ~/.ash/workstation \
  --name workstation-usdc \
  --mock-mint --mock-mint-decimals 6 \
  --token-per-tx 50 --token-daily 200 --token-lifetime 1000 --token-deposit 1000 \
  --per-tx 0.01 --daily 0.05 --lifetime 0.2 \
  --session-ttl 2 \
  --yes

pnpm ash dest add --out ~/.ash/workstation \
  --label swap-desk --owner <SWAP_DESK_WALLET> --yes

# Optional: vendor pay_to wallets (oracle, compute, …) from packages/vendors
```

Create sessions after you approve a plan:

```bash
pnpm ash session create --out ~/.ash/workstation \
  --label plan-<id> --session-ttl 2 --yes
```

## Runner config

From the dashboard **Templates → Solana agent workstation**, or wire MCP manually:

- `ash-mcp` with `ASH_TOOLS=full` on the executor only.
- `ash-integrations mcp jupiter` on the workflow (shared by orchestrator and analyst).
- `ash-integrations mcp sodax` on the workflow for anything that leaves Solana (below).

See `mcp/executor.cursor.json` and `mcp/orchestrator.cursor.json` in this folder.

## Cross-network: SODAX (mainnet only)

Jupiter stays the route for swaps inside Solana. SODAX covers what Jupiter cannot: swaps into
other networks, bridging, the SODAX money market and leverage-yield vaults. Same shape — the
treasury pays the desk, the connector builds an **unsigned** intent, the desk signs:

```
sodax_quote ─▶ ash_execute_payment ─▶ desk
sodax_build_swap | _bridge | _mm_action | _vault_action ─▶ desk signs + sends
sodax_submit (swap, bridge) or sodax_relay (money market, vaults) ─▶ sodax_status until done
```

- **Mainnet only.** SODAX has no devnet; the devnet setup above cannot exercise it. Use a
  mainnet desk with small amounts.
- **Recipients are operator configuration.** `SODAX_ALLOWED_DESTINATIONS` lists every
  `<chainKey>:<address>` a build may deliver to. Empty means funds may only return to the
  signing desk on its own chain. Agents cannot change it.
- Optional: `SODAX_API_KEY` (partner portal), `SODAX_PARTNER_FEE_ADDRESS` +
  `SODAX_PARTNER_FEE_BPS`, `SODAX_SOLANA_RPC_URL`, `SODAX_HUB_RPC_URL`.

Design and the failure modes to plan for: `docs/product/sodax-integration.md`.

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

- On-chain swaps from the treasury program (no DEX CPI in `ash`).
- Unattended mainnet execution without audit and guardian runbooks.
- Letting the model pick arbitrary pool addresses as payment destinations.
