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
# Coverage is included but skips loudly when cargo-llvm-cov is missing, rather than
# passing quietly: a gate that reports success because its tool is absent is worse
# than one that is not there at all. CI installs it, so CI always runs it.

set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.." || exit 1

group=${1:-all}
failed=()
skipped=()

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
    skipped+=("coverage (policy >=95%%)")
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

if [[ $group != all && $group != rust && $group != ts ]]; then
  echo "usage: scripts/verify.sh [all|rust|ts]" >&2
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
