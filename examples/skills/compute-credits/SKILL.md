---
name: compute-credits
description: Use for text jobs (keywords, extractive summary, sha256) on Rails Compute — prepaid credits bought in packs; check the balance before buying more.
---

# Rails Compute

Prepaid: one payment buys a pack of credits, and jobs spend credits without touching the
chain.

| job | credits |
|---|---|
| `keywords` | 1 |
| `sha256` | 1 |
| `summarize` | 2 |

## Flow

1. `compute_balance()` — free. If the balance covers the jobs you plan, skip to step 4.
2. `compute_buy_credits({ packs })` — buy the fewest packs that cover the task (see the
   catalog for credits per pack). Then pay (skill `vendor-checkout`) and
   `compute_redeem({ invoice_id })`.
3. The MCP stores the account token for you; you never see or handle it.
4. `compute_run_job({ kind, input })`.

## Don't

- Don't buy packs "to be safe" — a pack is a real payment against your window limit.
- A 402 from `compute_run_job` means insufficient credits, not a payment problem: check the
  balance, then decide whether the task is worth another pack.
