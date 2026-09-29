#!/usr/bin/env bash
# The one way to drive the agent-rails compose project; agent-rails-supabase.service calls it,
# and so can a person with sudo (`sudo /srv/agent-rails/supabase/stack.sh ps`). A script rather
# than an Environment= variable in the unit: systemd splits unquoted assignments on spaces and
# expands $VAR inside ExecStart itself, which is how the first start ran an empty command.
#   stack.sh up       start everything but the tunnel and wait for health
#   stack.sh tunnel   start the tunnel if a token is present (after check-gateway.sh passed)
#   stack.sh down     stop everything, tunnel included; volumes stay
#   stack.sh <args>   any other docker compose subcommand (ps, logs -f auth, ...)
set -euo pipefail

cd /srv/agent-rails/supabase
compose() {
  docker compose -p agent-rails -f docker-compose.yml -f docker-compose.agent-rails.yml \
    --env-file /etc/agent-rails/supabase.env "$@"
}

case "${1:-}" in
  up) compose up -d --wait ;;
  tunnel)
    # No token yet (fresh bootstrap) means the stack runs private, which is a valid state.
    if grep -q '^TUNNEL_TOKEN=.' /etc/agent-rails/tunnel.env; then
      compose --profile tunnel up -d tunnel
    else
      echo "no tunnel token: stack stays on loopback"
    fi
    ;;
  down) compose --profile tunnel down ;;
  "") echo "usage: stack.sh up|tunnel|down|<compose args>" >&2; exit 2 ;;
  *) compose "$@" ;;
esac
