# Runbook — reference agent (devnet traction)

**Scope:** an in-house agent that pays for something real through Agent Rails on devnet until
**2026-10-12**, with public, independently verifiable metrics for the Colosseum deck.

**Honesty rule:** the slide line is *"2,100 payments, 31 denied, 0 double-spends"* — say out
loud that this is **our own agent, under our own policy, for two weeks**. The numbers are
manufactured traction, but every settlement is a real devnet transaction.

---

## Public devnet addresses

| | Address |
|---|---|
| Program | [`4qjD6vSgYa3oBKde3KVzsH8oCcP9BKsirX1xtD5SS6BS`](https://explorer.solana.com/address/4qjD6vSgYa3oBKde3KVzsH8oCcP9BKsirX1xtD5SS6BS?cluster=devnet) |
| Treasury ("Cofre devnet") | [`BTE45zKpHiWMTwaPmShaUBq2cnA6XUc8KhgxnufSnz3w`](https://explorer.solana.com/address/BTE45zKpHiWMTwaPmShaUBq2cnA6XUc8KhgxnufSnz3w?cluster=devnet) |
| SOL vault | [`ErhAQQDsk3CdCBTWp3559uuc1zhMdpcYShPEr1rym9tx`](https://explorer.solana.com/address/ErhAQQDsk3CdCBTWp3559uuc1zhMdpcYShPEr1rym9tx?cluster=devnet) |
| Policy (`dashboard-demo`) | [`H4HU1sPoevCGqHeFQiyW5Q8NVmQgAb1DyZgP2LSzwMPE`](https://explorer.solana.com/address/H4HU1sPoevCGqHeFQiyW5Q8NVmQgAb1DyZgP2LSzwMPE?cluster=devnet) |
| Allowlist destination `demo` | [`3tvQknH6RHfnssAGgC64z7KkejwrQ3USftxosmoimX4z`](https://explorer.solana.com/address/3tvQknH6RHfnssAGgC64z7KkejwrQ3USftxosmoimX4z?cluster=devnet) |

The treasury is linked in `~/.agent-rails/dashboard.json` (workflow **Cofre devnet**). The
dashboard chat is read-only by design — payments run through MCP or `agent-rails pay`, not
through the browser.

**Never commit keypairs.** Session keys live under `~/.agent-rails/reference-agent/` with mode
`0600`. `.gitignore` already excludes `**/*keypair*.json`.

---

## What "real" means here

The allowlisted label `demo` points at a devnet receipt address we control — a mock vendor,
not a mainnet API invoice. That is enough to prove:

- MCP / CLI → `execute_payment` → policy → `IntentReceipt` idempotency
- Operator surfaces (`policy set`, `pause`) affect the same treasury the agent uses
- Metrics replay against `AgentSession.audit_head` without trusting our dashboard

Swapping `demo` for a paid inference or API destination later is a `dest add` + policy
change; the runbook below stays the same.

---

## 0. Prerequisites

```bash
git clone https://github.com/wayside-labs/agent-rails && cd agent-rails
pnpm install && pnpm build
```

You need:

1. **Owner or operator wallet** with devnet SOL (deposits, session create).
2. **Fee-payer SOL** on whichever key pays transaction fees (can be the session key).
3. **Vault headroom** — check with:

```bash
pnpm agent-rails status \
  --rpc https://api.devnet.solana.com \
  --treasury BTE45zKpHiWMTwaPmShaUBq2cnA6XUc8KhgxnufSnz3w \
  --policy-name dashboard-demo \
  --wallet devnet-ci-keypair.json
```

Top up if the SOL vault is low:

```bash
pnpm agent-rails deposit \
  --rpc https://api.devnet.solana.com \
  --treasury BTE45zKpHiWMTwaPmShaUBq2cnA6XUc8KhgxnufSnz3w \
  --policy-name dashboard-demo \
  --wallet devnet-ci-keypair.json \
  --out ~/.agent-rails/reference-agent \
  --amount 0.5 \
  --yes
```

At `0.00001 SOL` per tick, `0.5 SOL` funds roughly 50,000 settlements before policy windows
bind.

---

## 1. Session + manifest (one-time)

Create a dedicated session for the reference agent. This writes
`~/.agent-rails/reference-agent/devnet.json` and an MCP snippet.

```bash
mkdir -p ~/.agent-rails/reference-agent
pnpm agent-rails session create \
  --rpc https://api.devnet.solana.com \
  --treasury BTE45zKpHiWMTwaPmShaUBq2cnA6XUc8KhgxnufSnz3w \
  --policy-name dashboard-demo \
  --wallet devnet-ci-keypair.json \
  --out ~/.agent-rails/reference-agent \
  --label reference-agent \
  --session-ttl 504 \
  --yes
```

`--session-ttl 504` is 21 days — enough to cover 26/09 → 12/10 with margin. Renew before
expiry with another `session create` (same label reuses the key file if present).

Copy the example env and fill in `SESSION` / `SESSION_KEYPAIR` from the command output:

```bash
cp scripts/reference-agent.env.example ~/.agent-rails/reference-agent/reference-agent.env
# edit SESSION=... and WALLET=...
```

---

## 2. MCP in Cursor (agent path)

The snippet is at `~/.agent-rails/reference-agent/claude_desktop_config.snippet.json`. Merge
the `agent-rails` block into Cursor → Settings → MCP, or paste into Claude Desktop's config.

Critical env vars (see `packages/mcp/README.md`):

| Variable | Value |
|---|---|
| `AGENT_RAILS_RPC` | `https://api.devnet.solana.com` |
| `AGENT_RAILS_SESSION` | session PDA from step 1 |
| `AGENT_RAILS_SIGNER` | `~/.agent-rails/reference-agent/reference-agent-session-keypair.json` |
| `AGENT_RAILS_SINK` | `~/.agent-rails/reference-agent/payments.jsonl` |

Restart the MCP server after edits. In Cursor, the agent should call
`agent_rails_execute_payment` with `destination_ref: "demo"` and a unique `reference` per
invoice.

---

## 3. Cron / loop (operator path)

The shell driver uses the same `pay` instruction as MCP, but without a model in the loop —
better for steady volume.

```bash
cp scripts/reference-agent.env.example ~/.agent-rails/reference-agent/reference-agent.env
# fill SESSION, SESSION_KEYPAIR, WALLET

# one-off smoke
scripts/reference-agent.sh tick
scripts/reference-agent.sh deny    # intentional per-tx denial (0.03 SOL > 0.02 limit)
scripts/reference-agent.sh metrics
```

**Cron** (one settlement every 11 minutes ≈ 2,100 payments in 16 days; every 68th tick is a
denial ≈ 31 denials):

```cron
*/11 * * * * /path/to/agent-rails/scripts/reference-agent.sh tick >> ~/.agent-rails/reference-agent/cron.log 2>&1
0 */12 * * * /path/to/agent-rails/scripts/reference-agent.sh deny >> ~/.agent-rails/reference-agent/cron.log 2>&1
```

Or run foreground loop (tmux/systemd):

```bash
scripts/reference-agent.sh loop
```

Default tuning lives in `scripts/reference-agent.env.example` (`INTERVAL_SEC=660`,
`DENY_EVERY=68`).

---

## 4. Metrics for the deck

**On-chain settlements** (authoritative count):

```bash
pnpm agent-rails audit export \
  --rpc https://api.devnet.solana.com \
  --treasury BTE45zKpHiWMTwaPmShaUBq2cnA6XUc8KhgxnufSnz3w \
  --policy-name dashboard-demo \
  --session <SESSION_PDA> \
  --out ~/.agent-rails/reference-agent \
  --wallet ~/.agent-rails/reference-agent/reference-agent-session-keypair.json \
  --verify
```

- `seq` on the session account = lifetime successful payments.
- `verification.ok` = hash chain replays to `audit_head` (0 double-spends if every retry
  reused the same `intent_id` and was refused).
- Denials do not increment `seq`; count them from `AGENT_RAILS_SINK` / the script JSONL.

**One-liner summary:**

```bash
scripts/reference-agent.sh metrics
```

**Sink breakdown:**

```bash
jq -s 'group_by(.outcome) | map({(.[0].outcome): length}) | add' \
  ~/.agent-rails/reference-agent/payments.jsonl
```

Update the README table before recording the pitch — numbers drift until 12/10.

---

## 5. Denial demo (manual pause)

**Policy denial (proof 3):** already covered by `scripts/reference-agent.sh deny` and by
`scripts/demo.sh`. For a live retake, tighten the window:

```bash
pnpm agent-rails policy set \
  --daily 0.00005 \
  --treasury BTE45zKpHiWMTwaPmShaUBq2cnA6XUc8KhgxnufSnz3w \
  --policy-name dashboard-demo \
  --wallet <operator> \
  --out ~/.agent-rails/reference-agent \
  --yes
```

Then run `tick` — the next payment should return `denied` with a stable reason code on-chain.

**Pause (guardian / owner kill switch):** automatic path via
[`docs/runbooks/guardian-watch.md`](guardian-watch.md) and `pnpm guardian-watch` (add a
guardian key first). Manual override:

```bash
pnpm agent-rails pause \
  --treasury BTE45zKpHiWMTwaPmShaUBq2cnA6XUc8KhgxnufSnz3w \
  --policy-name dashboard-demo \
  --wallet <owner> \
  --out ~/.agent-rails/reference-agent \
  --yes
```

Agents get refusals while paused; owner `withdraw` still works (program invariant).

---

## 6. Stop conditions

| Check | How |
|---|---|
| Process documented | this file + `scripts/reference-agent.sh` |
| Cron or loop running | `cron.log` mtime or `loop` in tmux |
| README has devnet links | root `README.md` § Reference agent |
| Metrics updatable | `audit export --verify` + `reference-agent.sh metrics` |
| No keys in git | `git status` clean of `*keypair*.json` |

**End date:** stop the cron / loop on **2026-10-12**, export a final audit JSON for the
submission appendix, and freeze the slide numbers.

---

## 7. Troubleshooting

| Symptom | Fix |
|---|---|
| `Session expired` | `session create` again with a fresh `--session-ttl` |
| `vault balance` too low | `deposit --amount 0.5` |
| `InsufficientFundsForRent` on pay | fund the allowlisted destination (`demo` → `3tvQknH6…`) with ≥0.002 SOL — it must exist as a system account before `execute_payment_sol` |
| `No keypair at …/fee-payer-keypair.json` | set `FEE_PAYER_KEYPAIR` in env to the owner wallet, or fix `feePayerKeypairPath` in `devnet.json` |
| `429` from public RPC | script retries in `demo.sh` pattern; prefer a dedicated RPC |
| `indeterminate` | **do not retry** — `audit export \| grep <intent_id>` first |
| MCP pays, cron does not | different sessions? Align `AGENT_RAILS_SESSION` and env `SESSION` |
| Head mismatch on verify | reclaimed receipts (`close_receipt`); check `receipts_reclaimed` in export |

---

## Related

| | |
|---|---|
| `scripts/demo.sh` | Three Colosseum proofs (injection, retry, ceiling) on a throwaway treasury |
| `packages/mcp/README.md` | MCP env vars and tool surface |
| `docs/strategy/colosseum-plano-execucao.md` | Slide 9 traction target and honesty note |
