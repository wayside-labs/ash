# Runbook: Guardian-as-a-Service (minimal watcher)

**Purpose:** Demonstrate *anomaly → automatic kill switch, owner still recovers funds* without
custody of customer keys beyond an opt-in guardian slot.

**Component:** `scripts/guardian-watch.ts` — polls session spend counters and submits `pause`
when spend crosses a configurable fraction of the policy window limit.

**Related:** ADR-002 (guardian may pause only), ADR-010 (pause blocks `execute_payment` only),
`packages/cli` commands `guardian add|rm`, `pause`, `withdraw`, `unpause`.

---

## 1. Threat model (what this proves)

| Actor | Can | Cannot |
|---|---|---|
| Guardian key (Agent Rails or customer bot) | `pause` | unpause, withdraw, policy, sessions |
| Owner | withdraw **while paused**, unpause, `remove_guardian` | — |
| Agent session | pay within policy | pause or withdraw |

A compromised guardian causes at worst a **denial of agent payments** until the owner unpause
or removes the guardian — verifiable on-chain.

---

## 2. Setup

### 2.1 Keys

| Key | Role | Storage |
|---|---|---|
| Owner | cold / primary wallet | customer |
| Guardian | hot monitoring key | Agent Rails **only if** customer opts in |

```bash
solana-keygen new -o guardian-keypair.json --no-bip39-passphrase
```

Never commit `*keypair*.json`.

### 2.2 Opt-in on-chain

```bash
pnpm agent-rails guardian add "$(solana address -k guardian-keypair.json)" \
  --wallet <owner-keypair> \
  --out <manifest-dir> \
  --treasury <treasury> \
  --policy-name <name> \
  --yes
```

Revoke:

```bash
pnpm agent-rails guardian rm --address <guardian-pubkey> --wallet <owner> ...
```

### 2.3 Policy windows vs owner ceiling

| Layer | Who sets it | What the watcher reads |
|---|---|---|
| **Owner ceiling** (`Treasury` mint config) | Owner | Not used directly — caps what the operator may configure |
| **Operator policy** (`Policy.mint_limits`) | Operator | `short_window_max`, `short_window_seconds`, `long_window_*` |

Spend counters live on each **`AgentSession`**. The watcher rolls them the same way as
`agent-rails-policy` (`roll_window` in `crates/agent-rails-policy/src/engine.rs`). By default
it watches the **short** policy window (`--window short`). CLI `init` sets
`shortWindowSeconds: 3600` (1 hour) and aligns policy `short_window_max` with the operator’s
`--daily` SOL cap — that is a **policy limit**, not a separate CLI flag the watcher accepts.

**Default rule (v1):** for each **live** session on the configured policy, and each mint in
that policy, **rolled short-window spend ≥ 80%** of that mint’s `short_window_max`
(`--threshold-bps 8000`). This is **per session × mint**, not a treasury-wide sum across
sessions. A future “treasury-wide burst” rule would aggregate spend before comparing to the
threshold; that is not implemented here.

---

## 3. Operating the watcher

Build once:

```bash
pnpm build   # or at least client + sdk + cli
```

```bash
pnpm guardian-watch \
  --rpc https://api.devnet.solana.com \
  --treasury <TREASURY_PDA> \
  --policy <POLICY_PDA> \
  --guardian-keypair /secure/guardian-keypair.json \
  --interval 30
```

| Flag | Meaning |
|---|---|
| `--once` | Single evaluation (suitable for cron) |
| `--dry-run` | Log breaches without sending `pause` |
| `--threshold-bps` | Basis points of window max (1–10000) |
| `--window short\|long` | Which counter to compare |

**Recommended production defaults:** start with `--dry-run` until rules are tuned; rate-limit
pause attempts (the script pauses at most once per breach evaluation; treasury idempotency
handles repeat `pause`).

---

## 4. Devnet validation (stop conditions)

Use a throwaway treasury (`scripts/demo.sh`, `agent-rails init`, or
`scripts/guardian-watch-devnet-proof.sh --wallet <keypair>` for an automated §4 run).

1. **Register guardian** (§2.2).
2. **Spend toward the limit** — e.g. several `agent-rails pay` calls until the session’s
   rolled short-window spend exceeds 80% of that mint’s policy `short_window_max` (often the
   same amount you passed as `--daily` at `init`), or use `--threshold-bps 100` for a low bar.
3. **Run watcher** with `--once` (no `--dry-run`). Expect stderr: `pause confirmed: <sig>`.
4. **Agent denial** — `pay` should fail with treasury paused.
5. **Owner withdraw** — must succeed:

   ```bash
   pnpm agent-rails withdraw --amount 0.001 --to <owner-pubkey> --wallet <owner> --out <dir> --yes
   ```

6. **Recovery** — `unpause` (owner), optional `guardian rm`.

Record explorer links for pause and withdraw signatures in demo notes.

---

## 5. Incident / false positive

| Symptom | Action |
|---|---|
| Legitimate burst tripped pause | Owner `unpause`; tighten policy or raise threshold |
| Watcher down | No automatic pause — monitoring gap only |
| Guardian key leaked | Owner `guardian rm` immediately; rotate key and re-add |
| Treasury already paused | Watcher logs and exits cleanly |

---

## 6. Demo cross-reference

- `scripts/demo.sh` — Colosseum proofs 1–3 (MCP surface, idempotency, ceiling denial).
- Kill-switch narrative: run this runbook’s §4 after proof 3, or cite pause + withdraw txs.
- `docs/runbooks/reference-agent.md` §5 — links here for live pause demos.

---

## 7. Out of scope (v1)

- Hosted multi-tenant service, org-tree cascade pause, or dashboard alerting.
- Custody of owner/operator keys — **guardian only**.
- Unpause or fund recovery on behalf of the customer — owner tools only.
