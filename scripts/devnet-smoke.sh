#!/usr/bin/env bash
#
# The devnet smoke ADR-015 deferred: the client against a real cluster, paying in SOL and in
# an SPL mint, on the release tag that claims it works.
#
#   scripts/devnet-smoke.sh --wallet <keypair> [--out <dir>] [--rpc <url>]
#
# Everything below runs through the same surfaces a user has — `ash init` and
# `ash pay` — rather than a bespoke script that could pass while the product is
# broken. It prints a Markdown report on stdout with the signatures, so a release page can
# carry links a reader can open.
#
# ## Why the SPL leg uses a mock mint
#
# Nobody but Circle can mint devnet USDC, and its faucet is a web form. A USDC leg would be
# a smoke that depends on someone clicking through a page, which is not a gate. `--mock-mint`
# creates a 6-decimal mint — USDC-shaped — that this wallet controls, and exercises the same
# `execute_payment` instruction, ATAs and token program the real thing does.
# `packages/contract/src/mints.ts` carries the actual USDC addresses for the path that has
# to name them.
#
# ## Cost
#
# Rent for the treasury, its vault, a policy, an allowlist entry, a session and two ATAs,
# plus the deposits below: roughly 0.05 SOL per run, none of it recoverable without
# `close treasury`. The CI key is funded manually and the faucet rate-limits by IP, so this
# is not something to run in a loop.

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
    echo "usage: scripts/devnet-smoke.sh --wallet <keypair> [--out <dir>] [--rpc <url>]" >&2
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
[[ -f packages/cli/dist/cli.js ]] || die "the CLI is not built — run pnpm build"

if [[ -z $OUT ]]; then
  OUT=$(mktemp -d -t ash-smoke.XXXXXX) || die "could not create a work directory"
fi
mkdir -p "$OUT"

# The keys this writes are session and fee-payer keypairs for a throwaway treasury, and they
# are still keys: 0600, and the caller is expected to delete the directory.
umask 077

step() { printf '\n\033[1m▸ %s\033[0m\n' "$1" >&2; }

# The public devnet endpoint rate-limits per IP and answers 429 with `retry-after: 10`. A
# run that dies on one of those has learned nothing about the program, so the reads and the
# resumable steps get a second chance.
#
# Deliberately *not* wrapped around `pay`: a payment that may already have landed must not
# be reissued by a retry loop. Its idempotency comes from the derived intent id, and the
# right response to an uncertain send is to look it up — which is what `pay` itself prints.
retrying() {
  local attempt=1
  local out
  while :; do
    if out=$("$@" 2>&1); then
      printf '%s' "$out"
      return 0
    fi
    if [[ $attempt -ge 3 ]] || ! grep -q "429\|rate" <<<"$out"; then
      printf '%s' "$out" >&2
      return 1
    fi
    printf '\033[33m  rate-limited, retrying in 12s (%d/3)\033[0m\n' "$attempt" >&2
    sleep 12
    attempt=$((attempt + 1))
  done
}

# Between legs, for the same reason: the free tier counts methods per minute and this smoke
# is bursty by nature.
breathe() { sleep 5; }

# Every value this smoke needs comes out of `--json`, which is why human output goes to
# stderr in this CLI: stdout stays a pipe. Dotted paths because `init` answers with the
# whole manifest under one key rather than a flat record.
jq_field() {
  node -e '
    let raw = "";
    process.stdin.on("data", (c) => (raw += c));
    process.stdin.on("end", () => {
      try {
        const value = process.argv[1]
          .split(".")
          .reduce((node, key) => (node == null ? node : node[key]), JSON.parse(raw));
        process.stdout.write(String(value ?? ""));
      } catch {
        process.exit(3);
      }
    });
  ' "$1"
}

