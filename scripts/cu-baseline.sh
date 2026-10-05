#!/usr/bin/env bash
#
# Re-measures the payment paths and reports how far the committed baselines in
# programs/ash/tests/cu-baselines.txt have moved; `--write` applies the
# measurements to that file.
#
# This is a helper, not a gate. The gate is `tests/budget.rs`, which CI already runs
# inside `cargo test --workspace` — a second check here would be one more thing to keep
# in sync and nothing more. What this exists for is the other half: making a baseline
# refresh mechanical, so the numbers stop being retyped by hand and drifting behind the
# build, which is how they fell ~820 CU behind before anything noticed.
#
#   scripts/cu-baseline.sh           measure and show the drift
#   scripts/cu-baseline.sh --write   measure and rewrite the baselines
#
# A `--write` is a claim that the new cost is intended. The diff it produces is where
# that claim gets reviewed, so commit it with the change that caused it, not on its own.
#
# The test loads compiled programs, so a fresh checkout needs `cargo build-sbf` once
# first (see scripts/verify.sh).

set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.." || exit 1

baselines=programs/ash/tests/cu-baselines.txt
write=false
case "${1:-}" in
"") ;;
--write) write=true ;;
*)
  echo "usage: scripts/cu-baseline.sh [--write]" >&2
  exit 2
  ;;
esac

# `--test-threads=1` because the measurements print interleaved otherwise, and `|| true`
# because a run that fails its gate is exactly the run whose new number you need to see:
# budget.rs prints the machine-readable line before it asserts.
echo "▸ measuring (cargo test -p ash --test budget)"
output=$(cargo test -p ash --test budget -- --nocapture --test-threads=1 2>&1)
status=$?

# Unanchored: libtest prints `test <name> ... ` without a newline, so the marker lands
# mid-line rather than at the start of one.
measured=$(grep -oP 'cu-baseline\t\K\S+\t[0-9]+' <<<"$output")
if [[ -z "$measured" ]]; then
  echo "✗ no measurements in the test output — the run did not get that far:" >&2
  echo "$output" | tail -30 >&2
  exit 1
fi

if ((status != 0)); then
  echo "! the budget test failed; the numbers below are still the real measurements"
fi

printf '\n%-34s%10s%10s%9s\n' "path" "committed" "measured" "drift"
awk -v measured="$measured" -v baselines="$baselines" '
  BEGIN {
    n = split(measured, rows, "\n")
    for (i = 1; i <= n; i++) {
      split(rows[i], f, "\t")
      now[f[1]] = f[2]
    }
    while ((getline line < baselines) > 0) {
      if (line ~ /^[[:space:]]*(#|$)/) continue
      split(line, g, /[[:space:]]+/)
      committed[g[1]] = g[2]
      order[++count] = g[1]
    }
    drifted = 0
    for (i = 1; i <= count; i++) {
      key = order[i]
      if (!(key in now)) { printf "%-34s%10s%10s%9s\n", key, committed[key], "-", "not run"; continue }
      delta = now[key] - committed[key]
      pct = committed[key] > 0 ? delta * 100.0 / committed[key] : 0
      if (delta != 0) drifted++
      printf "%-34s%10d%10d%+8.1f%%\n", key, committed[key], now[key], pct
    }
    # A key measured but absent from the file is a new path with no baseline: silence
    # would let it ship ungated.
    for (key in now) if (!(key in committed)) printf "%-34s%10s%10d%9s\n", key, "-", now[key], "NEW"
    exit drifted == 0 ? 0 : 1
  }'
drift_status=$?

if [[ $write == false ]]; then
  echo
  if ((drift_status == 0)); then
    echo "✓ baselines match the build"
  else
    echo "· run with --write to commit these measurements"
  fi
  exit 0
fi

# Rewrite in place, preserving every comment and the column layout. Only the baseline
# column of an existing row changes: the spec gate and the label are editorial and
# nothing measured should overwrite them.
tmp=$(mktemp) || exit 1
awk -v measured="$measured" '
  BEGIN {
    n = split(measured, rows, "\n")
    for (i = 1; i <= n; i++) { split(rows[i], f, "\t"); now[f[1]] = f[2] }
  }
  /^[[:space:]]*(#|$)/ { print; next }
  {
    split($0, g, /[[:space:]]+/)
    if (g[1] in now) {
      label = $0
      sub(/^[^[:space:]]+[[:space:]]+[^[:space:]]+[[:space:]]+[^[:space:]]+[[:space:]]+/, "", label)
      printf "%-34s%-7s%-7s%s\n", g[1], now[g[1]], g[3], label
    } else print
  }' "$baselines" >"$tmp" && mv "$tmp" "$baselines"

echo
echo "✓ wrote $baselines — review the diff before committing"
git --no-pager diff --stat -- "$baselines"
