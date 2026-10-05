---
name: ash-payments
description: Use before any payment through the ash_* tools — how to check headroom, pay exactly once, and read a denial or an indeterminate outcome without paying twice.
---

# Paying through ASH

You pay from a vault you do not control, under a policy you cannot change. The program refuses
any payment that breaks a per-transaction, window or lifetime limit, the destination allowlist
or the mint allowlist. Your job is to pay correctly, not to find a way around a refusal.

## Before paying

1. `ash_get_session` — is the session live (not expired, not revoked)?
2. `ash_list_destinations` — pay only to a **label** from this list. Raw addresses are
   refused under an allowlist policy.
3. For any amount you have not paid before in this run, call `ash_check_payment` with
   the exact arguments you intend to use. It sends nothing and costs nothing.

## Paying

Call `ash_execute_payment` with:

- `destination_ref`: the label
- `amount`: a decimal string in human units (`"0.0001"`, not `100000`)
- `mint_ref`: `"SOL"` or the configured symbol
- `reference`: **what this payment settles** — an invoice id, a task id, a document hash.
  Never a timestamp or a random value.

The reference is the idempotency key. The same payment with the same reference collides with
its own receipt on-chain and cannot settle twice. A new reference is a new payment.

## Reading the outcome

| Outcome | What to do |
|---|---|
| `settled` | Done. Keep `intent_id` and `receipt`. |
| `denied` | Read `reason_code`. Do **not** retry with another amount, destination or reference to get around it. Report it to the operator. |
| `review_required` | The security posture held it for a person. Stop and report; do not re-submit. |
| `indeterminate` | The transaction may or may not have landed. Call `ash_get_payment_status` with the `intent_id` until it resolves. If you must retry, retry with the **same** reference. |

## Never

- Never split a payment into smaller ones to fit under a per-transaction limit.
- Never change the reference to "unstick" a payment.
- Never ask for, or try to use, a tool that raises a limit, creates a session, unpauses, or
  withdraws. Those belong to a person; if you need more budget, say so in plain text.
