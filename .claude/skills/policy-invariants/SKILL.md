---
name: policy-invariants
description: Use when changing spend limits, window rollover, the ceiling partial order, the audit hash chain, or any arithmetic that decides whether a payment is allowed — covers where the change belongs, what must be proven, and which ADRs already settled it.
---

# Changing what a payment is allowed to do

The rules that decide whether a payment is allowed are the security boundary of this
project. This is the procedure for changing one.

## 1. Decide where it belongs — this is the step people get wrong

Almost always: `crates/agent-rails-policy`, not `programs/agent_rails`.

The crate holds window rollover, limit evaluation, the ceiling partial order, and the audit
hash chain, with no Solana dependency. The program is account validation and CPI. That split
is what makes the crate property-testable at millions of cases per second without an SVM
(ADR-008 layer 1); arithmetic written in an Anchor handler is reachable only through the far
slower `anchor-litesvm` tests.

Belongs in the program instead only when the decision needs something the crate cannot see:
an account's owner, a signer, a clock the caller supplied, a CPI result.

If you find yourself writing `checked_add` inside an instruction handler, stop and ask which
of the two this really is.

## 2. Check whether it is already settled

- **ADR-005** — the policy engine.
- **ADR-006** — the audit hash chain.
- **ADR-012** — intent derivation and outcomes.
- **ARCHITECTURE.md §6** — why windows are fixed epoch buckets and not rolling. Rolling
  windows were rejected on CU cost and fuzz-resistance grounds. Reintroducing a ring buffer
  is re-litigating a decision, not fixing an oversight.

ADRs are immutable. Superseding one means writing a new ADR, never editing the old one.

## 3. Write the change

`#![deny(clippy::arithmetic_side_effects)]` rejects raw `+`/`-`/`*`, so the lint enforces
`checked_*` for you. What it cannot decide is the failure direction: return a `PolicyError`
rather than saturating. A saturating limit quietly becomes a different limit, and this
crate's entire job is that a limit means what it says.

Keep it `no_std`-compatible. The program compiles this crate with the `hash` feature off and
feeds `audit_preimage` to the `sol_sha256` syscall, because a software SHA-256 costs compute
units the program does not have.

## 4. Prove it

A rule added to `engine.rs` is not done until `tests/proptests.rs` covers it. Without a
property, the rule sits outside the only layer that explores its arithmetic edges.

A change under `audit.rs` needs a fixed vector in `tests/audit_vectors.rs`, not only a
property. A property proves the chain is self-consistent; a vector proves it still produces
the same bytes as before. The chain is what an auditor replays, so changing it silently is a
break even when every property still passes.

ADR-008 also calls for `cargo-fuzz` and Kani proofs on this crate. Neither exists yet
(ADR-015). Their absence is a deferral, not a judgement that the rule is covered.

## 5. Follow it outward

- Does the ceiling/policy relation still hold? `policy_leq_ceiling` is what enforces
  "loosening flows downhill only" — an operator must never be able to set policy above the
  owner's ceiling.
- Did an account layout move? Then `programs/agent_rails/tests/layout.rs` and
  `docs/spec/accounts-and-instructions.md` §3 change in the same commit, and it is a
  breaking change for every Codama client downstream.
- Did the instruction surface move? Run `pnpm idl:sync`.
- Did CU cost move? `programs/agent_rails/tests/budget.rs` measures it against the
  baselines in `tests/cu-baselines.txt`, and CI fails at >10% over them. The spec §10 design
  gate is ≤45k CU for `execute_payment`. If the move is intended, refresh the baseline with
  `scripts/cu-baseline.sh --write` in the same commit that justifies it.

Finish with `scripts/verify.sh`.
