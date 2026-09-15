# ADR-012: Derived intent ids and a four-valued payment outcome

**Status:** Accepted

## Context

ADR-004 made idempotency a property of the program: `execute_payment` `init`s an `IntentReceipt` at `["receipt", session, intent_id]`, so a duplicate fails at account creation before any transfer. It left the derivation of `intent_id` to the client — "UUIDv7 by default, or a deterministic id derived from an application request key" — and said nothing about what a client may conclude when a payment's outcome is unknown.

Both gaps were taken at their most permissive reading, and together they produced a fund-loss path that needs no adversary. The client drew a fresh random id per call, and reported every post-broadcast failure — confirmation timeout, expired blockhash, transport error — with the same shape as a policy denial. An agent reading a denial retries; the retry draws a new id, addresses a different receipt PDA, and the vault pays twice. A lagging RPC node is sufficient to trigger it.

The two decisions are independent and are both made here: where the idempotency key comes from, and what a failure is allowed to mean.

## Options considered

**Where the key comes from:**

- A. Random per call; the caller remembers it across a retry. This is the status quo, and it requires state to survive exactly the failure where it does not — the caller is frequently a language model whose memory of the id is the first thing lost.
- B. Per-session monotonic counter. Rejected in ADR-004 for serializing payments and leaving status ambiguous; nothing has changed.
- **C. Derived from the payment being settled.**
- D. Server-held cache keyed by request parameters. Introduces durable state whose loss is a double payment.

**What a failure means:**

- E. Boolean `allowed`, one denial shape for everything. Status quo.
- F. Boolean plus a `retryable` flag. A flag beside an otherwise identical shape is easy to ignore, and ignoring it is the fund-loss case.
- **G. A four-valued outcome, required at every construction site.**

## Decision

Options C and G.

1. **Derivation.** `intent_id = sha256(DOMAIN ‖ session ‖ destination_owner ‖ mint ‖ amount ‖ reference)[0..16]`, `DOMAIN = "agent-rails:intent:v1"`, with every field length-prefixed. The session is in the preimage, so a hostile `reference` cannot be aimed at another session's receipt namespace; the length prefixes stop two adjacent fields being shifted into one another.
2. **`reference` is required and has no default.** It is the caller's name for what is being settled — an invoice number, a document hash, a task id. Generating one returns the system to random ids, so the obligation stays with the caller.
3. **Clients do not generate ids.** `createIntentId` validates; its generating branch is removed.
4. **`PaymentOutcome = settled | denied | indeterminate | review_required`.** Only `denied` is retryable. `settled` and `review_required` are terminal. `indeterminate` permits exactly one next action: resolve the receipt.
5. **Classification follows what a failure proves, not where it was raised.** A preflight failure or an included-and-reverted transaction is `denied`: the program decided and nothing moved. Everything raised after a successful broadcast is `indeterminate`, because a timeout and an expired blockhash prove nothing about whether the transfer landed.
6. **`outcome` is a required field on the error type.** A default would be a guess about whether funds moved, and the wrong guess in the permissive direction is the defect this ADR exists to close.
7. **Resolution reads the receipt PDA**, with `getSignatureStatuses(…, { searchTransactionHistory: true })` as corroboration. The confirmation loop keeps `false`: it asks whether a seconds-old transaction has confirmed, while resolution asks whether one ever happened, and a transaction that landed while the client timed out is precisely the one that has fallen out of a node's recent-status cache.
8. **An unresolved outcome quiesces the session.** Every further payment denies with `SESSION_QUIESCED` until that intent's receipt is observed, and only the causing intent lifts the hold.
9. **Every response carries `outcome`, `intent_id` and `receipt`**, denials included. Without the id, the one authoritative answer is unreachable.

## Consequences

- A retry of the same payment is refused by the program, which is what ADR-004 intended. The client can now reach that guarantee; before, it addressed a different account every time.
- A receipt precheck before building makes most retries free: a settled intent returns its receipt rather than a failed transaction and a spent fee. It does not replace the on-chain check, which remains the guarantee.
- `reference` is a new obligation on every caller and the visible cost of this decision. A payment that cannot be named cannot be made idempotent.
- Idempotency does not become a payment ceiling. The same vendor and amount under a different reference is a different payment, bounded by the window and lifetime limits as ADR-005 intends.
- Availability trade: one slow confirmation stops a session until something resolves it. A stuck agent is cheaper than a duplicated disbursement. An operator path to clear a quiesce whose receipt never appears is still owed.
- Receipts close permissionlessly after `expires_at + RECEIPT_GRACE_SECONDS` (ADR-004). A derived id is stable forever, so beyond that window a precheck must consult the indexer and the decision record, not the PDA alone.
- `DUPLICATE_INTENT` now means "settled". Unrecognized program errors therefore map to `UNKNOWN_PROGRAM_ERROR`; the previous fallback would have reported an error from a newer program version as a completed payment.
- The accompanying narrowing of the MCP tool arguments — binding the session at startup rather than accepting it per call — is consistent with ADR-007 rather than a change to it: that contract never made the session a tool argument.
- This does not supersede ADR-004. It settles the client-side half ADR-004 deliberately left open, and the on-chain design is unchanged.
