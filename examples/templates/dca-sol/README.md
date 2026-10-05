# DCA into SOL

A fixed USDC slice leaves the treasury on a schedule and goes to a swap desk. Cron decides
*when*. The on-chain policy decides *whether*, and how much. There is no model in this loop,
and that is the point of the template: an LLM is the wrong tool for "every Monday, 5 USDC".

## What would go wrong without ASH

A DCA bot is a hot key that moves money unattended. The usual failures are dull and
expensive: cron fires twice after a host restart and buys twice; a config edit turns `5` into
`500`; the key leaks and the whole balance goes with it. Here:

- **Double fire** — the period (`2026-W40`) is part of the payment `reference`, so both runs
  derive the same intent id. `ash pay` looks the receipt up before sending and finds it; even
  without that check, the program refuses a second receipt for the same intent.
- **Fat finger** — a per-payment and daily cap the cron's key cannot change. `AMOUNT=500`
  is denied on-chain and alerted.
- **Leaked key** — the session key can pay one label, `dca-desk`, within the cap, until the
  session expires or is revoked. It cannot withdraw and cannot add a destination.

## Where the swap happens

ASH does not swap. `execute_payment` transfers USDC from the vault to the token
account of an allowlisted owner. The template allowlists a **desk wallet** the operator
controls, and the swap is a separate step from that wallet:

```
 cron ─▶ dca-cron.sh tick ─▶ ash pay ─▶ [ policy: ≤5 USDC/day, label dca-desk only ]
                                                              │
                                  treasury vault (USDC) ──────┘──▶ desk wallet (USDC)
                                                                        │
                                          swap step, separate key ──────┘──▶ SOL in the desk
                                          (Jupiter UI, or your own script)       │
                                                                                 ▼
                                                                     cold wallet, by hand
```

The desk's exposure is one period's slice. Automating the swap from the desk with its own
key is a reasonable next step; it is deliberately not in this template, because a swap
script holds a key with no policy in front of it and deserves its own review.

Do not allowlist a DEX program account, a pool, or an aggregator's token account as the
destination. A plain transfer to those is not a swap; at best it is lost.

## Setup (devnet)

```bash
pnpm install && pnpm build

# 1. Treasury with a 6-decimal mock USDC. Token limits are set here because `init` scales
#    them by the mint's decimals; SOL limits are near zero because the cron never pays SOL.
pnpm ash init \
  --out ~/.ash/dca \
  --name dca-usdc \
  --mock-mint --mock-mint-decimals 6 \
  --token-per-tx 5 --token-daily 5 --token-lifetime 260 --token-deposit 1000 \
  --per-tx 0.000001 --daily 0.000001 --lifetime 0.000001 \
  --session-ttl 1 \
  --yes

# 2. The desk wallet: allowlist it, open its token account, drop init's demo destination.
pnpm ash dest add --out ~/.ash/dca --label dca-desk --owner <DESK_WALLET> --yes
spl-token create-account <MOCK_USDC_MINT> --owner <DESK_WALLET> --fee-payer <OPERATOR_KEYPAIR> \
  --url devnet
pnpm ash dest rm --out ~/.ash/dca --label demo --yes

# 3. A long-lived session for the cron (a year is the program's maximum).
pnpm ash session create --out ~/.ash/dca --label dca --session-ttl 8760 --yes

# 4. Configure and dry-fire.
cp examples/templates/dca-sol/dca.env.example ~/.ash/dca/dca.env
$EDITOR ~/.ash/dca/dca.env      # TREASURY, SESSION, MINT from the outputs above
examples/templates/dca-sol/scripts/dca-cron.sh tick
examples/templates/dca-sol/scripts/dca-cron.sh tick   # "already settled" — same period
examples/templates/dca-sol/scripts/dca-cron.sh status
```

`<MOCK_USDC_MINT>` is in `~/.ash/dca/devnet.json` after `init`. A 260 USDC lifetime
cap is a year of 5 USDC weeks; when it runs out the cron is denied until the operator decides
to continue, which is the point of a lifetime cap.

**Token units.** Do not tighten this policy with `policy set --mint … --per-tx 5`: that
command parses amounts at 9 decimals, so on a 6-decimal mint it means 5,000 USDC. See
[the note in the templates index](../README.md#wiring-a-template).

## Cron

```cron
# Mondays 14:00 UTC. The script is idempotent per period, so a second line is a safety net
# for a missed run, not a double buy.
0 14 * * 1  /path/to/ash/examples/templates/dca-sol/scripts/dca-cron.sh tick >> ~/.ash/dca/cron.log 2>&1
0 20 * * 1  /path/to/ash/examples/templates/dca-sol/scripts/dca-cron.sh tick >> ~/.ash/dca/cron.log 2>&1
```

Set `CADENCE=weekly` for that schedule. `daily` and `hourly` work the same way; the cadence
only decides what counts as "this period" in the reference.

| Exit | Meaning | What the operator does |
|---|---|---|
| 0 | Settled, or this period already had a receipt | Nothing |
| 1 | Denied, or config error | Read `cron.log` and the sink; the alert webhook fired |
| 75 | Indeterminate — the transfer may exist | Nothing by hand. The next tick in the same period looks the receipt up and pays at most once |

## Guardrails beyond the policy

- `ALERT_WEBHOOK_URL` in `dca.env` posts every non-settled outcome.
- [`guardian-watch`](../../../docs/runbooks/guardian-watch.md) can pause the policy if the
  session's spend crosses a share of its window — useful if more than one process ever pays
  from the same treasury.
- `pnpm ash pause` stops the cron's payments; `withdraw` still works while paused.

## Files

| File | |
|---|---|
| [`scripts/dca-cron.sh`](scripts/dca-cron.sh) | `tick` and `status`; all config from `dca.env` |
| [`dca.env.example`](dca.env.example) | Required variables, no secrets |
| [`policy.example.json`](policy.example.json) | The limits above, for review |
| [`mcp.md`](mcp.md) | Why this template ships no agent MCP config |

## Out of scope for v1

- Swapping inside ASH, or any CPI to a DEX.
- Price-aware DCA (buy more when cheaper). That is a planner decision and belongs in a
  different template, with a model and a person in the loop.
- Mainnet. Moving this to mainnet USDC means a real mint via `init --mint`, a desk wallet
  with its own key hygiene, and the trust-phase language in the root `README.md`.
