#!/usr/bin/env bash
# Adds the demo vendors (and optionally the scripted buyer) to a box bootstrap.sh already set
# up. Run from a copy of deploy/vps:
#   sudo ./vendors/install.sh
# Idempotent: env files and keys are left alone once they exist.
#
# Public on purpose: an agent on a laptop pays the VPS vendors the same way a customer's agent
# would pay a real one. Invoices are free to create, so each vendor caps open ones. They are
# reached through the agent-rails tunnel, one hostname per vendor, because cloudflared routes
# by hostname and path but cannot strip a path prefix — and each vendor serves from `/`:
#   vendor-oracle.ash.app.br  → http://127.0.0.1:4101
#   vendor-notary.ash.app.br  → http://127.0.0.1:4102
#   vendor-compute.ash.app.br → http://127.0.0.1:4103
# (one label under the zone, so Universal SSL covers them; set in ash's Cloudflare account).
set -euo pipefail

[[ $EUID -eq 0 ]] || { echo "run with sudo" >&2; exit 1; }
id agent-rails &>/dev/null || { echo "run bootstrap.sh first" >&2; exit 1; }
here="$(cd "$(dirname "$0")" && pwd)"

install -d -m 750 -o agent-rails -g agent-rails /var/lib/agent-rails/vendors /var/lib/agent-rails/buyer
for f in vendors buyer; do
  if [[ ! -f /etc/agent-rails/$f.env ]]; then
    install -m 640 -o root -g agent-rails "$here/$f.env.example" "/etc/agent-rails/$f.env"
  fi
done

install -m 644 "$here/agent-rails-vendor@.service" "$here/agent-rails-buyer@.service" \
  "$here/agent-rails-buyer@.timer" /etc/systemd/system/
systemctl daemon-reload

cat <<MSG

Vendors installed. Remaining, in order:
  1. sudoedit /etc/agent-rails/vendors.env   (ORACLE_PAY_TO, NOTARY_PAY_TO, COMPUTE_PAY_TO)
  2. deploy/vps/push-deploy.sh <branch>      (from a laptop; builds packages/vendors and the CLI)
  3. sudo systemctl enable --now agent-rails-vendor@{oracle,notary,compute}
  4. Ask for the three vendor-*.ash.app.br hostnames on the agent-rails tunnel (see the header
     of this script), then: curl https://vendor-oracle.ash.app.br/health
Optional scripted buyer:
  5. copy the buyer's session key to /var/lib/agent-rails/buyer/session.json (agent-rails, 0600)
  6. sudoedit /etc/agent-rails/buyer.env
  7. sudo systemctl start agent-rails-buyer@oracle   (one run; read journalctl)
  8. sudo systemctl enable --now agent-rails-buyer@{oracle,notary,compute}.timer
MSG
