# Guardian watch (`scripts/guardian-watch.ts`)

Minimal **Guardian-as-a-Service** watcher for Agent Rails treasuries on devnet/mainnet.

The owner opts in by adding your pubkey with `agent-rails guardian add`. The guardian key may
call **`pause` only** — not unpause, withdraw, or policy edits. Revoke anytime with
`guardian rm`. While paused, agents cannot pay; **owner `withdraw` still works** (program
invariant, ADR-002).

## Prerequisites

```bash
pnpm build   # needs packages/client and packages/sdk dist/
```

Generate a dedicated hot key (never commit it):

```bash
solana-keygen new -o guardian-keypair.json --no-bip39-passphrase
```

## Configure the treasury

As **owner**:

```bash
pnpm agent-rails guardian add --address "$(solana address -k guardian-keypair.json)" \
  --wallet <owner> --out <manifest-dir> --yes
```

Default `init` uses a **1h short window** (`shortWindowSeconds: 3600`) and sets policy
`short_window_max` from the operator’s `--daily` cap (owner **ceiling** is separate and not
read by the watcher). The default rule is **per live session × mint**: rolled short-window
spend vs `--threshold-bps` (default `8000` = 80% of policy `short_window_max`).

## Run the watcher

One-shot check (cron-friendly):

```bash
pnpm guardian-watch \
  --rpc https://api.devnet.solana.com \
  --treasury <TREASURY> \
  --policy <POLICY> \
  --guardian-keypair ./guardian-keypair.json \
  --once
```

Loop every 30s:

```bash
pnpm guardian-watch ... --interval 30
```

Dry-run (log breaches, do not send `pause`):

```bash
pnpm guardian-watch ... --once --dry-run
```

Environment aliases: `AGENT_RAILS_RPC`, `AGENT_RAILS_TREASURY`, `AGENT_RAILS_POLICY`,
`AGENT_RAILS_GUARDIAN_KEYPAIR`.

Exit codes: `0` = no action, `2` = pause sent (`--once`), `1` = error.

## Devnet proof checklist

1. Bootstrap a treasury (`pnpm agent-rails init` or `scripts/demo.sh`).
2. Add the guardian key (above).
3. Pay enough to exceed 80% of the **short window** limit (or lower `--threshold-bps` for a
   smaller test, e.g. `100` = 1%).
4. Run `pnpm guardian-watch ... --once` — expect `pause confirmed: <sig>`.
5. Confirm agents cannot pay (`agent-rails pay` → paused).
6. As owner, `pnpm agent-rails withdraw --amount 0.001 --yes` — must succeed while paused.
7. `pnpm agent-rails unpause` (owner only), then `guardian rm` when done.

Full narrative and troubleshooting: [`docs/runbooks/guardian-watch.md`](../docs/runbooks/guardian-watch.md).
