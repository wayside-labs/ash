# Capped yield rebalance

Stablecoin capital moves toward the better of a few operator-chosen lending venues, in capped
steps, with a person approving each step. This is not a trading bot: one asset class
(stablecoins), a short venue allowlist, a weekly-scale cadence, and a policy that makes the
worst week small.

## What would go wrong without Agent Rails

"Let the agent chase yield" is how treasuries get drained in public. The failure modes are
the model's, not the protocol's: it reads a 60% APY on a strategy nobody vetted and moves
everything; a poisoned forum post tells it the "new vault address"; it rebalances every hour
because each move looks locally optimal. Here:

- **Venue allowlist** — the executor can pay two desk labels and nothing else. A new venue is
  a `dest add` an operator runs, never something the agent finds.
- **Step cap** — 100 USDC per move, 200 a day, 1,000 lifetime on devnet. A wrong call costs
  one step, not the treasury.
- **Human gate** — the planner writes a proposal; the operator decides whether the executor
  runs it. `AGENT_RAILS_SECURITY=strict` adds a second, in-process gate on top.
- **Kill switch** — `guardian-watch` pauses the policy when a session burns through half its
  window; the owner can still withdraw while paused.

## Roles

```
 ┌──────────────────┐ rates.json ┌───────────────────┐ proposal.md ┌───────────┐ approved ┌───────────────────┐
 │ scout-rates.sh   │───────────▶│ planner (agent)   │────────────▶│ operator  │─────────▶│ executor (agent)  │
 │ read-only script │            │ MCP: fetch only   │             │ approves  │          │ MCP: agent-rails  │
 │ venue allowlist  │            │ pays: never       │             │ or not    │          │ pays: desk labels │
 └──────────────────┘            └───────────────────┘             └───────────┘          └─────────┬─────────┘
                                                                                                    │ check → execute
                                                        treasury vault (USDC) ──────────────────────┘
                                                                   │
                                                  ┌────────────────┴─────────────────┐
                                                  ▼                                  ▼
                                          desk-kamino (wallet)               desk-save (wallet)
                                                  │ deposit into venue, separate key │
                                                  ▼                                  ▼
                                             Kamino Lend                          Save
```

| Role | What it is | MCP | Can pay |
|---|---|---|---|
| Scout | [`scripts/scout-rates.sh`](scripts/scout-rates.sh), DefiLlama yields API filtered to `VENUES` | none | No |
| Planner | [`agents/planner.md`](agents/planner.md) | [`mcp/planner.cursor.json`](mcp/planner.cursor.json) (fetch) | No |
| Executor | [`agents/executor.md`](agents/executor.md) | [`mcp/executor.cursor.json`](mcp/executor.cursor.json) | Yes, desk labels only |
| Guardian | `scripts/guardian-watch.ts` | — | Pause only |

**Should the planner get `check_payment`?** Optionally. With `AGENT_RAILS_TOOLS=readonly` the
rails MCP registers the reads and `agent_rails_check_payment` but not
`agent_rails_execute_payment`, so the planner can dry-run its own proposal without being able to
send it. The process still loads the session key — simulation signs — so run a readonly planner
only on a host you would trust with that key, bound to the same short session. The default here
is stricter: the planner has no rails MCP, and the executor dry-runs every step, stopping on the
first denial.

## Desk wallets, not venue addresses

`execute_payment` is a transfer to the token account of an allowlisted owner. A lending
deposit is an instruction to the venue's program, not a transfer. Sending USDC straight to a
reserve's token account does not give the treasury a position; it gives the reserve a gift.

So each venue gets a **desk wallet** the operator controls, allowlisted under a label
(`desk-kamino`, `desk-save`). The executor moves capital to a desk; the deposit into the venue
is signed from the desk, by a person in the venue's own UI in v1. Pulling capital back is the
reverse: withdraw from the venue into the desk, and send it back to the treasury from the desk.
The treasury's exposure to any one desk is bounded by the policy, and the desk's key is not an
agent's key.

## Setup (devnet)

