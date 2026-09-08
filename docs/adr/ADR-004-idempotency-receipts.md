# ADR-004: Idempotency via per-intent receipt PDAs

**Status:** Accepted

## Context

Solana's runtime rejects byte-identical transactions within the blockhash window, but the real threat is the agent retry: a tool call times out after the transaction landed, and the agent re-issues the same logical payment with a fresh blockhash. Concurrent tool calls and horizontally scaled agent replicas must also not collide. Signed-intent mode (ADR-003, v1.1) additionally needs true replay protection.

## Options considered

- A. Per-session monotonic nonce (serializes payments; ambiguous status).
- **B. Idempotency receipt PDA per intent.**
- C. Sliding nonce bitmap (complex, no status query).
- D. Off-chain idempotency only (not trust-minimized).

## Decision

Option B.

- `PaymentIntent.intent_id: [u8; 16]`, client-generated: UUIDv7 by default, or a deterministic id derived from an application request key.
- `execute_payment` `init`s `IntentReceipt` at seeds `["receipt", session, intent_id]`. A duplicate fails at account creation, before any transfer.
- The receipt records `mint`, `amount`, `destination_owner`, `seq`, `slot`, `timestamp`, `expires_at`, `status`, `fee_payer`, `memo_hash`.
- `PaymentIntent.expires_at` is mandatory; SDK default 90 s, program maximum `MAX_INTENT_TTL_SECONDS = 3600`.
- `close_receipt` is permissionless after `expires_at + RECEIPT_GRACE_SECONDS`; rent returns to the recorded `fee_payer`.
- A `PaymentExecuted` event is emitted via `emit_cpi!` alongside the receipt.

## Consequences

- Retry-safe and concurrency-safe by construction; a buggy client that reuses ids fails closed.
- `get_payment_status(intent_id)` is authoritative while the receipt exists and falls back to the indexer afterward.
- Rent of roughly 0.0026 SOL per payment is temporarily locked and refunded on close; a permissionless crank can garbage-collect.
- In v1.1 signed-intent mode the same `intent_id` doubles as the replay nonce.