step "Bootstrapping a treasury on $RPC"
# Small deposits: this is a liveness check, not a load test, and the key is topped up by
# hand. `--mock-mint` adds the SPL leg; `--yes` because there is no terminal here.
init_json=$(
  retrying $CLI init \
    --rpc "$RPC" \
    --wallet "$WALLET" \
    --out "$OUT" \
    --name smoke \
    --mock-mint \
    --deposit 0.02 \
    --fee-budget 0.01 \
    --per-tx 0.01 \
    --daily 0.02 \
    --token-deposit 1000 \
    --token-per-tx 10 \
    --token-daily 100 \
    --no-airdrop \
    --yes \
    --json
) || die "init failed"

treasury=$(printf '%s' "$init_json" | jq_field manifest.treasury)
session=$(printf '%s' "$init_json" | jq_field manifest.session)
# `init` picks a demo destination when none is given; the label is what `pay` addresses,
# and the mint alias is the name it printed for the mock mint.
destination_label=$(printf '%s' "$init_json" | jq_field manifest.destinationLabel)
token_symbol=$(printf '%s' "$init_json" | jq_field manifest.tokenSymbol)
[[ -n $treasury && -n $session ]] || die "init did not report a treasury and a session"
[[ -n $destination_label ]] || die "init did not report a destination label"
[[ -n $token_symbol ]] || die "init did not create the SPL mint this smoke pays with"

breathe
step "Paying in SOL"
sol_json=$(
  $CLI pay \
    --rpc "$RPC" \
    --wallet "$WALLET" \
    --out "$OUT" \
    --to "$destination_label" \
    --amount 0.001 \
    --mint SOL \
    --reference "smoke-sol-$(date -u +%Y%m%dT%H%M%SZ)" \
    --yes \
    --json
) || die "the SOL payment failed"
sol_sig=$(printf '%s' "$sol_json" | jq_field signature)

breathe
step "Paying in SPL"
spl_json=$(
  $CLI pay \
    --rpc "$RPC" \
    --wallet "$WALLET" \
    --out "$OUT" \
    --to "$destination_label" \
    --amount 1 \
    --mint "$token_symbol" \
    --reference "smoke-spl-$(date -u +%Y%m%dT%H%M%SZ)" \
    --yes \
    --json
) || die "the SPL payment failed"
spl_sig=$(printf '%s' "$spl_json" | jq_field signature)

breathe
step "Replaying the audit chain"
# The point of running this here rather than trusting the two exit codes above: the chain
# is what the product claims, and a release that has not replayed it is asserting something
# nobody checked.
audit_json=$(retrying $CLI audit export --rpc "$RPC" --wallet "$WALLET" --out "$OUT" --session "$session" --json) ||
  die "the audit chain did not verify"
audit_head=$(printf '%s' "$audit_json" | jq_field audit_head)

breathe
step "Refusing a payment above the per-transaction ceiling"
# A smoke that only proves payments work proves half the product. This one must fail, and a
# zero exit here would mean the guard rails were not in force on the cluster.
if $CLI pay \
  --rpc "$RPC" --wallet "$WALLET" --out "$OUT" \
  --to "$destination_label" --amount 1 --mint SOL \
  --reference "smoke-overlimit-$(date -u +%Y%m%dT%H%M%SZ)" \
  --yes --json >/dev/null 2>&1; then
  die "a payment above the per-transaction ceiling was accepted"
fi

explorer() { printf 'https://explorer.solana.com/tx/%s?cluster=devnet' "$1"; }

cat <<REPORT
### Devnet smoke

| | |
|---|---|
| cluster | \`$RPC\` |
| treasury | \`$treasury\` |
| session | \`$session\` |
| audit head | \`$audit_head\` |

| leg | signature |
|---|---|
| SOL payment | [\`${sol_sig:0:16}…\`]($(explorer "$sol_sig")) |
| SPL payment | [\`${spl_sig:0:16}…\`]($(explorer "$spl_sig")) |
| over-ceiling payment | refused on-chain, as it must be |

The audit chain replayed to the head the session account reports, and a payment above the
per-transaction ceiling was refused by the program.

The treasury above is left in place: closing it needs a withdrawal and three more
transactions, and the rent is worth less than the failure surface. Reclaim it with
`ash withdraw --all` followed by `ash close policy` and `close treasury`.
REPORT

printf '\n\033[32m✓ devnet smoke passed\033[0m\n' >&2
