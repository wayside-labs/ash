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

`budget.rs` measures real costs; `execute_payment` targets ≤40k CU. ADR-008 wants CI to fail
on a >10% regression against a committed budget, and that baseline file does not exist yet
(ADR-015). Until it does, a number moving in `budget.rs` is something to look at rather
than something CI will catch for you.
