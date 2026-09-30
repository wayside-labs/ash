---
name: oracle-pricing
description: Use when a task needs a current USD price for SOL, BTC, ETH, USDC, JUP or BONK — buy a quote from the Rails Oracle with the fewest symbols that answer the question.
---

# Rails Oracle

Price per **symbol**, so a quote for `["SOL","BTC"]` costs twice one for `["SOL"]`.

Supported: SOL, BTC, ETH, USDC, JUP, BONK. Anything else is refused at invoice time (free).

## Flow

1. `oracle_request_quote({ symbols: [...] })` → invoice.
2. Pay it (skill `vendor-checkout`).
3. `oracle_redeem({ invoice_id })` → `{ as_of, source, prices_usd }`.

## Reading the answer

- `source: "coingecko"` — live; `as_of` is when the price was read (at most 10 minutes old).
- `source: "mock"` — the vendor runs in local mock mode. **Say so** in your answer; never
  present a mock price as market data.
- `oracle_request_quote` answering 503: the upstream is down and nothing was invoiced — try
  later. `oracle_redeem` answering 503: you paid, delivery is pending — redeem the same
  invoice again later, never pay a second time.
- Reuse a quote within the same task instead of buying the same symbol again.

## Don't

- Don't buy USDC's price to learn it is ~1.
- Don't buy a quote per sentence of your answer: batch the symbols into one invoice.
