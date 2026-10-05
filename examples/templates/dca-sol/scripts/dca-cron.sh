#!/usr/bin/env bash
#
# Scheduled DCA outflow through ASH. Cron decides *when*; the on-chain policy decides
# *whether*. No model in the loop.
#
#   dca-cron.sh tick      # pay this period's slice to the swap desk (safe to run twice)
#   dca-cron.sh status    # policy headroom + this template's sink counts
#
# Required configuration (sourced from $DCA_ENV, default ~/.ash/dca/dca.env; copy it
# from examples/templates/dca-sol/dca.env.example):
#
#   ASH_RPC    RPC endpoint
#   TREASURY           Treasury PDA
#   POLICY_NAME        Policy name the treasury's PDA is derived from
#   SESSION            AgentSession PDA the cron pays with
#   SESSION_KEYPAIR    0600 keypair file `session create` wrote — signs the transfer
#   FEE_PAYER_KEYPAIR  Pays transaction fees; also passed as --wallet
#   MINT               Mint address of the stablecoin being spent
#   DESTINATION        Allowlisted label of the swap desk
#   AMOUNT             Human units per period
#   CADENCE            daily | weekly | hourly
#
# SDK equivalent: `buildPaymentIntent` + `executePayment` from @ash/sdk with
# `deriveIntentId` over the same reference — that is what `ash pay` does.
#
# No keypair ever lives in this repo; every key path points under $OUT_DIR.

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
ENV_FILE="${DCA_ENV:-${HOME}/.ash/dca/dca.env}"
CLI_JS="${REPO_ROOT}/packages/cli/dist/cli.js"

die() {
  printf 'dca-cron: %s\n' "$1" >&2
  exit "${2:-1}"
}

