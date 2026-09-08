# ADR-002: Owner / operator / guardian role separation, prepared for timelocks

**Status:** Accepted

## Context

With a native vault (ADR-001) the program must define who can withdraw, configure, and stop. A single authority key forces the cold key to be hot for daily operations and makes a kill switch impossible without also granting withdrawal power.

## Options considered

- A. Single `authority` pubkey.
- **B. Role-separated `owner` / `operator` / `guardians`.**
- C. In-program M-of-N (re-implements Squads, unaudited).
- D. B plus timelocked loosening with guardian veto.

## Decision

Option B in v1, with state prepared for D in v1.1.

- `owner` (cold): withdraw (always, even while paused), rotate roles, manage guardians, add/remove mints, set `PolicyCeiling`, unpause, close treasury.
- `operator` (warm): create/update/close policies within the ceiling, manage allowlist entries, create/revoke/close sessions, pause, unpause.
- `guardians` (up to 5, hot): pause only.
- Every role is a plain `Pubkey`; any may be a Squads/Realms PDA.
- Reserved now: `Treasury.timelock_seconds: u64` (0 in v1), `Treasury.recovery_destination: Pubkey`, `paused_at`, `paused_by`.

## Consequences

- A monitoring bot can hold a guardian key with zero withdrawal power.
- `Policy ≤ Ceiling` becomes a program invariant checked on every policy write (ADR-005).
- v1.1 can add `PendingChange` for loosening actions without an account migration; withdrawals to `recovery_destination` stay instant.
- Program upgrade authority is a super-owner over all treasuries and is governed separately (ADR-011).
