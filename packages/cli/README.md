# `@agent-rails/cli`

The operator-facing CLI. `init` takes a developer from an empty wallet to an agent that can
make a guarded payment, in one command.

```bash
agent-rails init
```

## What `init` does

Five instructions, in the only order that works, plus the funding and configuration around
them:

| Step | Instruction | Why it is where it is |
|---|---|---|
| 1 | `create_treasury` | Seeded by an ephemeral `create_key` that signs once and is discarded |
| 2 | `add_mint` | Sets the owner's native-SOL ceiling. Must precede the policy |
| 3 | `create_policy` | The operator's limits, which `policy_leq_ceiling` requires to be `<=` the ceiling |
| 4 | `add_allowlist_entry` | The one destination the agent may pay |
| 5 | `create_session` | The agent's time-boxed key. The program refuses a privileged key here |

With `--mint` or `--mock-mint` two more land between steps 2 and 3: a second `add_mint`
for the SPL mint (which creates the treasury's vault ATA), and an idempotent
`CreateAssociatedTokenAccount` for the destination.

It then funds the SOL vault, funds a separate fee payer, writes the session keypair to disk,
and prints the `mcpServers` block for `claude_desktop_config.json`.

## Paying in USDC or an SPL token

```bash
agent-rails init --mint 4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU   # devnet USDC
agent-rails init --mock-mint --token-deposit 5000                      # a token you can spend
```

The two flags solve different problems. `--mint` accepts a mint that already exists and
reads its decimals and token program off the chain, so it works for devnet USDC, for a
Token-2022 mint, and for anything a team already issues — but it cannot fund the vault,
because only that mint's authority can. `--mock-mint` creates a six-decimal mint this
wallet controls and mints `--token-deposit` into the vault, which is the only way a fresh
cluster gets a spendable token balance.

Native SOL is always configured as well, never replaced: it is the one path that needs no
token account and no counterparty, so it always works.

Token limits are given in human units and scaled by the mint's own decimals:

```
--token-per-tx <amount>    default 10
--token-daily <amount>     default 100
--token-lifetime <amount>  default 30x --token-daily
--token-deposit <amount>   default 1000   (--mock-mint only)
--mock-mint-decimals <n>   default 6
```

The destination's token account is opened during `init` rather than at payment time. That
is what lets the treasury keep `allow_create_destination_ata` false: the payment path never
needs the power to open an account, and the one-off rent is paid by the operator at setup.

The emitted MCP config declares `AGENT_RAILS_MINT_ALIASES`, so the agent can say
`mint_ref: "USDC"` instead of a base58 address.

## Three keys, three jobs

`init` never reuses one key for two roles, because the program is built on the assumption
that they are different:

- **Wallet** (`--wallet`, default `~/.config/solana/id.json`) — owner and operator. Sets
  ceilings and policy. Never leaves your machine.
- **Session key** (generated, `<out>/session-keypair.json`) — the agent's key. It authorizes
  a payment and nothing else. `create_session` rejects it outright if it is the owner,
  operator, or a guardian.
- **Fee payer** (generated, `<out>/fee-payer-keypair.json`) — pays transaction fees and the
  rent for each `IntentReceipt`. Funded with `--fee-budget` so the agent process holds a
  bounded amount and never your main wallet.

Both generated keys are written mode `0600` and match the `**/*keypair*.json` pattern the
repository's `.gitignore` already excludes.

## Re-running is safe

`init` is idempotent. It reads the chain to see which accounts already exist and skips those
steps, and it expresses funding as a shortfall against a target rather than a transfer — so
running it three times leaves the vault holding `--deposit`, not three times `--deposit`.
That matters because the most common first-run failure is a refused devnet airdrop, and the
fix is to re-run.

## Options

```
--rpc <url>              default https://api.devnet.solana.com
--wallet <path>          owner, operator and payer
--out <dir>              default .agent-rails
--name <name>            policy name, max 32 bytes
--destination <address>  the one address the agent may pay (default: generated)
--per-tx <sol>           default 0.1
--daily <sol>            default 1
--lifetime <sol>         default 30x --daily
--deposit <sol>          default 0.5
--fee-budget <sol>       default 0.05
--session-ttl <hours>    default 24
--dry-run                resolve and print the plan, sign nothing
--json                   machine-readable result on stdout
--force                  ignore a recorded treasury and create a new one
```

## Local development

The program is not yet deployed to devnet (ADR-011 governs the program id), so the way to
run this today is against a surfnet with the program installed:

```bash
surfpool start --ci -n devnet -p 8899 -w 8900 --no-studio
# install target/deploy/agent_rails.so at the declared id, as packages/e2e does
agent-rails init --rpc http://127.0.0.1:8899 --yes
```

`init` checks that the program is actually deployed before it signs anything, and says so
when it is not.
