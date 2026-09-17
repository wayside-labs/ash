#!/usr/bin/env bash
#
# The local gate. Runs exactly what CI runs, in the same order, so a failure
# surfaces in your terminal instead of on a pull request.
#
# .github/workflows/ci.yml calls this script by group, which is what keeps the
# two from drifting: there is one list of checks, not a local one and a CI one.
#
#   scripts/verify.sh          everything
#   scripts/verify.sh rust     fmt, clippy, overflow-checks, cargo test
#   scripts/verify.sh ts       lint, typecheck, test, codegen drift, audit
#   scripts/verify.sh kani     bounded model checking of the policy crate
#   scripts/verify.sh mutants  mutation testing of the policy crate (nightly gate)
#   scripts/verify.sh e2e      Surfpool end-to-end suite (nightly gate)
#
# The integration tests deploy compiled programs, so a fresh checkout with an
# empty target/ needs `cargo build-sbf` (or `anchor build`) once before the rust
# group passes; tests/common/mod.rs panics with the exact command if they are
# missing. CI does that in its own step, before calling this.
#
# Not included: cargo-deny, gitleaks and semgrep. They need tools that are not
# part of a normal checkout, and CI has them. `cargo deny check` is worth running
# locally when you touch dependencies.
#
# Coverage, Kani, mutants and e2e skip loudly when their tool is missing, rather than
# passing quietly: a gate that reports success because its tool is absent is worse than one
# that is not there at all.
#
# "Loudly" is enough for a human reading their own terminal and is not enough for CI, where
# nobody reads a green log. Set VERIFY_STRICT=1 — every CI job that calls this script does —
# and a skip becomes a failure. This is not hypothetical: the e2e workflow shipped with an
# install step whose URL did not resolve, `curl | bash` hid the failure from `bash -e`, and
# the job reported success having run no tests at all.

set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.." || exit 1

# Pinned, and read back out of this file by .github/workflows/kani.yml so there is one
# version rather than a local one and a CI one. Kani ships its own rustc and its own CBMC,
# and a proof that discharges under one release is not evidence about another: an upgrade
# is a deliberate change, made here, with the proofs re-run.
KANI_VERSION=0.68.0

# Pinned and read back out of this file by .github/workflows/mutants.yml, for the same
# reason as above. A cargo-mutants release can change which mutants it generates, and a
# gate whose population moves under it reports a regression that is really an upgrade.
MUTANTS_VERSION=27.1.0

group=${1:-all}
strict=${VERIFY_STRICT:-0}
failed=()
skipped=()

# Record a skip. Under VERIFY_STRICT it is a failure instead, because a check that did not
# run is not a check that passed.
note_skip() {
  local name=$1
  if [[ $strict == 1 ]]; then
    printf '\033[31mstrict: refusing to pass with this check skipped\033[0m\n'
    failed+=("$name (skipped under VERIFY_STRICT)")
  else
    skipped+=("$name")
  fi
}

run() {
  local name=$1
  shift
  printf '\n\033[1m▸ %s\033[0m\n' "$name"
  if "$@"; then
    return 0
  fi
  failed+=("$name")
  return 1
}

if [[ $group == all || $group == rust ]]; then
  run "cargo fmt --check" cargo fmt --check
  run "cargo clippy" cargo clippy --workspace --all-targets -- -D warnings
  # Mirrors the CI step: release builds must trap on overflow, not wrap.
  run "overflow-checks" grep -qE '^overflow-checks = true$' Cargo.toml
  run "cargo test" cargo test --workspace
  # ADR-008: policy crate >=95%. The crate is the layer with no Solana dependency, so
  # this is the one place the spend arithmetic can be measured on its own.
  if command -v cargo-llvm-cov >/dev/null 2>&1; then
    run "coverage (policy >=95%)" cargo llvm-cov -p agent-rails-policy \
      --summary-only --fail-under-lines 95
  else
    printf '\n\033[1m▸ coverage (policy >=95%%)\033[0m\n'
    printf '\033[33mskipped: cargo-llvm-cov is not installed\033[0m\n'
    printf '  cargo install cargo-llvm-cov --locked\n'
    note_skip "coverage (policy >=95%%)"
  fi
fi

