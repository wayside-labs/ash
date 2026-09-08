# ADR-006: Events plus per-session hash chain for a verifiable audit log

**Status:** Accepted

## Context

Receipts (ADR-004) are live status records that are garbage-collected, not a durable log. Events alone cannot prove that an indexer's history is complete. Any account written on every payment of a treasury becomes a global write lock; `AgentSession` is already written per payment, so per-session state is free.

## Options considered

- A. Events only; durability is the integrator's job.
- B. On-chain ring-buffer log per treasury (global write lock, rent, still overwrites).
- C. Permanent receipts (linear rent, `getProgramAccounts` dependence).
- **D. Events plus a per-session hash chain commitment.**

## Decision

Option D.

- `AgentSession.seq: u64` increments per executed payment.
- `AgentSession.audit_head = sha256(DOMAIN_AUDIT ‖ prev_head ‖ seq ‖ intent_id ‖ mint ‖ destination_owner ‖ amount ‖ slot)` with `DOMAIN_AUDIT = "agent-rails/audit/v1"`.
- A single versioned `AgentRailsEvent` enum is emitted via `emit_cpi!`; payment variants carry `seq` and `audit_head`.
- Denials caught in preflight are logged off-chain as `PaymentDenied` using the same schema.
- `@agent-rails/indexer` ships pluggable `EventSource` (polling, Yellowstone gRPC) and `Sink` (SQLite default, Postgres example) and a `verifyChain(session)` command. No hosted service, no dashboard in v1.

## Consequences

- 40 bytes of state and one `hashv` syscall buy a tamper-evident log with no new write locks.
- A treasury-wide view is the merge of per-session chains ordered by slot.
- The canonical hashing spec is part of the public contract and must be versioned with the domain string.
