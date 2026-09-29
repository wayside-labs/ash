---
name: document-notary
description: Use when asked to timestamp, notarise, or prove the existence of a document or text at a point in time — look up first (free), buy only if the hash is new.
---

# Rails Notary

The notary timestamps a **sha256**. Only the hash leaves this machine; the MCP hashes the text
locally when you pass `text`.

## Flow

1. `notary_lookup({ text })` (or `{ sha256 }`) — free. If it returns a certificate, you are
   done: report it and pay nothing.
2. `notary_request({ text, label })` — if the hash is already notarised this also returns the
   certificate for free. Otherwise it returns an invoice.
3. Pay it (skill `vendor-checkout`), then `notary_redeem({ invoice_id })`.

## The certificate

`certificate_id`, `sha256`, `notarized_at`, `payer_session`, `receipt`, `invoice_id`.
`receipt` is the on-chain `IntentReceipt` that paid for it — cite it; anyone can check it on
an explorer.

## Care

- The hash is over the **exact bytes**. Whitespace or a trailing newline changes it; notarise
  the text exactly as it will be verified later.
- Never notarise secrets' hashes of low-entropy values (a PIN, a short password): a hash of a
  guessable value is as good as the value.