if [[ $group == all || $group == kani ]]; then
  # ADR-008 layer 1, ADR-015. Proptest samples the policy arithmetic; these harnesses
  # quantify over every input of their types, which is the only way the crate's claims
  # about corrupted counters and the ceiling partial order get checked at all — proptest
  # generates inputs that are valid by construction and so never reaches them.
  if command -v cargo-kani >/dev/null 2>&1; then
    installed=$(cargo kani --version 2>/dev/null | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1)
    if [[ -n $installed && $installed != "$KANI_VERSION" ]]; then
      printf '\033[33m! kani %s installed, %s pinned — proofs discharge against the solver that ran them\033[0m\n' \
        "$installed" "$KANI_VERSION"
    fi
    run "kani (policy proofs)" cargo kani -p agent-rails-policy --output-format terse
  else
    printf '\n\033[1m▸ kani (policy proofs)\033[0m\n'
    printf '\033[33mskipped: cargo-kani is not installed\033[0m\n'
    printf '  cargo install --locked kani-verifier --version %s && cargo-kani setup\n' "$KANI_VERSION"
    note_skip "kani (policy proofs)"
  fi
fi

# Not part of `all`, unlike every other group here. ADR-008 scopes cargo-mutants to
# nightly, and the run costs ~4 minutes against the ~3 the whole rest of this script
# takes — tripling the local gate for a check that does not gate a pull request would
# only teach people to stop running the local gate. `verify.sh mutants` on demand, and
# the nightly workflow otherwise.
if [[ $group == mutants ]]; then
  # The gate is "no surviving mutant"; cargo-mutants exits non-zero when one survives.
  # Scope, exclusions and timeout all live in .cargo/mutants.toml so this command and the
  # nightly workflow cannot disagree about what is being measured.
  if command -v cargo-mutants >/dev/null 2>&1; then
    installed=$(cargo mutants --version 2>/dev/null | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1)
    if [[ -n $installed && $installed != "$MUTANTS_VERSION" ]]; then
      printf '\033[33m! cargo-mutants %s installed, %s pinned — the mutant population is version-dependent\033[0m\n' \
        "$installed" "$MUTANTS_VERSION"
    fi
    run "mutants (policy, no survivors)" cargo mutants --jobs 4
  else
    printf '\n\033[1m▸ mutants (policy, no survivors)\033[0m\n'
    printf '\033[33mskipped: cargo-mutants is not installed\033[0m\n'
    printf '  cargo install --locked cargo-mutants --version %s\n' "$MUTANTS_VERSION"
    note_skip "mutants (policy, no survivors)"
  fi
fi

# Not part of `all`, for the same reason as `mutants`: ADR-008 scopes layer 5 to nightly,
# it needs a compiled program and the surfpool binary, and it boots a validator per file.
if [[ $group == e2e ]]; then
  # Layer 5 of the ADR-008 pyramid: the only layer where the TypeScript client talks to a
  # validator. Everything below it executes instructions without a network, so a blockhash
  # that expires and a confirmation that times out are unreachable there.
  if ! command -v surfpool >/dev/null 2>&1; then
    printf '\n\033[1m▸ e2e (surfpool)\033[0m\n'
    printf '\033[33mskipped: surfpool is not installed\033[0m\n'
    printf '  https://docs.surfpool.run — or: cargo install surfpool-cli\n'
    note_skip "e2e (surfpool)"
  elif [[ ! -f target/deploy/agent_rails.so ]]; then
    printf '\n\033[1m▸ e2e (surfpool)\033[0m\n'
    printf '\033[33mskipped: target/deploy/agent_rails.so is missing\033[0m\n'
    printf '  cargo build-sbf --manifest-path programs/agent_rails/Cargo.toml\n'
    note_skip "e2e (surfpool)"
  else
    run "e2e (surfpool)" pnpm --filter @agent-rails/e2e test:e2e
  fi
fi

if [[ $group == all || $group == ts ]]; then
  run "pnpm lint" pnpm lint
  run "pnpm typecheck" pnpm typecheck
  run "pnpm test" pnpm test
  # Regenerates the client from the committed IDL; fails on a hand edit.
  run "pnpm codegen:check" pnpm codegen:check
  run "pnpm audit" pnpm audit --prod --audit-level high
  # ADR-008: SDK core >=85%. Thresholds live in packages/sdk/vitest.config.ts so a
  # bare `vitest --coverage` enforces the same numbers this does.
  run "coverage (sdk >=85%)" pnpm coverage
fi

if [[ $group != all && $group != rust && $group != ts && $group != kani && $group != mutants && $group != e2e ]]; then
  echo "usage: scripts/verify.sh [all|rust|ts|kani|mutants|e2e]" >&2
  exit 2
fi

echo
if ((${#skipped[@]})); then
  printf '\033[33m! %d skipped:\033[0m %s\n' "${#skipped[@]}" "${skipped[*]}"
fi
if ((${#failed[@]})); then
  printf '\033[31m✗ %d failed:\033[0m %s\n' "${#failed[@]}" "${failed[*]}"
  exit 1
fi
printf '\033[32m✓ all checks passed\033[0m\n'
