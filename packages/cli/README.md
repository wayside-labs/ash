# `@ash/cli`

The operator-facing CLI. `init` bootstraps a treasury; day-2 commands manage limits, sessions,
destinations, funding, and emergency controls. Agents pay via MCP — this package never executes
payments.

```bash
ash init
ash status
ash doctor
```

## Command reference

| Command | Role | On-chain instruction | Idempotent? |
|---|---|---|---|
| `init` | owner/operator (bootstrap) | `create_treasury`, `add_mint`, `create_policy`, `add_allowlist_entry`, `create_session` | Yes (resume + shortfall funding) |
| `status` | any | read-only | Yes |
| `doctor` | any | read-only | Yes |
| `mcp emit` | any | none | Yes |
| `deposit --amount <sol>` | funder | System transfer → `sol_vault` | Yes (shortfall to target) |
| `withdraw --amount --to [--mint]` | owner | `withdraw` | No |
| `pause` | owner or guardian | `pause` | Yes if already paused |
| `unpause` | owner | `unpause` | Yes if not paused |
| `ceiling set` | owner | `set_ceiling` | No (rewrites ceiling) |
| `policy show` | any | read-only | Yes |
| `policy set` | operator or owner | `update_policy` / `create_policy` | No (full `PolicyInput` rewrite) |
| `dest add|rm|ls` | operator or owner | `add_allowlist_entry` / `remove_allowlist_entry` | add: no; rm: no; ls: yes |
| `session create|revoke|close` | operator or owner | `create_session` / `revoke_session` / `close_session` | create: resume-safe |
| `session ls|show` | any | read-only | Yes |

Global flags on day-2 commands: `--rpc`, `--wallet`, `--out`, `--treasury`, `--policy`,
`--policy-name`, `--mcp-entry`, `-y`, `--json`, `--dry-run`.

Human output goes to **stderr**; `--json` writes **stdout** only.

## What `init` does

Five instructions, in the only order that works, plus funding and MCP config. See the table
above. Re-running is safe: chain state drives resume, funding is shortfall-to-target.

## Local development (surfnet / localnet)

```bash
surfpool start --ci -n devnet -p 8899 -w 8900 --no-studio
# deploy ash.so at the declared program id (see packages/e2e)
pnpm ash init --rpc http://127.0.0.1:8899 --yes
pnpm ash status
pnpm ash session create --label agent-2 --yes
pnpm ash policy set --per-tx 0.05 --yes
pnpm ash dest add --label vendor-2 --owner <addr> --yes
pnpm ash mcp emit
```

Manifest path: `.ash/localnet.json` for `127.0.0.1:8899`.

## Examples

```bash
# Observe
ash status --rpc http://127.0.0.1:8899
ash doctor

# Fund (shortfall semantics — same as init --deposit)
ash deposit --amount 0.5 --yes

# Owner withdraw
ash withdraw --amount 0.1 --to <wallet> --yes

# Limits
ash ceiling set --mint SOL --per-tx 1 --daily 10 --yes   # owner
ash policy set --per-tx 0.05 --daily 0.5 --yes          # operator

# Destinations (labels, not raw pubkeys in agent UX)
ash dest add --label vendor-1 --owner <addr> --yes
ash dest ls

# Sessions
ash session create --label billing-bot --session-ttl 48 --yes
ash session revoke --session <pda> --yes

# Emergency
ash pause --yes
ash unpause --yes   # owner only
```
