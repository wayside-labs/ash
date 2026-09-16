#!/usr/bin/env bash
#
# PostToolUse formatter. Formats the one file that was just written, so a diff
# never carries formatting noise and `pnpm lint` / `cargo fmt --check` in CI stay
# about the code rather than about whitespace.
#
# Mirrors lefthook.yml's pre-commit jobs: same tools, same exclusions. The
# difference is timing — this runs per edit, lefthook runs per commit, and CI is
# what actually fails a push.

set -uo pipefail

repo=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd) || exit 0

file=$(jq -r '.tool_response.filePath // .tool_input.file_path // ""')
[[ -n "$file" && -f "$file" ]] || exit 0

case "$file" in
# Codama owns the formatting of its own output; biome.json excludes it for the
# same reason. Reformatting here would show up as codegen:check drift in CI.
*/packages/client/src/generated/*) exit 0 ;;
*.rs) rustfmt --edition 2021 "$file" 2>/dev/null || true ;;
*.ts | *.tsx | *.js | *.json | *.jsonc)
  "$repo/node_modules/.bin/biome" check --write --no-errors-on-unmatched "$file" >/dev/null 2>&1 || true
  ;;
esac

exit 0
