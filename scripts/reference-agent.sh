#!/usr/bin/env bash
#
# Reference-agent driver for Colosseum traction (P0-05).
#
# Makes small, real devnet payments through the same `pay` path the MCP server uses,
# logs every attempt to ASH_SINK-shaped JSONL, and prints verifiable metrics.
#
#   scripts/reference-agent.sh tick              # one settlement
#   scripts/reference-agent.sh deny              # one intentional on-chain denial
#   scripts/reference-agent.sh metrics           # audit export --verify + sink counts
#   scripts/reference-agent.sh loop              # tick forever (cron can call tick instead)
#
# Configuration: ~/.ash/reference-agent/reference-agent.env
# (copy from scripts/reference-agent.env.example). Never commit keys.

set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.." || exit 1

ENV_FILE="${REFERENCE_AGENT_ENV:-${HOME}/.ash/reference-agent/reference-agent.env}"
CLI_JS="packages/cli/dist/cli.js"
CLI_DEFAULT="node ${CLI_JS}"

die() {
  printf '\033[31m%s\033[0m\n' "$1" >&2
  exit 1
}

load_env() {
  [[ -f $ENV_FILE ]] || die "missing config — copy scripts/reference-agent.env.example to $ENV_FILE"
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  RPC_URL=${RPC_URL:-https://api.devnet.solana.com}
  OUT_DIR=${OUT_DIR:-${HOME}/.ash/reference-agent}
  TREASURY=${TREASURY:-}
  POLICY_NAME=${POLICY_NAME:-dashboard-demo}
  DESTINATION=${DESTINATION:-demo}
  AMOUNT=${AMOUNT:-0.00001}
  DENY_AMOUNT=${DENY_AMOUNT:-0.03}
  SINK=${SINK:-${OUT_DIR}/payments.jsonl}
  INTERVAL_SEC=${INTERVAL_SEC:-660}
  DENY_EVERY=${DENY_EVERY:-68}
  CLI=${CLI:-$CLI_DEFAULT}
  FEE_PAYER_KEYPAIR=${FEE_PAYER_KEYPAIR:-${WALLET:-$SESSION_KEYPAIR}}
  TICK_FILE=${OUT_DIR}/.tick-count

  [[ -f $CLI_JS ]] || die "CLI not built — run pnpm build (expected $CLI_JS)"
  [[ -n $TREASURY ]] || die "TREASURY is required in $ENV_FILE"
  [[ -n $SESSION ]] || die "SESSION is required — run session create (see docs/runbooks/reference-agent.md)"
  [[ -f ${SESSION_KEYPAIR:-} ]] || die "SESSION_KEYPAIR must point at the session keypair file"
  mkdir -p "$OUT_DIR"
  umask 077
}

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

append_sink() {
  local line=$1
  printf '%s\n' "$line" >>"$SINK"
}

pay_once() {
  local amount=$1
  local reference=$2
  local wallet=${WALLET:-$SESSION_KEYPAIR}
  set +e
  local out
  out=$(
    $CLI pay \
      --rpc "$RPC_URL" \
      --out "$OUT_DIR" \
      --treasury "$TREASURY" \
      --policy-name "$POLICY_NAME" \
      --session "$SESSION" \
      --session-keypair "$SESSION_KEYPAIR" \
      --fee-payer-keypair "$FEE_PAYER_KEYPAIR" \
      --wallet "$wallet" \
      --to "$DESTINATION" \
      --amount "$amount" \
      --mint SOL \
      --reference "$reference" \
      --yes \
      --json 2>/dev/null
  )
  local exit_code=$?
  set -e
  printf '%s' "$out"
  return "$exit_code"
}

record_from_pay_json() {
  local json=$1
  local amount=$2
  local reference=$3
  local ts
  ts=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  local outcome intent_id signature reason_code
  outcome=$(printf '%s' "$json" | jq_field outcome)
  intent_id=$(printf '%s' "$json" | jq_field intent_id)
  signature=$(printf '%s' "$json" | jq_field signature)
  reason_code=$(printf '%s' "$json" | jq_field reason_code)
  append_sink "$(node -e "
    const [ts, treasury, session, intent, outcome, label, amount, reference, signature, reason] =
      process.argv.slice(1);
    process.stdout.write(JSON.stringify({
      ts,
      treasury,
      session,
      ...(intent ? { intent } : {}),
      outcome,
      destination_label: label,
      mint: 'So11111111111111111111111111111111111111112',
      amount,
      reference,
      ...(signature ? { signature } : {}),
      ...(reason ? { reason_code: reason } : {}),
      source: 'reference-agent.sh',
    }));
  " "$ts" "$TREASURY" "$SESSION" "$intent_id" "$outcome" "$DESTINATION" "$amount" "$reference" "$signature" "$reason_code")"
}

cmd_tick() {
  local reference="ref-$(date -u +%Y%m%dT%H%M%SZ)-$RANDOM"
  local json
  json=$(pay_once "$AMOUNT" "$reference") || true
  [[ -n $json ]] || die "pay produced no output"
  record_from_pay_json "$json" "$AMOUNT" "$reference"
  local outcome
  outcome=$(printf '%s' "$json" | jq_field outcome)
  if [[ $outcome != "settled" ]]; then
    die "expected settled, got $outcome"
  fi
  printf 'settled %s (%s SOL)\n' "$reference" "$AMOUNT"
}

cmd_deny() {
  local reference="deny-$(date -u +%Y%m%dT%H%M%SZ)-$RANDOM"
  local json
  json=$(pay_once "$DENY_AMOUNT" "$reference") || true
  [[ -n $json ]] || die "pay produced no output"
  record_from_pay_json "$json" "$DENY_AMOUNT" "$reference"
  local outcome
  outcome=$(printf '%s' "$json" | jq_field outcome)
  if [[ $outcome != "denied" ]]; then
    die "expected denied, got $outcome"
  fi
  printf 'denied %s (%s SOL, over per-tx policy)\n' "$reference" "$DENY_AMOUNT"
}

cmd_metrics() {
  local audit_json
  audit_json=$(
    $CLI audit export \
      --rpc "$RPC_URL" \
      --out "$OUT_DIR" \
      --treasury "$TREASURY" \
      --policy-name "$POLICY_NAME" \
      --session "$SESSION" \
      --wallet "${WALLET:-$SESSION_KEYPAIR}" \
      --json 2>/dev/null
  ) || die "audit export failed"

  local on_chain_seq receipts_found verification_ok
  on_chain_seq=$(printf '%s' "$audit_json" | jq_field seq)
  receipts_found=$(printf '%s' "$audit_json" | jq_field receipts_found)
  verification_ok=$(printf '%s' "$audit_json" | jq_field verification.ok)

  local sink_settled sink_denied sink_indeterminate
  sink_settled=0
  sink_denied=0
  sink_indeterminate=0
  if [[ -f $SINK ]]; then
    read -r sink_settled sink_denied sink_indeterminate <<<"$(node -e "
      const fs = require('node:fs');
      const path = process.argv[1];
      let settled = 0, denied = 0, indeterminate = 0;
      if (!fs.existsSync(path)) process.exit(0);
      for (const line of fs.readFileSync(path, 'utf8').split('\n')) {
        if (!line.trim()) continue;
        try {
          const row = JSON.parse(line);
          if (row.outcome === 'settled') settled++;
          else if (row.outcome === 'denied') denied++;
          else if (row.outcome === 'indeterminate') indeterminate++;
        } catch {}
      }
      process.stdout.write([settled, denied, indeterminate].join(' '));
    " "$SINK")"
  fi

  cat <<METRICS
Reference agent metrics ($(date -u +%Y-%m-%dT%H:%M:%SZ) UTC)

| metric | value | source |
|---|---|---|
| payments settled (on-chain seq) | ${on_chain_seq:-?} | AgentSession.seq |
| receipts still present | ${receipts_found:-?} | IntentReceipt accounts |
| audit chain verified | ${verification_ok:-false} | audit export --verify |
| sink settled | ${sink_settled} | ${SINK} |
| sink denied | ${sink_denied} | ${SINK} |
| sink indeterminate | ${sink_indeterminate} | ${SINK} |

Treasury: ${TREASURY}
Session:  ${SESSION}
Explorer: https://explorer.solana.com/address/${TREASURY}?cluster=devnet

This is an in-house agent under our own policy. Numbers are fabricated traction,
but every settlement is a real devnet transaction you can verify independently.
METRICS
}

cmd_loop() {
  local count=0
  while :; do
    count=$((count + 1))
    if ((count % DENY_EVERY == 0)); then
      cmd_deny || printf 'deny tick failed (continuing)\n' >&2
    else
      cmd_tick || printf 'tick failed (continuing)\n' >&2
    fi
    printf '%s\n' "$count" >"$TICK_FILE"
    sleep "$INTERVAL_SEC"
  done
}

usage() {
  cat <<USAGE
usage: scripts/reference-agent.sh <tick|deny|metrics|loop>

Config: ${ENV_FILE}
USAGE
}

main() {
  local cmd=${1:-}
  [[ -n $cmd ]] || {
    usage
    exit 2
  }
  load_env
  case $cmd in
  tick) cmd_tick ;;
  deny) cmd_deny ;;
  metrics) cmd_metrics ;;
  loop) cmd_loop ;;
  *)
    usage
    exit 2
    ;;
  esac
}

main "$@"
