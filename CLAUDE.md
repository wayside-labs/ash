# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Agent Rails is a guardrail and treasury framework that lets autonomous AI agents make on-chain Solana payments without ever holding unbounded funds. Owners deposit into a program-owned vault, define policies (per-tx/windowed/lifetime limits, destination allowlists, mint allowlists), and issue time-boxed agent sessions. Agents pay through a single `execute_payment`/`execute_payment_sol` instruction the program refuses unless every rule holds.

Read `ARCHITECTURE.md` before making non-trivial changes — it is the design baseline (roles, payment flow, account model, policy engine, idempotency, audit chain, MCP surface, test pyramid, governance). Byte-level account/instruction layouts are in `docs/spec/accounts-and-instructions.md`. Decisions are recorded as immutable ADRs in `docs/adr/` (`docs/adr/README.md` is the index) — check for a relevant ADR before revisiting a settled design question, and add a new one for future significant decisions rather than re-litigating in code comments.

## Repository layout

```
agent-rails/
├── programs/agent_rails/       # Anchor program — account validation, PDA custody, CPI only
├── crates/agent-rails-policy/  # pure, #![no_std]-compatible policy arithmetic (no Solana deps)
├── idl/agent_rails.json        # checked-in Anchor IDL, source of truth for TS codegen
└── packages/
    ├── contract/                # Zod schemas, reason codes, event types — single source of truth for off-chain surfaces
    ├── client/                  # 100% Codama-generated @solana/kit client (do not hand-edit src/generated/)
    ├── sdk/                     # hand-written Kit plugin: PaymentIntent builder, preflight, signer, error mapping
    ├── mcp/                     # stdio MCP server exposing agent-facing payment tools
    ├── cli/                     # operator surface: `init` bootstrap plus day-2 treasury/policy/session commands
    ├── dashboard/               # Next.js operator dashboard (hosted tenancy, ADR-017)
    └── e2e/                     # Surfpool end-to-end suite (test pyramid layer 5, nightly)
```

The critical architectural split: **`programs/agent_rails` is thin** (Anchor handlers, account validation, CPI to SPL Token/Token-2022/System). **All policy arithmetic and the audit hash chain live in `crates/agent-rails-policy`**, which has no Solana dependency, is `#![forbid(unsafe_code)]`, uses `checked_*` arithmetic everywhere, and is property-tested/fuzzed/model-checked independently of any SVM. When changing spend-limit logic, window rollover, the ceiling partial order, or the audit hash, the change almost always belongs in the policy crate, not in the program.

On the TS side, `@agent-rails/contract` is the compatibility anchor that every other package (client, sdk, mcp, cli, dashboard) imports schemas/reason-codes/events from — it's the single source of truth for tool schemas and event shapes across MCP transports and adapters.

**`packages/cli` and `packages/mcp` are the two halves of the privilege split**, and which package a command lands in *is* the enforcement. Everything privileged — ceilings, policy writes, sessions, allowlist edits, pause/unpause, withdraw — is reachable only from the CLI and the dashboard; the MCP server exposes payment tools alone. A command that raises a limit is correct in `packages/cli/src/commands/` and a bug in `packages/mcp/src/tools/`. The CLI keeps its own `CLAUDE.md` with the rules that follow from that.

## Commands

### TypeScript / pnpm workspace (Turborepo, packages: `contract`, `client`, `sdk`, `mcp`, `cli`, `dashboard`, `e2e`)

```bash
pnpm build                # turbo run build (respects package dependency graph)
pnpm test                 # turbo run test (builds first — see turbo.json dependsOn)
pnpm lint                 # biome check .
pnpm format               # biome check --write .

pnpm dashboard            # next dev for packages/dashboard on 127.0.0.1:3000
pnpm agent-rails <args>   # run the built CLI (packages/cli/dist) without installing it

pnpm idl:build             # extract idl/agent_rails.json from the Anchor program without a full anchor build
pnpm codegen                # regenerate packages/client/src/generated from the IDL (codama)
pnpm codegen:check          # regenerate + git diff --exit-code — CI drift gate; run after any account/instruction change
```

Run a single package's build/test with turbo filters or pnpm's own filter flag, e.g.:
```bash
pnpm --filter @agent-rails/sdk test
pnpm --filter @agent-rails/mcp build
```

Run a single vitest file/test directly (each package has its own `vitest.config.ts`):
```bash
pnpm --filter @agent-rails/sdk exec vitest run src/payment-intent.test.ts
pnpm --filter @agent-rails/sdk exec vitest run -t "some test name"
```

**Codegen workflow order matters**: after any change to `programs/agent_rails` instructions/accounts, run `pnpm idl:build` then `pnpm codegen` before touching `packages/sdk` or `packages/mcp` — they build on the generated client. Never hand-edit files under `packages/client/src/generated/`.

### Rust workspace (Cargo members: `crates/agent-rails-policy`, `programs/agent_rails`)

```bash
cargo test --workspace          # also wired as `anchor test` via Anchor.toml [scripts]
cargo test -p agent-rails-policy                       # policy crate only (proptest suite)
cargo kani -p agent-rails-policy --output-format terse  # the Kani proofs; needs the pinned kani-verifier
scripts/verify.sh mutants                               # mutation testing, ~4 min; not part of `verify.sh all`
scripts/verify.sh e2e                                   # surfpool E2E, ~45s; needs surfpool + a built .so
cargo test -p agent_rails                               # program integration tests (anchor-litesvm, no validator needed)
cargo test -p agent_rails --test payments               # a single integration test file, e.g. tests/payments.rs
cargo test -p agent_rails --test payments some_test_name # a single test function

cargo fmt --check
cargo clippy --workspace -- -D warnings
```

