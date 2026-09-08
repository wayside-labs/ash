# ADR-008: Layered Rust-first test pyramid with a pure policy crate, Trident, and Kani

**Status:** Accepted

## Context

`solana-bankrun` was deprecated in March 2025 in favor of LiteSVM; Anchor 1.0 scaffolds LiteSVM unit tests and uses Surfpool as the default `anchor test` runner. Fuzzing (Trident) is Rust-only. Policy math embedded in Anchor handlers can only be tested through an SVM; policy math in a pure crate can be property-tested at millions of cases per second.

## Options considered

- A. TypeScript-first LiteSVM tests for everything (no fuzzing story).
- **B. Layered Rust-first pyramid; TS only where TS is the product.**
- C. Validator-centric (slow, flaky, unfuzzable).
- D. B plus Kani bounded model checking on the pure core.

## Decision

Option B, with D as a non-blocking nightly job.

**Structural decision:** `programs/agent_rails` contains account validation and CPI only. `crates/agent-rails-policy` is `#![no_std]`-compatible, `#![forbid(unsafe_code)]`, all arithmetic `checked_*`, and owns window rollover, limit evaluation, the ceiling partial order, and the audit hash.

Layers:

1. Policy crate: `proptest`, `cargo-fuzz`; Kani proofs nightly (no overflow, monotone rollover, `≤` partial order, hash injective in `seq`).
2. `anchor-litesvm` integration tests: every instruction, adversarial paths, clock warps.
3. Trident stateful fuzzing with invariants: vault balance vs. receipts; counters ≤ limits; `Policy ≤ Ceiling`; paused ⇒ no payment; revoked/expired never pays; `seq`/`audit_head` consistency; receipts never re-init; non-role signers cannot mutate.
4. `litesvm` npm for SDK/MCP; MCP contract tests via in-memory transport; tool-schema snapshots.
5. Surfpool E2E nightly (mainnet-forked USDC); devnet smoke on release tags.

Per-PR gates: fmt, clippy `-D warnings`, cargo-deny, cargo-audit, verifiable build hash, CU regression (>10% fails), account layout snapshot, IDL diff comment, short Trident run with committed corpus, tsc, Biome, vitest, coverage thresholds (policy ≥95%, SDK core ≥85%), CodeQL, semgrep, SHA-pinned Actions with minimal permissions. Nightly: long Trident, Kani, Surfpool E2E, `cargo-mutants`.

## Consequences

- Contributors run layers 1–4 in seconds with no validator.
- Two toolchains to maintain; Trident pinned (0.12.x stable at time of decision).
- "Formally checked policy arithmetic" is a legitimate README claim, scoped to what the Kani harnesses model.
