# Agent templates

Five starter setups. Four show a real product using Agent Rails as its **spend authority**:
the layer that decides whether money may move, not the layer that decides what to buy. Each of
those is docs, config snippets, and at most a thin shell script, and none of them adds a
program instruction, an MCP tool, or a package. The fifth, `cloak-private-payout/`, is the
exception: it pays from the operator's own wallet, outside the vault. It adds a package
(`packages/cloak`) and a contract module (`@agent-rails/contract/template-run`), runs on mainnet
only, and is triggered from the dashboard chat. It still adds no program instruction and no MCP
tool.

| Template | What the agent does | Where the payment moment is | Who runs it |
|---|---|---|---|
| [`earn-bounty-hunter/`](earn-bounty-hunter/) | Scouts Superteam Earn, researches, builds | Builder pays capped vendors (RPC, inference, hosting) per bounty | Three agent roles, one of them holds the rails MCP |
| [`dca-sol/`](dca-sol/) | Nothing — no model in the loop | Cron moves a fixed USDC slice to an allowlisted swap desk each period | `cron` + `agent-rails pay` |
| [`defi-yield-rebalance/`](defi-yield-rebalance/) | Reads rates, proposes a capped rebalance | Executor moves USDC to an allowlisted per-venue desk wallet | Script scout, planner agent, executor agent, guardian |
| [`solana-workstation/`](solana-workstation/) | Orchestrate Solana tasks, Jupiter quotes | Executor pays desks/vendors; desk signs swaps | Orchestrator, analyst, executor |
| [`cloak-private-payout/`](cloak-private-payout/) | Drafts a payout list in the chat; holds no key | The operator's own wallet shields into Cloak's pool and pays each payee from it, in SOL or ZEC (**mainnet**, no vault) | Chat model drafts, the operator approves a card and each wallet prompt, a browser runner executes |

Devnet first for the four vault-backed templates. Nothing here is a mainnet promise; see the trust
phases in the root `README.md` before pointing any of it at real funds. `cloak-private-payout/` is
the other case: mainnet only (the published Cloak SDK has no devnet), real funds in small amounts
from a throwaway wallet, off unless its flag is set. It never touches the vault or the program,
which is what the trust phases are about; its README says what applies to it instead.

## How templates relate to the rest of the repo

```
             OPERATOR SURFACES (privileged — ADR-021)              AGENT SURFACE (ADR-007)
  ┌──────────────────────────────────────────────────┐   ┌──────────────────────────────────┐
  │ pnpm agent-rails …        dashboard (/treasury,  │   │ agent-rails-mcp: seven tools     │
  │  init · ceiling set        /limits, /workflows)  │   │  get_session   get_policy        │
  │  policy set · dest add                           │   │  list_destinations               │
  │  session create · pause   scripts/guardian-watch │   │  get_payment_status              │
  │  withdraw · audit export  scripts/alert-watch    │   │  check_payment execute_payment   │
  │                                                  │   │  request_limit_increase (asks)   │
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

The diagram and the rules below describe the four vault-backed templates. The Cloak template sits
outside the picture: no vault, ceiling, policy, allowlist or session. It keeps the first two rules
in spirit (no model holds a key, and every step that moves funds is a person's approval in a
wallet), has no rails MCP and no `reference`, so the third does not apply, and has rules of its own
in [its README](cloak-private-payout/README.md) and ADR-027.

The four vault-backed templates keep to the same three rules:

1. **Only the role that pays gets `agent-rails-mcp` with `AGENT_RAILS_TOOLS=full`.** Scouts and
   planners use fetch/search MCPs, or `AGENT_RAILS_TOOLS=readonly` on the rails MCP (check/list
   only). Download runner config **per agent** from the dashboard agent settings MCP tab, not
   the workflow row (shared export omits agent-scoped servers).
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

This table is for the four vault-backed templates. `cloak-private-payout/` has its own setup, a
throwaway wallet and three public environment variables, in its README.

| Step | Surface | Command / page |
|---|---|---|
| 1. Treasury + first policy | CLI | `pnpm agent-rails init …` (flags per template) |
| 2. Allowlist destinations | CLI or dashboard | `pnpm agent-rails dest add --label … --owner …` |
| 3. Tighten limits | CLI or dashboard `/limits` | `pnpm agent-rails policy set …` (read the token-units note below) |
| 4. Session for the paying role | CLI or dashboard `/workflows` | `pnpm agent-rails session create --label … --session-ttl …` |
| 5. Runner config | template `mcp/*.cursor.json`, or dashboard export | paste the session PDA and key path |
| 6. Kill switch | `scripts/guardian-watch.ts` | [`docs/runbooks/guardian-watch.md`](../../docs/runbooks/guardian-watch.md) |
| 7. Alerts | `AGENT_RAILS_ALERT_WEBHOOK_URL`, `pnpm alert-watch` | [`docs/runbooks/alert-webhooks.md`](../../docs/runbooks/alert-webhooks.md) |

**Token units.** `init --token-per-tx / --token-daily / --token-lifetime`, `policy set`, and
`ceiling set` all parse amounts in **human units for the mint** (`--per-tx 5` on USDC is 5
USDC). Confirm with `pnpm agent-rails policy show` before signing.

**Dashboard export.** The workflow row downloads **shared** MCPs (global + workflow scope).
Per-role rails MCPs: agent settings → MCP tab → **Download .mcp.json**, or the template's
`mcp/*.cursor.json` files.

`policy.example.json` in each template is a statement of intent for a reviewer: no tool reads
it. The commands in each README are what apply it.
