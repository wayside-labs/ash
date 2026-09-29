#!/usr/bin/env bash
# One-time setup for ADR-019 stage 1. Run on the VPS by a person with sudo, from a copy of
# this directory:  sudo DOMAIN=app.example.com ./bootstrap.sh
# Idempotent: re-running it rewrites the Caddyfile and unit and leaves env files and keys alone.
set -euo pipefail

: "${DOMAIN:?set DOMAIN to the dashboard hostname}"
[[ $EUID -eq 0 ]] || { echo "run with sudo" >&2; exit 1; }

here="$(cd "$(dirname "$0")" && pwd)"
repo_url="git@github.com:wayside-labs/agent-rails.git"
# Published at docs.github.com "GitHub's SSH key fingerprints". Pinned so the first fetch is
# not trust-on-first-use.
github_ed25519="SHA256:+DiY3wvvV6TuJJhbpZisF/zLDA0zPMSvHdkr4UvCOqU"

# --- service user -------------------------------------------------------------------------
# No sudo, no password, no SSH login (not in AllowUsers). People deploy through deploy.sh.
if ! id deploy &>/dev/null; then
  useradd --system --create-home --home-dir /var/lib/agent-rails --shell /usr/sbin/nologin deploy
fi
install -d -m 755 -o deploy -g deploy /srv/agent-rails /srv/agent-rails/releases
install -d -m 700 -o deploy -g deploy /var/lib/agent-rails/.ssh

# --- read-only deploy key -----------------------------------------------------------------
# Generated here so the private half never leaves the box. The repo is private; an admin
# registers the public half as a read-only deploy key.
key=/var/lib/agent-rails/.ssh/id_ed25519
if [[ ! -f $key ]]; then
  sudo -u deploy ssh-keygen -q -t ed25519 -N "" -C "deploy@agent-rails-vps" -f "$key"
fi
known=/var/lib/agent-rails/.ssh/known_hosts
if ! sudo -u deploy ssh-keygen -F github.com -f "$known" &>/dev/null; then
  scanned="$(ssh-keyscan -t ed25519 github.com 2>/dev/null)"
  got="$(ssh-keygen -lf - <<<"$scanned" | awk '{print $2}')"
  [[ $got == "$github_ed25519" ]] || { echo "github.com host key mismatch: $got" >&2; exit 1; }
  sudo -u deploy tee -a "$known" >/dev/null <<<"$scanned"
fi

# --- env files ----------------------------------------------------------------------------
install -d -m 750 -o root -g deploy /etc/agent-rails
if [[ ! -f /etc/agent-rails/dashboard.public.env ]]; then
  install -m 640 -o root -g deploy "$here/dashboard.public.env.example" /etc/agent-rails/dashboard.public.env
fi
if [[ ! -f /etc/agent-rails/dashboard.env ]]; then
  install -m 600 -o root -g root "$here/dashboard.env.example" /etc/agent-rails/dashboard.env
  sed -i "s#https://<domain>#https://$DOMAIN#" /etc/agent-rails/dashboard.env
fi

# --- Caddy --------------------------------------------------------------------------------
if ! command -v caddy &>/dev/null; then
  apt-get install -y debian-keyring debian-archive-keyring apt-transport-https curl gpg
  curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/gpg.key \
    | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt \
    > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update
  apt-get install -y caddy
fi
sed "s#__DOMAIN__#$DOMAIN#" "$here/Caddyfile" > /etc/caddy/Caddyfile
caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
ufw allow 80,443/tcp

# --- dashboard service --------------------------------------------------------------------
install -m 644 "$here/agent-rails-dashboard.service" /etc/systemd/system/
install -m 755 "$here/deploy.sh" /usr/local/sbin/agent-rails-deploy
systemctl daemon-reload
systemctl enable agent-rails-dashboard
systemctl reload-or-restart caddy

cat <<EOF

Bootstrap done. Remaining, in order:
  1. Register this as a READ-ONLY deploy key on wayside-labs/agent-rails:
     $(cat "$key.pub")
  2. Fill /etc/agent-rails/dashboard.public.env and /etc/agent-rails/dashboard.env
     (sudoedit — keep the secrets out of argv and shell history).
  3. sudo agent-rails-deploy main
EOF
