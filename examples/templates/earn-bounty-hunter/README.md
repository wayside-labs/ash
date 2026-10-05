# Earn bounty hunter

Three agent roles work a [Superteam Earn](https://earn.superteam.fun) bounty from listing to a
draft submission. Only the builder can spend, only on allowlisted vendors, only up to a cap
per bounty. A person submits.

## What would go wrong without ASH

The builder needs money to finish a bounty: RPC credits, inference, a hosted preview. Hand it
a funded hot wallet and every listing, README and dependency it reads becomes a prompt that
can ask it to pay somewhere else. A single injected "send the deployment fee to …" is the
whole wallet. With ASH the builder holds a session key that can reach three labelled
vendors, 0.05 SOL at a time, 0.2 SOL a day, 1 SOL ever — and an injected raw address is
refused before it reaches the chain (`ASH_SECURITY=balanced` resolves labels only;
the `Allowlist` policy refuses the rest on-chain).

## Roles

```
                 ┌───────────────┐   ≤3 listings   ┌────────────────┐   brief.md   ┌──────────────────┐
  earn listings ─▶│ scout         │────────────────▶│ research       │─────────────▶│ builder          │
                 │ MCP: fetch    │  shortlist.md   │ MCP: fetch     │  (human picks │ MCP: ash │
                 │ pays: never   │                 │ pays: never    │   one bounty) │ pays: vendors    │
                 └───────────────┘                 └────────────────┘              └────────┬─────────┘
                                                                                            │ execute_payment
                                                                                            ▼
                                                                          rpc-credits · inference · hosting
                                                                                            │
                                     human reviews the repo and submits on Earn ◀───────────┘
```

| Role | Prompt | MCP config | Can pay |
|---|---|---|---|
| Scout | [`agents/scout.md`](agents/scout.md) | [`mcp/scout.cursor.json`](mcp/scout.cursor.json) | No — no rails MCP in its process |
| Research | [`agents/research.md`](agents/research.md) | [`mcp/scout.cursor.json`](mcp/scout.cursor.json) (same, read-only) | No |
| Builder | [`agents/builder.md`](agents/builder.md) | [`mcp/builder.cursor.json`](mcp/builder.cursor.json) | Yes, within the policy below |

Orchestration is files and a person, on purpose: the scout writes `shortlist.md`, research
writes `brief.md` for the bounty the operator picked, the builder works from `brief.md`. There
is no dashboard chat step and no agent-to-agent tool — each hand-off is a point where a person
can stop the run.

The two approval gates:

1. **Which bounty.** The operator picks one row of `shortlist.md` before research starts.
2. **Submission.** Earn submissions are tied to a person's account and are judged as a
   person's work. The builder produces a repo and a draft write-up; the operator submits.

## Setup (devnet)

```bash
pnpm install && pnpm build

# 1. Treasury, SOL policy, one throwaway destination. Out dir keeps this template's keys apart.
pnpm ash init \
  --out ~/.ash/earn \
  --name earn-builder \
  --per-tx 0.05 --daily 0.2 --lifetime 1 \
  --deposit 1 \
  --session-ttl 72 \
  --yes

# 2. Allowlist the vendors the builder may pay. On devnet these are wallets you control
#    standing in for the vendor; on a real deployment, the vendor's receiving wallet.
for pair in rpc-credits:<RPC_VENDOR_WALLET> inference:<INFERENCE_VENDOR_WALLET> hosting:<HOSTING_VENDOR_WALLET>; do
  pnpm ash dest add --out ~/.ash/earn \
    --label "${pair%%:*}" --owner "${pair#*:}" --yes
done
pnpm ash dest rm --out ~/.ash/earn --label demo --yes

# 3. One session per bounty, so a revoke ends exactly one run.
pnpm ash session create --out ~/.ash/earn \
  --label earn-<bounty-slug> --session-ttl 72 --yes
```

`session create` prints the session PDA and writes a `0600` keypair under
`~/.ash/earn`. Put both into `mcp/builder.cursor.json`. The limits are also in
[`policy.example.json`](policy.example.json) for review.

Every SOL destination has to exist as a system account before `execute_payment_sol` can pay
it — fund each vendor stand-in with ≥ 0.002 SOL on devnet.

## The payment moment

The builder calls `ash_check_payment`, then `ash_execute_payment` with:

| Field | Value | Why |
|---|---|---|
| `destination_ref` | `rpc-credits`, `inference` or `hosting` | Labels only; a raw address is refused |
| `amount` | human units, e.g. `"0.02"` | Converted with the mint's decimals |
| `mint_ref` | `SOL` | |
| `reference` | `<bounty-slug>/<vendor>/<invoice-or-period>` | A retry of the same purchase collides on its receipt |

On `indeterminate`, the builder calls `ash_get_payment_status` with the intent id and
waits; it never re-sends. `agents/builder.md` spells this out for the model.

## Kill switch and alerts

- `ASH_ALERT_WEBHOOK_URL` in the builder's env posts every denial (a builder hitting
  its cap mid-bounty is the signal to look).
- `pnpm ash session revoke --session <PDA>` ends the run without touching the
  treasury. `pnpm ash pause` stops every session on the policy; withdraw still works.
- For unattended runs, [`guardian-watch`](../../../docs/runbooks/guardian-watch.md) pauses when
  a session burns 80% of its short window.

## Scaffolds

Solana bounties usually start from a scaffold, not an empty repo. The builder prompt points at
`npx create-solana-dapp` for app bounties. Composition, not coupling: the scaffold is *what*
gets built; this template is *how the agent pays* while building it. Nothing in the scaffold
needs to know about ASH.

## Out of scope for v1

- Automatic Earn submission, or any agent acting under the operator's Earn account.
- Letting the builder pay collaborators, bounty sponsors, or anything outside the three labels.
- Receiving the bounty reward into the treasury. Rewards go to the person who submitted.
