#!/usr/bin/env bash
#
# Runbook §4 on devnet: guardian add → spend → watcher pause → owner withdraw while paused.
#
#   scripts/guardian-watch-devnet-proof.sh --wallet <owner-keypair> [--out <dir>] [--rpc <url>]
#
# Prints pause and withdraw signatures on stdout (for PR evidence).

set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.." || exit 1

RPC=${RPC:-https://api.devnet.solana.com}
WALLET=""
OUT=""
CLI="node packages/cli/dist/cli.js"

while [[ $# -gt 0 ]]; do
  case $1 in
  --wallet)
    WALLET=$2
    shift 2
    ;;
  --out)
    OUT=$2
    shift 2
    ;;
  --rpc)
    RPC=$2
    shift 2
    ;;
  *)
    echo "usage: scripts/guardian-watch-devnet-proof.sh --wallet <keypair> [--out <dir>] [--rpc <url>]" >&2
    exit 2
    ;;
  esac
done

die() {
  printf '\033[31m%s\033[0m\n' "$1" >&2
  exit 1
}

[[ -n $WALLET ]] || die "--wallet is required"
[[ -f $WALLET ]] || die "no keypair at $WALLET"
[[ -f packages/cli/dist/cli.js ]] || die "build the CLI: pnpm --filter @agent-rails/cli build"
[[ -f packages/client/dist/index.js ]] || die "build the client: pnpm --filter @agent-rails/client build"
[[ -f packages/sdk/dist/index.js ]] || die "build the SDK: pnpm --filter @agent-rails/sdk build"

if [[ -z $OUT ]]; then
  OUT=$(mktemp -d -t agent-rails-guardian.XXXXXX) || die "could not create work directory"
fi
mkdir -p "$OUT"
umask 077

GUARDIAN_KP="$OUT/guardian-keypair.json"
step() { printf '\n\033[1m▸ %s\033[0m\n' "$1" >&2; }

retrying() {
  local attempt=1
  local out
  while :; do
    if out=$("$@" 2>&1); then
      printf '%s' "$out"
      return 0
    fi
    if [[ $attempt -ge 5 ]] || ! grep -q "429\|rate\|Too Many Requests" <<<"$out"; then
      printf '%s' "$out" >&2
      return 1
    fi
    printf '\033[33m  rate-limited, retrying in 12s (%d/5)\033[0m\n' "$attempt" >&2
    sleep 12
    attempt=$((attempt + 1))
  done
}

breathe() { sleep 8; }

jq_field() {
  node -e '
    let raw = "";
    process.stdin.on("data", (c) => (raw += c));
    process.stdin.on("end", () => {
      const value = process.argv[1]
        .split(".")
        .reduce((node, key) => (node == null ? node : node[key]), JSON.parse(raw));
      process.stdout.write(String(value ?? ""));
    });
  ' "$1"
}

step "Generating guardian keypair"
solana-keygen new -o "$GUARDIAN_KP" --no-bip39-passphrase --force >/dev/null 2>&1 ||
  die "could not write guardian keypair (need solana-keygen)"

GUARDIAN_ADDR=$(solana-keygen pubkey "$GUARDIAN_KP")

step "Bootstrapping treasury on $RPC"
init_json=$(
  retrying $CLI init \
    --rpc "$RPC" \
    --wallet "$WALLET" \
    --out "$OUT" \
    --name guardian-proof \
    --deposit 0.03 \
    --fee-budget 0.01 \
    --per-tx 0.01 \
    --daily 0.02 \
    --no-airdrop \
    --yes \
    --json
) || die "init failed"

treasury=$(printf '%s' "$init_json" | jq_field manifest.treasury)
policy=$(printf '%s' "$init_json" | jq_field manifest.policy)
destination_label=$(printf '%s' "$init_json" | jq_field manifest.destinationLabel)
session=$(printf '%s' "$init_json" | jq_field manifest.session)
[[ -n $treasury && -n $policy && -n $destination_label ]] || die "init manifest incomplete"

breathe
step "Adding guardian $GUARDIAN_ADDR"
retrying $CLI guardian add "$GUARDIAN_ADDR" \
  --rpc "$RPC" \
  --wallet "$WALLET" \
  --out "$OUT" \
  --yes \
  --json >/dev/null || die "guardian add failed"

breathe
step "Spending toward short-window limit (two payments)"
$CLI pay \
  --rpc "$RPC" \
  --wallet "$WALLET" \
  --out "$OUT" \
  --to "$destination_label" \
  --amount 0.009 \
  --mint SOL \
  --reference "guardian-proof-1-$(date -u +%s)" \
  --yes \
  --json >/dev/null || die "first pay failed"

breathe

$CLI pay \
  --rpc "$RPC" \
  --wallet "$WALLET" \
  --out "$OUT" \
  --to "$destination_label" \
  --amount 0.009 \
  --mint SOL \
  --reference "guardian-proof-2-$(date -u +%s)" \
  --yes \
  --json >/dev/null || die "second pay failed"

breathe
step "Running guardian watcher (expect pause)"
watch_out=$(pnpm guardian-watch \
  --rpc "$RPC" \
  --treasury "$treasury" \
  --policy "$policy" \
  --guardian-keypair "$GUARDIAN_KP" \
  --threshold-bps 8000 \
  --once 2>&1) || die "guardian-watch failed: $watch_out"
printf '%s\n' "$watch_out" >&2
pause_sig=$(printf '%s' "$watch_out" | sed -n 's/.*pause confirmed: \([^ ]*\).*/\1/p')
[[ -n $pause_sig ]] || die "no pause signature in watcher output"

breathe
step "Owner withdraw while paused"
withdraw_json=$(
  retrying $CLI withdraw \
    --rpc "$RPC" \
    --wallet "$WALLET" \
    --out "$OUT" \
    --amount 0.001 \
    --mint SOL \
    --yes \
    --json
) || die "withdraw while paused failed"
withdraw_sig=$(printf '%s' "$withdraw_json" | jq_field signature)
[[ -n $withdraw_sig ]] || die "withdraw did not return a signature"

breathe
step "Cleanup: unpause"
retrying $CLI unpause --rpc "$RPC" --wallet "$WALLET" --out "$OUT" --yes --json >/dev/null ||
  die "unpause failed"

cat <<REPORT
### Guardian watch devnet proof

| | |
|---|---|
| treasury | \`$treasury\` |
| policy | \`$policy\` |
| session | \`$session\` |
| guardian | \`$GUARDIAN_ADDR\` |

| step | signature |
|---|---|
| guardian-watch pause | \`$pause_sig\` |
| owner withdraw (paused) | \`$withdraw_sig\` |

Explorer (devnet): https://explorer.solana.com/tx/<sig>?cluster=devnet
REPORT

printf '\n\033[32m✓ guardian devnet proof passed\033[0m\n' >&2
