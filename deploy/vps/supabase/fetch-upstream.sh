#!/usr/bin/env bash
# Fetch the supabase/supabase docker/ files named in upstream.lock into a directory, refusing any
# file whose checksum differs. The stack runs as root through docker, so nothing unreviewed may
# reach it: a moved tag or a compromised mirror fails here instead of at `compose up`.
#   fetch-upstream.sh <dest>          fetch and verify (bootstrap.sh calls this)
#   fetch-upstream.sh --print <dest>  fetch at the lock's commit and print fresh sums (for bumps)
set -euo pipefail

print=0
[[ ${1:-} == --print ]] && { print=1; shift; }
dest="${1:?usage: fetch-upstream.sh [--print] <dest>}"
lock="$(cd "$(dirname "$0")" && pwd)/upstream.lock"
commit="$(awk '$1 == "commit" { print $2 }' "$lock")"
[[ $commit =~ ^[0-9a-f]{40}$ ]] || { echo "no commit sha in $lock" >&2; exit 1; }

mkdir -p "$dest"
grep -E '^[0-9a-f]{64}  ' "$lock" | while read -r sum path; do
  mkdir -p "$dest/$(dirname "$path")"
  curl -fsSL --retry 5 --retry-all-errors -o "$dest/$path.part" \
    "https://raw.githubusercontent.com/supabase/supabase/$commit/docker/$path"
  got="$(sha256sum "$dest/$path.part" | cut -d' ' -f1)"
  if (( print )); then
    echo "$got  $path"
  elif [[ $got != "$sum" ]]; then
    rm -f "$dest/$path.part"
    echo "checksum mismatch for $path at $commit" >&2
    exit 1
  fi
  mv -f "$dest/$path.part" "$dest/$path"
done
# Studio mounts these; upstream keeps them as empty directories in git.
mkdir -p "$dest/volumes/snippets" "$dest/volumes/functions" "$dest/volumes/db/data"