Rust integration tests (`programs/agent_rails/tests/*.rs`: `payments`, `budget`, `lifecycle`, `layout`, `treasury`, `admin`, `operator`) use `anchor-litesvm` and need no validator. `tests/layout.rs` snapshot-tests account byte layouts — update it deliberately, not to silence a failure, since layout stability is what lets v1.1 features land without migrations. `overflow-checks = true` is mandatory in `[profile.release]` (Cargo.toml) — don't remove it.

### Anchor

`Anchor.toml` points `anchor test` at `cargo test --workspace` directly (layers 1–2 of the test pyramid need no validator). Program id is declared in both `Anchor.toml` and `programs/agent_rails/src/lib.rs` (`declare_id!`) — keep them in sync if it ever changes.

## Test pyramid (ADR-008)

Layered, Rust-first, documented in full in `ARCHITECTURE.md` §11 and `docs/adr/ADR-008-test-harness.md`:

1. `agent-rails-policy`: proptest + cargo-fuzz; Kani bounded model checking (`src/proofs.rs`, `scripts/verify.sh kani`).
2. `anchor-litesvm` integration tests in `programs/agent_rails/tests/` — every instruction, adversarial paths, clock warps.
3. Trident stateful fuzzing — blocked upstream: every published Trident needs `solana-sdk ^2.3` and this tree is Anchor 1.1.2 on solana 3.x (ADR-015). `cargo-mutants` gates the policy crate's test quality in the meantime (`.cargo/mutants.toml`, nightly).
4. `litesvm` (npm) for SDK/MCP; MCP contract tests via in-memory transport; tool-schema snapshots. `packages/cli` sits at this layer too but is not there yet: its pure decision logic (`planners/policy.ts`, `roles.ts`, `context.ts`'s resolvers, the `tx/*` builders) is unit-tested, while the command handlers in `src/commands/` and `chain/read.ts` are uncovered — they are RPC orchestration, and mocking an RPC to reach them buys less than putting them on litesvm.
5. Surfpool E2E nightly — `packages/e2e/`, `scripts/verify.sh e2e`. Forks devnet, pays in SOL, and includes a blinding proxy that withholds `getSignatureStatuses` to drive the SDK's `indeterminate` path. Devnet smoke on release tags is still deferred (ADR-015).

Coverage thresholds enforced in CI: policy crate ≥95% lines (`cargo llvm-cov`, measured 99.2%) and SDK ≥85% lines/statements/functions with ≥70% branches (thresholds in `packages/sdk/vitest.config.ts`, measured 89.4%). `packages/cli` measures coverage but gates nothing yet — the number is low by construction while the command handlers await layer 4, so a threshold now would only pin the gap in place. Every `vitest.config.ts` that reports coverage needs an explicit `include`: without it v8 counts only the files a test happened to import, which drops untested modules from the denominator and reports a number far better than the truth. Both run inside `scripts/verify.sh`; the Rust half skips loudly when `cargo-llvm-cov` is not installed, so a green local run is not proof it was measured. `scripts/verify.sh kani` skips the same way without `cargo-kani`. CU regression >10% over the committed baseline fails CI; baselines are in `programs/agent_rails/tests/cu-baselines.txt`, refreshed with `scripts/cu-baseline.sh`, and the spec §10 design gates are ≤45k CU for `execute_payment` and ≤35k for `execute_payment_sol`. (ADR-010's ≤40k / ≤600 bytes are the original design estimates; spec §10.1 amends them with measured figures and says why.)

## Key invariants to preserve when editing

- **Loosening flows downhill only**: owner sets ceilings → operator sets policy ≤ ceiling → the agent sets nothing. Any code path that lets a lower-privileged role raise a limit is a bug.
- **The agent-facing MCP/SDK surface has zero privilege-escalating tools.** `create_session`, `update_policy`, `unpause`, `withdraw`, and allowlist edits must never be exposed as agent tools — this is enforced by convention, not by the type system, so don't add them to `packages/mcp/src/tools/` or `packages/contract/src/mcp-tools.ts`.
- **Idempotency by construction**: every payment path must go through `IntentReceipt` init-on-`intent_id`; never add a payment path that skips receipt creation.
- **Pause is an agent kill switch, not an owner lock.** Owner withdrawal must keep working even when `paused` is true.
- Windows are fixed epoch buckets, not rolling — don't reintroduce ring-buffer/rolling-window logic (rejected for CU cost and fuzz-resistance, see ARCHITECTURE.md §6).

## Conventions

- TS: Biome for lint/format (double quotes, semicolons, 2-space indent, 100-char lines) — run `pnpm format` rather than hand-formatting. `tsconfig.base.json` has `strict`, `noUncheckedIndexedAccess`, and `exactOptionalPropertyTypes` on; new packages should extend it.
- Rust: `#![forbid(unsafe_code)]` and `#![deny(clippy::arithmetic_side_effects)]` in the policy crate are load-bearing, not boilerplate — all arithmetic there must be `checked_*`.
- Comments in this codebase tend to explain *why* a non-obvious constraint exists (pinned dependency versions, feature-flag interactions, CU/security tradeoffs) rather than what the code does — match that style rather than adding narrative comments.
