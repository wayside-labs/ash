# agent-rails-policy

The pure policy core. `src/lib.rs` explains what lives here and why; this file is about
what changing it obliges you to do.

## A change here is not done until a property covers it

`tests/proptests.rs` is the reason this crate can be trusted without an SVM. Adding a rule
to `engine.rs` without adding a property to it moves the rule out of reach of layer 1 of
the ADR-008 pyramid, and the `anchor-litesvm` tests one directory over will not find the
arithmetic edge it was written to catch.

`tests/audit_vectors.rs` holds fixed input/output pairs for the hash chain. Any change
under `audit.rs` needs a vector, not just a property: a property proves the chain is
self-consistent, a vector proves it still produces the same bytes as yesterday. The chain
is what an auditor replays, so a silent change to it is a break even when every property
still passes.

ADR-008 also calls for `cargo-fuzz` and Kani proofs on this crate. Neither exists yet —
see ADR-015 for what is deferred. Do not read their absence as a decision that they are
unnecessary.

## Arithmetic

`#![deny(clippy::arithmetic_side_effects)]` catches raw `+`/`-`/`*`, so this is not a rule
you have to remember. What the lint cannot tell you is which direction to fail: on
overflow, prefer returning a `PolicyError` over saturating. A saturating limit silently
becomes a different limit, and this crate's whole job is that limits mean what they say.

## Before changing a settled rule

Window rollover, the ceiling partial order, and the audit preimage are each the subject of
an ADR — 005 for the policy engine, 006 for the hash chain. Fixed epoch buckets over
rolling windows, in particular, was decided on CU cost and fuzz-resistance grounds
(ARCHITECTURE.md §6) and is not an oversight to correct.

## Shape constraints that are not arbitrary

`MAX_MINTS` and `MIN_WINDOW_SECONDS` are declared here and re-exported by the program, so
there is no value to keep in sync on that side. The copy that *can* drift is the constants
table in `docs/spec/accounts-and-instructions.md` §1 — update it in the same change.

`no_std` and the optional `hash` feature are load-bearing, not portability theatre: the
on-chain program compiles this crate with `hash` off and feeds `audit_preimage` to the
`sol_sha256` syscall instead, because a software SHA-256 costs CU the program does not
have. Adding a dependency that is not `no_std`-compatible breaks that.