load_env() {
  [[ -f $ENV_FILE ]] || die "missing $ENV_FILE — copy examples/templates/dca-sol/dca.env.example"
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  # Env files written before the ASH rename say AGENT_RAILS_*; prefer ASH_*, fall back to the old name.
  for legacy in $(compgen -v AGENT_RAILS_); do
    new="ASH_${legacy#AGENT_RAILS_}"
    [[ -n ${!new:-} ]] || export "$new=${!legacy}"
  done
  ASH_RPC=${ASH_RPC:-https://api.devnet.solana.com}
  OUT_DIR=${OUT_DIR:-${HOME}/.ash/dca}
  DESTINATION=${DESTINATION:-dca-desk}
  CADENCE=${CADENCE:-daily}
  REFERENCE_PREFIX=${REFERENCE_PREFIX:-dca-usdc}
  SINK=${SINK:-${OUT_DIR}/dca.jsonl}
  WALLET=${WALLET:-${FEE_PAYER_KEYPAIR:-}}
  if [[ -z ${CLI:-} ]]; then
    [[ -f $CLI_JS ]] || die "CLI not built — run pnpm build (expected $CLI_JS)"
    CLI="node ${CLI_JS}"
  fi

  local missing=()
  for var in TREASURY POLICY_NAME SESSION SESSION_KEYPAIR FEE_PAYER_KEYPAIR MINT AMOUNT; do
    [[ -n ${!var:-} ]] || missing+=("$var")
  done
  ((${#missing[@]} == 0)) || die "unset in $ENV_FILE: ${missing[*]}"
  [[ -f $SESSION_KEYPAIR ]] || die "SESSION_KEYPAIR not found: $SESSION_KEYPAIR"
  [[ -f $FEE_PAYER_KEYPAIR ]] || die "FEE_PAYER_KEYPAIR not found: $FEE_PAYER_KEYPAIR"
  [[ $CADENCE =~ ^(daily|weekly|hourly)$ ]] ||
    die "CADENCE must be daily, weekly or hourly, got $CADENCE"
  mkdir -p "$OUT_DIR"
  umask 077
}

# The period is part of the reference, and the reference is part of the intent id. Two runs
# in the same period derive the same id, and the second is refused by the receipt that the
# first one created — double-firing cron cannot buy twice.
period_key() {
  case $CADENCE in
  daily) date -u +%Y-%m-%d ;;
  weekly) date -u +%G-W%V ;;
  hourly) date -u +%Y-%m-%dT%H ;;
  esac
}

json_field() {
  node -e '
    let raw = "";
    process.stdin.on("data", (c) => (raw += c));
    process.stdin.on("end", () => {
      try {
        const value = JSON.parse(raw)[process.argv[1]];
        process.stdout.write(value == null ? "" : String(value));
      } catch {
        process.exit(3);
      }
    });
  ' "$1"
}

record() {
  local outcome=$1 reference=$2 json=$3
  node -e '
    const [ts, outcome, reference, amount, mint, destination, raw] = process.argv.slice(1);
    let result = {};
    try { result = JSON.parse(raw); } catch {}
    process.stdout.write(`${JSON.stringify({
      ts, outcome, reference, amount, mint, destination_label: destination,
      ...(result.intent_id ? { intent: result.intent_id } : {}),
      ...(result.signature ? { signature: result.signature } : {}),
      ...(result.reason_code ? { reason_code: result.reason_code } : {}),
      source: "dca-cron.sh",
    })}\n`);
  ' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$outcome" "$reference" "$AMOUNT" "$MINT" \
    "$DESTINATION" "$json" >>"$SINK"
}

alert() {
  [[ -n ${ALERT_WEBHOOK_URL:-} ]] || return 0
  curl -fsS -m 10 -H 'Content-Type: application/json' \
    -d "{\"text\":\"dca-cron: $1\"}" "$ALERT_WEBHOOK_URL" >/dev/null || true
}

# Shared by the dry run and the real payment: the flags that derive the intent id.
pay() {
  $CLI pay \
    --rpc "$ASH_RPC" \
    --out "$OUT_DIR" \
    --wallet "$WALLET" \
    --treasury "$TREASURY" \
    --policy-name "$POLICY_NAME" \
    --session "$SESSION" \
    --session-keypair "$SESSION_KEYPAIR" \
    --fee-payer-keypair "$FEE_PAYER_KEYPAIR" \
    --to "$DESTINATION" \
    --amount "$AMOUNT" \
    --mint "$MINT" \
    --yes \
    --json \
    "$@" 2>/dev/null
}

# Does a receipt for this intent exist? The receipt is the program's own record that the
# payment settled, so this is the lookup the CLI tells an operator to do before any retry.
receipt_exists() {
  local intent_id=$1
  $CLI audit export \
    --rpc "$ASH_RPC" \
    --out "$OUT_DIR" \
    --wallet "$WALLET" \
    --treasury "$TREASURY" \
    --policy-name "$POLICY_NAME" \
    --session "$SESSION" \
    --format jsonl \
    --no-verify 2>/dev/null | grep -q "\"intent_id\":\"${intent_id}\""
}

cmd_tick() {
  local reference out code outcome reason intent_id already
  reference="${REFERENCE_PREFIX}/$(period_key)"

  # `pay` looks the receipt up before sending, so a second tick in the same period comes
  # back `settled` with `already_settled: true` and sends nothing.
  out=$(pay --reference "$reference")
  code=$?
  [[ -n $out ]] || die "pay produced no output (exit $code) — run it by hand without --json"
  outcome=$(printf '%s' "$out" | json_field outcome)
  reason=$(printf '%s' "$out" | json_field reason_code)
  intent_id=$(printf '%s' "$out" | json_field intent_id)
  already=$(printf '%s' "$out" | json_field already_settled)

  if [[ $outcome == "settled" ]]; then
    if [[ $already == "true" ]]; then
      record already-settled "$reference" "$out"
      printf 'already settled %s (%s)\n' "$reference" "$intent_id"
    else
      record settled "$reference" "$out"
      printf 'settled %s: %s to %s\n' "$reference" "$AMOUNT" "$DESTINATION"
    fi
    return 0
  fi

  if ((code == 75)); then
    # Indeterminate: the transfer may exist. Do not retry now. The next tick in the same
    # period re-derives the same intent and either finds the receipt or pays exactly once.
    record indeterminate "$reference" "$out"
    alert "indeterminate $reference ($intent_id) — the next tick this period will resolve it"
    die "indeterminate $reference — not retrying; the next tick in this period is safe" 75
  fi

  # A concurrent tick can settle this period between `pay`'s lookup and its send. The loser
  # is refused when the receipt is created, and that refusal carries no "already settled"
  # reason code — so ask the receipts instead of trusting the denial.
  if [[ -n $intent_id ]] && receipt_exists "$intent_id"; then
    record already-settled "$reference" "$out"
    printf 'already settled %s (%s)\n' "$reference" "$intent_id"
    return 0
  fi

  record "${outcome:-error}" "$reference" "$out"
  alert "$outcome $reference (${reason:-no reason code})"
  die "$outcome $reference (${reason:-no reason code})"
}

cmd_status() {
  $CLI policy show \
    --rpc "$ASH_RPC" \
    --out "$OUT_DIR" \
    --wallet "$WALLET" \
    --treasury "$TREASURY" \
    --policy-name "$POLICY_NAME" || die "policy show failed"
  [[ -f $SINK ]] || return 0
  printf '\nSink %s\n' "$SINK"
  node -e '
    const counts = {};
    for (const line of require("node:fs").readFileSync(process.argv[1], "utf8").split("\n")) {
      if (!line.trim()) continue;
      try { const row = JSON.parse(line); counts[row.outcome] = (counts[row.outcome] ?? 0) + 1; } catch {}
    }
    for (const [outcome, n] of Object.entries(counts)) console.log(`  ${outcome}: ${n}`);
  ' "$SINK"
}

main() {
  local cmd=${1:-tick}
  load_env
  case $cmd in
  tick) cmd_tick ;;
  status) cmd_status ;;
  *) die "usage: dca-cron.sh [tick|status]" 2 ;;
  esac
}

main "$@"
