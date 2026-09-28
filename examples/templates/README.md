# Agent templates

Three starter setups that show a real product using Agent Rails as its **spend authority**:
the layer that decides whether money may move, not the layer that decides what to buy. Each
template is docs, config snippets, and at most a thin shell script. None of them adds a
program instruction, an MCP tool, or a package.

| Template | What the agent does | Where the payment moment is | Who runs it |
|---|---|---|---|
| [`earn-bounty-hunter/`](earn-bounty-hunter/) | Scouts Superteam Earn, researches, builds | Builder pays capped vendors (RPC, inference, hosting) per bounty | Three agent roles, one of them holds the rails MCP |
| [`dca-sol/`](dca-sol/) | Nothing — no model in the loop | Cron moves a fixed USDC slice to an allowlisted swap desk each period | `cron` + `agent-rails pay` |
| [`defi-yield-rebalance/`](defi-yield-rebalance/) | Reads rates, proposes a capped rebalance | Executor moves USDC to an allowlisted per-venue desk wallet | Script scout, planner agent, executor agent, guardian |

Devnet first, all three. Nothing here is a mainnet promise; see the trust phases in the root
`README.md` before pointing any of it at real funds.

## How templates relate to the rest of the repo

```
             OPERATOR SURFACES (privileged — ADR-021)              AGENT SURFACE (ADR-007)
  ┌──────────────────────────────────────────────────┐   ┌──────────────────────────────────┐
  │ pnpm agent-rails …        dashboard (/treasury,  │   │ agent-rails-mcp: six tools only  │
  │  init · ceiling set        /limits, /workflows)  │   │  get_session   get_policy        │
  │  policy set · dest add                           │   │  list_destinations               │
  │  session create · pause   scripts/guardian-watch │   │  get_payment_status              │
  │  withdraw · audit export  scripts/alert-watch    │   │  check_payment execute_payment   │
  └──────────────────┬───────────────────────────────┘   └────────────────┬─────────────────┘
                     │ writes ceilings, policy,                           │ signs with the
                     │ allowlist, sessions                                │ session key only
                     ▼                                                    ▼
            ┌──────────────────────────────────────────────────────────────────────┐
            │ agent_rails program: Treasury ─ Policy ─ AgentSession ─ IntentReceipt │
            │ refuses any payment that breaks a ceiling, window, allowlist, expiry │
            └──────────────────────────────────────────────────────────────────────┘
                                           │ transfer from the vault
                                           ▼
                                allowlisted destination owners
                        (vendors, a swap desk, per-venue yield desks)
```

Every template keeps to the same three rules:

1. **Only the role that pays gets `agent-rails-mcp`.** Scouts, researchers and planners run
   with read-only MCPs (fetch, search) or none. The MCP server has no read-only mode, so an
   agent that can call `check_payment` can also call `execute_payment` — the split is by
   *which process has the config*, not by which tools the model is told to use.
2. **Every privileged step is a command a person runs.** Ceilings, policy, allowlist entries
   and sessions come from the CLI or the dashboard. No template asks an agent to widen its
   own limits, and none ships a tool that could (`AGENT_TOOL_NAMES` in
   `packages/contract/src/mcp-tools.ts` is the complete list).
3. **`reference` is chosen so a retry collides.** The intent id is derived from
   `{session, destination, mint, amount, reference}` (ADR-004), so a reference built from the
   *thing being paid for* — a bounty slug, a DCA period, a rebalance proposal id — turns a
   duplicate run into a refused duplicate instead of a second transfer.

## What Agent Rails does not do in these templates

- **It does not swap and it does not deposit into protocols.** `execute_payment` is a
  transfer from the vault to the token account of an allowlisted destination owner. Paying a
  protocol's pool or vault token account directly would be a donation, not a deposit. The
  DCA and yield templates therefore pay a *desk wallet* the operator controls; the swap or the
  deposit happens from that wallet, as a separate, human-signed or separately-keyed step.
- **It does not choose.** Which bounty, which venue, how much this week: that is the model's or
  the schedule's job. Agent Rails bounds the worst case of a bad choice.
- **It does not run the agents.** The dashboard exports a runner config
  (`/api/export/runner-config`); Cursor, Claude Desktop or your own process runs it.

## Wiring a template

| Step | Surface | Command / page |
|---|---|---|
| 1. Treasury + first policy | CLI | `pnpm agent-rails init …` (flags per template) |
| 2. Allowlist destinations | CLI or dashboard | `pnpm agent-rails dest add --label … --owner …` |
| 3. Tighten limits | CLI or dashboard `/limits` | `pnpm agent-rails policy set …` (read the token-units note below) |
| 4. Session for the paying role | CLI or dashboard `/workflows` | `pnpm agent-rails session create --label … --session-ttl …` |
| 5. Runner config | template `mcp/*.cursor.json`, or dashboard export | paste the session PDA and key path |
| 6. Kill switch | `scripts/guardian-watch.ts` | [`docs/runbooks/guardian-watch.md`](../../docs/runbooks/guardian-watch.md) |
| 7. Alerts | `AGENT_RAILS_ALERT_WEBHOOK_URL`, `pnpm alert-watch` | [`docs/runbooks/alert-webhooks.md`](../../docs/runbooks/alert-webhooks.md) |

**Token units.** `init --token-per-tx / --token-daily / --token-lifetime` scale by the mint's
own decimals. `policy set` and `ceiling set` currently parse every amount as SOL (9 decimals)
even with `--mint`, so on a 6-decimal USDC mint `--per-tx 5` means 5,000 USDC, not 5. The
ceiling preflight usually refuses it, but do not rely on that: set token limits at `init`,
or divide by 1,000 and confirm with `pnpm agent-rails policy show` before signing anything.

**Dashboard export is per workflow.** `compileRunnerConfig` collects every enabled MCP in
scope for *any* agent in the workflow into one file, so an `agent`-scoped rails MCP still
lands in the scout's config if the scout shares the workflow. Until the export is per
agent, use the template's per-role `mcp/*.cursor.json` files, or put the paying role in its
own workflow.

`policy.example.json` in each template is a statement of intent for a reviewer: no tool reads
it. The commands in each README are what apply it.
