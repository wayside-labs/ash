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

`tests/rejections.rs` covers the refusals — a zero limit, an impossible window ordering, a
discriminant this version does not know, and window state a corrupted account could carry.
Proptest generates inputs that are valid by construction, which is what makes it strong on
the arithmetic and blind to every guard in front of it; a new refusal belongs there rather
than in `proptests.rs`.

`tests/error_codes.rs` pins the properties of the code tables — distinct codes, distinct
reason strings, `Display` agreeing with `reason_code()`. Whether those numbers match the
Anchor codes the program actually emits needs both crates, so it lives in
`programs/agent_rails/tests/error_codes.rs`.

The crate is gated at ≥95% line coverage (`cargo llvm-cov --fail-under-lines 95`, in
`scripts/verify.sh rust`) and measures 100%. The threshold stays at the ADR-008 number
rather than following the measurement up: a threshold pinned to today only ratchets, and
the headroom is what lets an honest `unwrap_or` land without a fight.

Four *regions* remain uncovered, which is a different thing from a line. They are the
`None` arms inside `roll_window`'s `and_then` chain, and they cannot fire once
`window >= 1` and `now >= start + window` hold. Expressing them as links in one chain
rather than as their own `let`-`else` blocks is deliberate: `deny(arithmetic_side_effects)`
forces a `checked_*` for every operation, so provably-safe arithmetic would otherwise
produce dead statements that read as handled cases. Do not "fix" the remaining regions by
reaching for `saturating_*` — that trades an unreachable branch for a silent wrong answer,
which is the trade this crate exists to refuse.

`src/proofs.rs` holds the Kani harnesses, compiled only under `cfg(kani)` and run by
`scripts/verify.sh kani`. They are not a second opinion on the proptests: proptest builds
inputs that are valid by construction, so it never reaches a counter a corrupted account
could carry, and the harnesses quantify over every `i64` instead. Changing `roll_window`,
`limit_leq_ceiling` or `audit_preimage` without running them is changing exactly what they
were written to hold still. The proofs discharge against one pinned Kani release
(`KANI_VERSION` in `scripts/verify.sh`); bumping it is a deliberate change with the proofs
re-run, not a version bump.

Two of the harnesses have no counterpart in ADR-008's list, and the reason is worth keeping:
the four properties it names all pass a `limit_leq_ceiling` whose window comparison is
reversed. `<=` for `>=` is still reflexive, antisymmetric and transitive — a sound partial
order pointing the wrong way, letting an operator set a window *shorter* than the ceiling's
minimum and reset the budget faster than the owner allowed. The algebra cannot see
direction; only rollover behaviour can.

`tests/ceiling_order.rs` exists because `cargo mutants` said it had to. Every test in it
kills a specific surviving mutant, and seven of the nine it was written for were in
`limit_leq_ceiling` — a function this crate proves under Kani and covers at 99.2% by line,
while `cargo test` contained nothing that failed when it was replaced with `-> true`. That
is the failure mode to remember: coverage says a line ran, mutation says an assertion
depended on it, and a crate can be fully covered by a suite that asserts nothing about the
rule in question.

Run it with `scripts/verify.sh mutants` (~4 minutes; deliberately not part of
`verify.sh all`, and nightly in CI). The gate is zero survivors. When a mutant genuinely
cannot be killed, `#[mutants::skip]` at the site is the answer — never a tolerated count,
which nobody would see drift. `.cargo/mutants.toml` carries the scope: this crate only, and
never `src/proofs.rs`, which `cargo test` does not compile.

ADR-008 also calls for `cargo-fuzz` on this crate, which does not exist yet — see ADR-015
for what is deferred. Trident is deferred there too, and not for want of writing it: every
published Trident needs `solana-sdk ^2.3` and this tree is Anchor 1.1.2 on solana 3.x. Do
not read either absence as a decision that it is unnecessary.

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
