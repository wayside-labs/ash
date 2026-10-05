---
name: vendor-checkout
description: Use when buying from an ASH vendor (oracle, notary, compute) — the invoice → pay → redeem protocol, what each field of the invoice maps to, and how to recover a stuck redeem.
---

# Vendor checkout: invoice → pay → redeem

Vendors that sell to agents over ASH never take your key and never charge you
directly. Every purchase is three steps across two MCP servers:

1. **Request** on the vendor server (`oracle_request_quote`, `notary_request`,
   `compute_buy_credits`). You get an invoice.
2. **Pay** on the `ash` server with `ash_execute_payment`, copying the
   invoice's `payment` block **exactly**:

   | invoice field | execute_payment argument |
   |---|---|
   | `payment.destination_label` | `destination_ref` |
   | `payment.amount` | `amount` |
   | `payment.mint_ref` | `mint_ref` |
   | `payment.reference` (= `invoice_id`) | `reference` |

   The vendor proves payment by recomputing the receipt from these four values. Change any of
   them — round the amount, use another label, invent a reference — and the vendor cannot find
   your payment even though the money moved.
3. **Redeem** on the vendor server (`<vendor>_redeem` with `invoice_id`, and `intent_id` from
   step 2 if you have it).

## Before you buy

- Read `<vendor>_catalog` once per run: price per unit and the destination label.
- If the label is not in `ash_list_destinations`, stop: the operator has not
  allowlisted this vendor. Do not try a raw address.
- Dry-run with `ash_check_payment` if the amount is new to you.

## When redeem says 402

| `payment_error.code` | Meaning | Action |
|---|---|---|
| `RECEIPT_NOT_FOUND` | No payment for this invoice from this session yet | If execute_payment said `settled`, wait ~5 s and redeem again. If `indeterminate`, resolve with `ash_get_payment_status` first. If you never paid, pay. |
| `INTENT_MISMATCH` | You paid with different values than the invoice | Do **not** pay again blindly. Report the mismatch; the earlier payment is a real transfer. |
| `RECEIPT_MISMATCH` | A receipt exists but underpays or pays someone else | Report it. |

Redeem is idempotent: calling it again for a redeemed invoice returns the same delivery. An
invoice paid by one session cannot be redeemed by another (409 / 403).

## Budget discipline

Buy the smallest unit that answers the task. One invoice per thing you actually need; never
pre-buy "in case".
