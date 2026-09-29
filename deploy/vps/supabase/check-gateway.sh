#!/usr/bin/env bash
# Probe the local gateway before the tunnel is allowed up. agent-rails-supabase.service runs this
# between `compose up` and starting the tunnel; a failure leaves the stack private.
#
# Why the empty-apikey probes: upstream's Envoy RBAC admits /pg/ (postgres-meta, arbitrary SQL as
# a superuser) and the /rest/v1/ root when `apikey` equals SERVICE_ROLE_KEY_ASYMMETRIC — which we
# leave empty. Whether an empty header value slips through that `exact: ''` depends on the Lua
# filter in front of it, and that is upstream's code; so it is asserted here, on every start,
# rather than assumed.
set -euo pipefail

env_file=/etc/agent-rails/supabase.env
gw=http://127.0.0.1:8000
anon="$(sed -n 's/^ANON_KEY=//p' "$env_file")"
fail=0

code() { curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$@"; }
expect() { # expect <label> <allowed-codes-regex> <curl args...>
  local label=$1 want=$2 got; shift 2
  got="$(code "$@")"
  if [[ $got =~ ^($want)$ ]]; then echo "ok    $label ($got)"; else echo "FAIL  $label ($got)"; fail=1; fi
}

expect "auth health with anon key"         200         -H "apikey: $anon" "$gw/auth/v1/health"
# 404 before the cutover import (no such table yet) still proves the key passed the gateway.
expect "rest with anon key"                '200|404'   -H "apikey: $anon" "$gw/rest/v1/accounts?select=id&limit=1"
expect "pg-meta without apikey"            '401|403'   "$gw/pg/tables"
expect "pg-meta with empty apikey"         '401|403'   -H "apikey;" "$gw/pg/tables"
expect "pg-meta with anon key"             '401|403'   -H "apikey: $anon" "$gw/pg/tables"
expect "rest root with empty apikey"       '401|403'   -H "apikey;" "$gw/rest/v1/"
expect "rest without apikey"               '401|403'   "$gw/rest/v1/accounts"
expect "studio without basic auth"         '401'       "$gw/"

exit $fail
