# ADR-005: Shared policy PDAs, allowlist entry PDAs, fixed-bucket limits, off-chain soft policies

**Status:** Accepted

## Context

Limits are mint-specific (base units differ per mint), every account read costs bytes and CU, and anything unbounded must be a PDA the client passes in rather than a vector the program scans. Expressiveness must stay auditable and fuzzable.

## Options considered

- A. Fixed-schema policy embedded in each session (whitelist capped by account size; rules and state mixed).
- **B. Shared `Policy` PDA + per-destination `AllowlistEntry` PDAs + counters in the session.**
- C. On-chain rule list / interpreter (large audit surface).
- D. Hard ceilings on-chain, rich policy off-chain (accepted only as an additional layer).

## Decision

Option B on-chain, with D as a defense-in-depth layer in the SDK/MCP server.

1. **Windows** are fixed epoch buckets (`window_start` advances by whole multiples of `window_seconds`). Each `MintLimit` has `per_tx_max`, a short window, a long window, and a per-session `lifetime_max`.
2. **Allowlist** entries are keyed by destination *wallet owner*; the program derives the destination ATA itself, defeating look-alike token accounts. `destination_mode ∈ {Any, Allowlist}`; `Any` requires `treasury.allow_any_destination`.
3. **Mints**: four inline `MintLimit` slots per policy; a mint absent from the policy is denied.
4. **Ceilings**: `Treasury.mints[i].ceiling` bounds every policy; `update_policy` asserts `Policy ≤ Ceiling` (amount fields `≤`, window durations `≥`, destination and ATA flags implied).
5. **Reserved** in `MintLimit`: `approval_threshold` (human-in-the-loop) and `cooldown_seconds`, both v1.1.
6. **Soft policies**: pluggable `PolicyHook`s (custom, Cedar, OPA) run before signing; denials are logged with the on-chain event schema; documentation states they are not the guarantee.

All arithmetic lives in the pure `agent-rails-policy` crate (ADR-008).

## Consequences

- `execute_payment` reads `policy` and, in allowlist mode, one `AllowlistEntry`; verification is O(1).
- Policies are reusable objects (`"payments-api-tier-1"`) shared by many sessions with independent budgets.
- Per-destination PDAs cost refundable rent and need close instructions with dependency checks.