```bash
pnpm install && pnpm build

# 1. Treasury with 6-decimal mock USDC. Token limits at init (scaled by the mint's decimals).
pnpm agent-rails init \
  --out ~/.agent-rails/yield \
  --name yield-usdc \
  --mock-mint --mock-mint-decimals 6 \
  --token-per-tx 100 --token-daily 200 --token-lifetime 1000 --token-deposit 1000 \
  --per-tx 0.000001 --daily 0.000001 --lifetime 0.000001 \
  --session-ttl 1 \
  --yes

# 2. One desk per venue. Open each desk's token account; drop init's demo destination.
for pair in desk-kamino:<KAMINO_DESK_WALLET> desk-save:<SAVE_DESK_WALLET>; do
  pnpm agent-rails dest add --out ~/.agent-rails/yield \
    --label "${pair%%:*}" --owner "${pair#*:}" --yes
  spl-token create-account <MOCK_USDC_MINT> --owner "${pair#*:}" \
    --fee-payer <OPERATOR_KEYPAIR> --url devnet
done
pnpm agent-rails dest rm --out ~/.agent-rails/yield --label demo --yes

# 3. A short session per approved proposal — the approval is the session.
pnpm agent-rails session create --out ~/.agent-rails/yield \
  --label rebal-<proposal-id> --session-ttl 2 --yes
```

Creating the session *after* the operator approves a proposal makes the approval concrete: no
approved proposal, no live session, nothing the executor can sign. Two hours is enough to run
one proposal and short enough that a forgotten session expires on its own.

**Token units.** Tighten limits at `init` or confirm with `policy show`: `policy set --mint`
parses amounts at 9 decimals. See [the templates index](../README.md#wiring-a-template).

## Running one rebalance

```bash
# 1. Scout — read-only, safe to run any time.
OUT=rates.json examples/templates/defi-yield-rebalance/scripts/scout-rates.sh

# 2. Planner — in Cursor / Claude with mcp/planner.cursor.json and agents/planner.md.
#    Produces proposal.md.

# 3. Operator reads proposal.md. If approved: session create (above), paste the session PDA
#    into mcp/executor.cursor.json, and run the executor with agents/executor.md.

# 4. Deposit from each desk into its venue, by hand, in the venue's UI.

# 5. Revoke the session when done, even though it expires on its own.
pnpm agent-rails session revoke --out ~/.agent-rails/yield --session <SESSION_PDA> --yes
```

## Guardian and alert thresholds

| Watcher | Setting | Why this value |
|---|---|---|
| `guardian-watch` | `--window short --threshold-bps 5000` | Half the hourly window in one session is already more than one approved step should need — pause, then look |
| `alert-watch` | default (80% of either window) | Headroom warning for the operator, no action |
| MCP denials | `AGENT_RAILS_ALERT_WEBHOOK_URL` in the executor env | A denied step means the proposal and the policy disagree; a person should know |

```bash
pnpm guardian-watch --rpc https://api.devnet.solana.com \
  --treasury <TREASURY_PDA> --policy <POLICY_PDA> \
  --guardian-keypair /secure/guardian-keypair.json \
  --window short --threshold-bps 5000 --interval 30
```

Start with `--dry-run` for a week of proposals before letting it pause. Setup of the guardian
key is in [`docs/runbooks/guardian-watch.md`](../../../docs/runbooks/guardian-watch.md); alert
routing in [`docs/runbooks/alert-webhooks.md`](../../../docs/runbooks/alert-webhooks.md).

## Out of scope for v1

- **Leverage** of any kind: borrowing against deposits, looping, perps.
- **Anything but stablecoins**, and in particular memecoins, LP positions, or volatile pairs.
- **Unlimited or open-ended trading**: no destination the agent chooses, no cadence faster than
  a person can review, no removal of the lifetime cap.
- **Automated venue deposits.** The desk step is manual. Automating it means a key with no
  Agent Rails policy in front of it; it needs its own design and review.
- **Mainnet.** Real funds wait on the trust phases in the root `README.md`, and on a venue
  review that is not a line in `VENUES`.
