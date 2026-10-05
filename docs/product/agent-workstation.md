# Agent workstation (product architecture)

**Status:** v0.1 shipped in repo · **Audience:** engineers and operators

## What it is

An **agent workstation** is a workflow in the dashboard (or a template under `examples/templates/`)
where several agents cooperate. **ASH** is always the payment rail: caps, allowlists,
sessions, audit chain. **Integrations** (`@ash/integrations`) are read/build connectors
(quotes, unsigned transactions, catalogs). **Vendors** (`@ash/vendors`) are pay-per-use
HTTP services settled through the same payment tools.

```
┌─────────────────────────────────────────────────────────────┐
│ Dashboard: workflows, canvas, templates, runner export       │
└───────────────┬───────────────────────────────┬───────────────┘
                │ operator (CLI / dashboard)     │ agent runners
                ▼                                ▼
         ceilings · policy · sessions      MCP: rails + integrations + vendors
                │                                │
                └────────────┬───────────────────┘
                             ▼
                    ash program (transfers only)
                             ▼
              allowlisted desks · vendor pay_to · treasury children
```

## Invariants (unchanged)

1. No agent MCP tool escalates privilege (`create_session`, `update_policy`, etc. stay off MCP).
2. DEX and lending **actions** happen outside `execute_payment`, typically from a **desk wallet**
   or future mandate PDA — never by paying a protocol vault token account.
3. Rails (braço 1) does not depend on Mandate (braço 2).

## Ecosystem map

Canonical list: `@ash/contract` → `SOLANA_DAPPS` (`solana-dapps.ts`). Jupiter is **live**
via MCP for swaps inside Solana; SODAX is **live** via MCP for everything that crosses networks
(swaps to 22 networks, bridge, money market, leverage-yield vaults — `docs/product/sodax-integration.md`,
ADR-025); Raydium and Orca are **catalog + Jupiter routes**; Kamino and Drift follow desk-wallet
and delegation patterns described in strategy docs.

## Adding a connector

1. Add metadata to `packages/contract/src/solana-dapps.ts`.
2. Implement MCP under `packages/integrations/src/` (no payment keys in the connector).
3. Register in `workstation-integrations.ts` if it ships with a built-in template.
4. Document desk-wallet or mandate requirements in `examples/templates/`.

**Dynamic (user-defined) connectors:** declarative bundles only — Python FastMCP host at
`services/connector-host` (`docs/runbooks/fastmcp-connector-layer.md`). Chat may emit bundle
JSON; agents mount the host alongside static `@ash/mcp` and `@ash/integrations`.

## Money

- **Now:** hosted dashboard, guardian service, indexer (strategy §8).
- **Connectors:** commercial adapters off-chain; settlement still via rails for agent spend.
- **Later:** mandate bps on capital under envelope (braço 2).
