#!/usr/bin/env bash
#
# PreToolUse gate. Reads the tool call as JSON on stdin and answers with a
# permissionDecision, or says nothing and lets the normal permission flow run.
#
# What this is: fast feedback against an accidental edit, delivered before the
# write instead of after a CI run.
#
# What this is NOT: a security boundary. A path-based deny on Write|Edit does not
# stop `cat > file` through Bash, and chasing every shell spelling of "write a
# file" is a game the regex loses. The real enforcement for each rule below lives
# in CI, which is deterministic and cannot be talked out of it:
#   generated client  -> pnpm codegen:check
#   overflow-checks   -> the grep step in .github/workflows/ci.yml
#   account layouts   -> programs/agent_rails/tests/layout.rs
# Treat a deny here as a typo-catcher, not a control.
#
# `ask` and `deny` are not two strengths of the same thing. An `ask` hands the call
# back to the normal permission flow, and a session running in an auto-accepting mode
# approves it without showing anyone — verified on 2026-09-16, when an ADR edit here
# raised no prompt at all. So `ask` is feedback for an interactive session and nothing
# whatsoever for an automated one. Only `deny` holds in both.
#
# Which rules earn a `deny` follows from that: the ones where nothing downstream would
# catch the mistake.
#   layout.rs    -> that file *is* the check. Editing the snapshot to match a moved
#                   layout makes CI green on a breaking change — the one failure the
#                   test cannot catch on its own behalf.
#   deploy /     -> ADR-011 puts upgrades behind the multisig and a public notice
#   authority       window. No CI step sits between this command and a live program
#                   holding custody, and it does not come back.
#
# The rest stay `ask` on purpose: CI re-checks them (codegen:check) or the server does
# (force-push protection on main), so an approval that never appears costs a round
# trip rather than an invariant.
#
# A deny binds the agent, not the owner: this hook only ever sees Claude's tool calls.
# Anything refused here is still one `!` away in the owner's own terminal.

set -uo pipefail

payload=$(cat)
tool=$(jq -r '.tool_name // ""' <<<"$payload")
file=$(jq -r '.tool_input.file_path // ""' <<<"$payload")
command=$(jq -r '.tool_input.command // ""' <<<"$payload")
old_string=$(jq -r '.tool_input.old_string // ""' <<<"$payload")
new_string=$(jq -r '.tool_input.new_string // ""' <<<"$payload")
content=$(jq -r '.tool_input.content // ""' <<<"$payload")

decide() {
  jq -cn --arg d "$1" --arg r "$2" '{
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: $d,
      permissionDecisionReason: $r
    }
  }'
  exit 0
}

case "$tool" in
Write | Edit)
  case "$file" in
  */packages/client/src/generated/*)
    decide deny "packages/client/src/generated is Codama output. Change the program or packages/client/codama.json and run 'pnpm codegen' — CI's codegen:check regenerates from the committed IDL and fails on any hand edit."
    ;;
  esac

  # `overflow-checks` makes the Anchor layer trap rather than wrap on arithmetic the
  # policy crate's checked_* does not cover. Removing it is silent until it is not.
  if [[ "$file" == */Cargo.toml ]]; then
    if [[ -n "$old_string" && "$old_string" == *overflow-checks* && "$new_string" != *overflow-checks* ]]; then
      decide deny "overflow-checks = true in [profile.release] is mandatory (Cargo.toml, CLAUDE.md). Removing it makes release builds wrap instead of trap."
    fi
    if [[ -n "$content" && "$content" != *overflow-checks* ]] && grep -q "overflow-checks" "$file" 2>/dev/null; then
      decide deny "This rewrite of $file drops overflow-checks = true, which is mandatory in [profile.release]."
    fi
  fi

  case "$file" in
  */programs/agent_rails/tests/layout.rs)
    decide deny "layout.rs snapshots account byte layouts, and is itself the check that a layout moved — editing it to match a new layout makes CI green on a breaking change for every Codama client and indexer downstream. Layout stability is what lets v1.1 land without migrations. If the layout change is the intent, the owner edits this file and docs/spec §3 in the same commit."
    ;;
  */docs/adr/ADR-*.md)
    # Only an existing one. Writing a *new* ADR is the supported way to supersede a
    # settled decision, so asking about it would gate the recommended path.
    if [[ -f "$file" ]]; then
      decide ask "ADRs are immutable (docs/adr/README.md). Revisiting a settled decision means adding a new ADR that supersedes this one."
    fi
    ;;
  esac
  ;;

Bash)
  if grep -qE '(^|[[:space:]])git[[:space:]]+push([[:space:]]|$).*--force' <<<"$command"; then
    decide ask "git push --force rewrites published history."
  fi
  if grep -qE '(^|[[:space:]])anchor[[:space:]]+deploy' <<<"$command" ||
    grep -qE '(^|[[:space:]])solana[[:space:]]+program[[:space:]]+(deploy|write-buffer|set-upgrade-authority|close)' <<<"$command"; then
    decide deny "This deploys or changes authority on a live program. ADR-011 puts upgrades behind the multisig and a public notice window, and no CI step sits between this command and a program holding custody. The owner runs it."
  fi
  # Not exhaustive by construction — see the header. Catches the obvious redirect.
  if grep -qE 'packages/client/src/generated' <<<"$command" &&
    grep -qE '>|tee|sed -i|truncate|rm ' <<<"$command"; then
    decide ask "This looks like it writes into packages/client/src/generated, which is Codama output. 'pnpm codegen' is the supported way to change it."
  fi
  ;;
esac

# No opinion: fall through to the normal permission flow.
exit 0
