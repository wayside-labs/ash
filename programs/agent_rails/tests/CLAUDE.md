# programs/agent_rails/tests

Layer 2 of the ADR-008 pyramid: `anchor-litesvm`, no validator, no `solana-test-validator`
to start. `cargo test -p agent_rails --test payments` runs one file.

## Build on common/mod.rs

It is ~2000 lines of fixtures and it already covers most of what a new test needs: `Env`,
`create_treasury`, `add_spl_mint` / `add_native_mint`, the Token-2022 variants
(`create_token_2022_with_transfer_hook`, `..._non_transferable`, `..._transfer_fee`,
`..._permanent_delegate`), every PDA derivation, `permissive_ceiling` /
`permissive_policy_args`, and `assert_program_error`. Standing up a treasury by hand in a
new file is how two harnesses start to disagree about what a valid treasury is.

Use `assert_program_error` rather than matching on error strings — it pins the
`AgentRailsError` variant, so a renumbered error code fails loudly instead of a test
passing on the wrong rejection.

## Which file

`payments` execute paths, `budget` CU measurements, `lifecycle` session and receipt
lifetimes, `admin` owner-only instructions, `operator` policy and allowlist edits,
`treasury` creation and mints, `native_allowance` the ADR-014 CPI, `pda_owner` a
program-derived `Treasury.owner`, `layout` byte offsets.

## layout.rs is a snapshot, not a test you fix

It reads every absolute field offset from the spec table back out of a serialized account.
A failure means an account's byte layout moved, which is a breaking change for every Codama
client and indexer downstream — and layout stability is the thing that lets v1.1 features
land without migrations. Update it only when the layout change is the intent, and update
`docs/spec/accounts-and-instructions.md` §3 in the same commit. A `PreToolUse` hook asks
before an edit here for this reason.

## fixtures/subscriptions_devnet.so

The real native Subscriptions & Allowances program, dumped from devnet with
`solana program dump`, not a rebuild from source. ADR-014's security argument is that a
leaked session key cannot call the native program's `transferFixed` directly, and that only
means something when tested against the binary that is actually deployed. Do not replace it
with a locally built stub.

## CU budgets

`cu-baselines.txt` holds the committed numbers and `budget.rs` asserts against them, so the
ADR-008 gate — fail on >10% over the committed budget — runs inside `cargo test --workspace`
and therefore inside CI. Each path carries two thresholds: the spec §10 design gate, which
catches an instruction outgrowing what it was designed for, and the baseline at +10%, which
catches a *change* long before that.

Do not retype a number in `cu-baselines.txt` to make a red test green. `scripts/cu-baseline.sh`
re-measures and `--write` applies the result; the diff it leaves is the reviewable claim that
the new cost is intended, and it belongs in the commit that caused it. Hand-maintained
baselines are what let these figures fall ~820 CU behind the build while the gate stayed
green.

A path with `none` in the gate column has a baseline but no spec number — currently the
ADR-014 `NativeAllowance` CPI, whose design ceiling waits on the caller-supplied-bumps gap.
A baseline only has to be reproducible, which `compute_unit_measurements_are_reproducible`
asserts for every measured path.
