#!/usr/bin/env bash
#
# The verifiable-build half of ADR-011: what is deployed, and whether it is what this
# source tree builds.
#
#   scripts/program-hash.sh build              build the program and hash the artifact
#   scripts/program-hash.sh onchain [cluster]  hash the program currently deployed there
#   scripts/program-hash.sh compare [cluster]  both, and say whether they agree
#
# `cluster` is anything `solana --url` accepts; it defaults to devnet.
#
# ## What this hash is, and what it is not
#
# It is the SHA-256 of the SBF artifact `cargo build-sbf` produces from this tree, with the
# Agave toolchain and `Cargo.lock` pinned. Two people on the same commit and the same
# toolchain get the same digest, and the on-chain comparison below tells a user whether the
# deployed bytes are those bytes.
#
# It is **not** yet a hermetic container build. `solana-verify build` runs the compiler
# inside a pinned image and removes the host from the equation entirely; the images are
# published per Agave release and this tree is on Anchor 1.1.2 / Agave 3.x, which they do
# not cover yet. When they do, this script grows a third mode and the ADR records the
# switch. Saying "reproducible" without that distinction would be the kind of claim ADR-011
# exists to keep honest.
#
# ## Why the on-chain bytes need trimming
#
# `solana program dump` writes the whole programdata account, which is padded with zero
# bytes out to whatever length was reserved at deploy time. Hashing that compares the
# padding as much as the program. Trailing zeros are stripped before hashing, which is what
# `solana-verify get-program-hash` does and why its digests match this one.

set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.." || exit 1

mode=${1:-compare}
cluster=${2:-devnet}

PROGRAM_ID=$(sed -n 's/^declare_id!("\(.*\)");/\1/p' programs/agent_rails/src/lib.rs)
SO_PATH=target/deploy/agent_rails.so

die() {
  printf '\033[31m%s\033[0m\n' "$1" >&2
  exit 1
}

[[ -n $PROGRAM_ID ]] || die "could not read declare_id! from programs/agent_rails/src/lib.rs"

# Hash a file with its trailing zero padding removed, so a dumped account and a freshly
# built artifact are comparable. node rather than a shell pipeline: `$(...)` eats NUL bytes
# and trailing newlines, which is exactly the data being hashed.
trimmed_hash() {
  node -e '
    const { readFileSync } = require("node:fs");
    const { createHash } = require("node:crypto");
    const bytes = readFileSync(process.argv[1]);
    let end = bytes.length;
    while (end > 0 && bytes[end - 1] === 0) end--;
    process.stdout.write(createHash("sha256").update(bytes.subarray(0, end)).digest("hex"));
  ' "$1"
}

build_hash() {
  command -v cargo-build-sbf >/dev/null 2>&1 ||
    die "cargo-build-sbf is not on PATH — install the Agave toolchain (see .github/workflows/idl.yml for the pinned version)"
  cargo build-sbf --manifest-path programs/agent_rails/Cargo.toml >&2 ||
    die "cargo build-sbf failed"
  [[ -f $SO_PATH ]] || die "$SO_PATH was not produced"
  trimmed_hash "$SO_PATH"
}

onchain_hash() {
  command -v solana >/dev/null 2>&1 || die "solana is not on PATH"
  local dump
  dump=$(mktemp -t agent-rails-onchain.XXXXXX.so) || die "could not create a temp file"
  # shellcheck disable=SC2064
  trap "rm -f '$dump'" RETURN
  solana program dump "$PROGRAM_ID" "$dump" --url "$cluster" >&2 ||
    die "could not dump $PROGRAM_ID from $cluster"
  trimmed_hash "$dump"
}

build_info() {
  local hash=$1
  local agave anchor rustc
  agave=$(sed -n 's/^  AGAVE_VERSION: \(.*\)$/\1/p' .github/workflows/idl.yml)
  anchor=$(sed -n 's/^anchor_version = "\(.*\)"/\1/p' Anchor.toml)
  rustc=$(sed -n 's/^channel = "\(.*\)"/\1/p' rust-toolchain.toml)
  cat <<JSON
{
  "programId": "$PROGRAM_ID",
  "sha256": "$hash",
  "commit": "$(git rev-parse HEAD 2>/dev/null || echo unknown)",
  "agaveVersion": "${agave:-unknown}",
  "anchorVersion": "${anchor:-unknown}",
  "rustToolchain": "${rustc:-unknown}",
  "cargoLockSha256": "$(sha256sum Cargo.lock | cut -d' ' -f1)",
  "builtAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "hermetic": false
}
JSON
}

case $mode in
build)
  hash=$(build_hash) || exit 1
  build_info "$hash" | tee target/deploy/agent_rails.build-info.json
  printf '%s  agent_rails.so\n' "$hash" > target/deploy/agent_rails.so.sha256
  ;;
onchain)
  hash=$(onchain_hash) || exit 1
  printf '%s\n' "$hash"
  ;;
compare)
  built=$(build_hash) || exit 1
  deployed=$(onchain_hash) || exit 1
  printf 'built    %s\n' "$built"
  printf 'deployed %s  (%s, %s)\n' "$deployed" "$cluster" "$PROGRAM_ID"
  if [[ $built == "$deployed" ]]; then
    printf '\033[32m✓ the deployed program is this source tree\033[0m\n'
  else
    # Not an error the caller should ignore, and not necessarily a compromise either:
    # an unreleased commit differing from the deployed release is the normal case.
    printf '\033[33m! they differ — the deployed program was built from another commit\033[0m\n'
    exit 1
  fi
  ;;
*)
  echo "usage: scripts/program-hash.sh [build|onchain|compare] [cluster]" >&2
  exit 2
  ;;
esac
