#!/usr/bin/env bash
# One-time setup for ADR-019 on the shared VPS (one machine with the ash stack). Run by a person
# with sudo, from a checkout of this directory:
#   sudo DOMAIN=console.ash.app.br API_DOMAIN=console-api.ash.app.br ./bootstrap.sh
# Idempotent: re-running rewrites units, scripts and the compose overlay, and leaves env files,
# generated secrets, keys and data alone.
#
# What it owns (agreed split with ash): /srv/agent-rails, /etc/agent-rails, /var/lib/agent-rails,
# /var/backups/agent-rails, and units named agent-rails-*. It changes nothing host-wide: no ufw
# rule (traffic arrives through our own Cloudflare tunnel), no port 80 (ash's certbot renews in
# standalone mode there), no sshd or docker daemon setting.
set -euo pipefail

: "${DOMAIN:?set DOMAIN, e.g. console.ash.app.br}"
: "${API_DOMAIN:?set API_DOMAIN, e.g. console-api.ash.app.br (one label under the zone)}"
[[ $EUID -eq 0 ]] || { echo "run with sudo" >&2; exit 1; }
docker compose version >/dev/null || { echo "docker compose plugin missing" >&2; exit 1; }

here="$(cd "$(dirname "$0")" && pwd)"
stack=/srv/agent-rails/supabase
# Published at docs.github.com "GitHub's SSH key fingerprints". Pinned so the first fetch is
# not trust-on-first-use.
github_ed25519="SHA256:+DiY3wvvV6TuJJhbpZisF/zLDA0zPMSvHdkr4UvCOqU"
# apt.postgresql.org signing key, as published on postgresql.org/download/linux/ubuntu.
pgdg_fpr="B97B0AFCAA1A47F044F244A07FCC7D46ACCC4CF8"

# --- packages ---------------------------------------------------------------------------------
# pg_dump must be at least the server's major (17); jammy ships 14, so PGDG supplies the client.
if ! command -v pg_dump >/dev/null || [[ $(pg_dump --version | grep -oE '[0-9]+' | head -1) -lt 17 ]]; then
  key=/usr/share/keyrings/pgdg.gpg
  curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc | gpg --dearmor -o "$key.tmp"
  got="$(gpg --show-keys --with-colons "$key.tmp" | awk -F: '$1 == "fpr" { print $10; exit }')"
  [[ $got == "$pgdg_fpr" ]] || { rm -f "$key.tmp"; echo "PGDG key mismatch: $got" >&2; exit 1; }
  mv "$key.tmp" "$key"
  echo "deb [signed-by=$key] https://apt.postgresql.org/pub/repos/apt $(lsb_release -cs)-pgdg main" \
    >/etc/apt/sources.list.d/pgdg.list
  apt-get update
fi
# needrestart list-only: a shared box, so installing never restarts host services on its own.
NEEDRESTART_MODE=l apt-get install -y postgresql-client-17 age openssl curl

# --- service user -----------------------------------------------------------------------------
# No sudo, no docker group (docker is root-equivalent), no SSH login (not in AllowUsers).
if ! id agent-rails &>/dev/null; then
  useradd --system --create-home --home-dir /var/lib/agent-rails --shell /usr/sbin/nologin agent-rails
fi
if id -nG agent-rails | grep -qwE 'docker|sudo'; then
  echo "agent-rails must not be in the docker or sudo group" >&2; exit 1
fi

# --- directories --------------------------------------------------------------------------------
# /srv/agent-rails stays root-owned: the owner of a directory can rename entries in it, so an
# agent-rails-owned parent would let the dashboard's user swap the compose files root runs.
install -d -m 755 -o root -g root /srv/agent-rails
install -d -m 755 -o agent-rails -g agent-rails /srv/agent-rails/releases /srv/agent-rails/repo.git
install -d -m 750 -o root -g root "$stack"
install -d -m 750 -o agent-rails -g agent-rails /var/lib/agent-rails
install -d -m 700 -o agent-rails -g agent-rails /var/lib/agent-rails/.ssh
install -d -m 750 -o root -g agent-rails /var/backups/agent-rails
install -d -m 700 -o agent-rails -g agent-rails /var/backups/agent-rails/daily /var/backups/agent-rails/offsite
install -d -m 750 -o root -g agent-rails /etc/agent-rails

# --- read-only deploy key ---------------------------------------------------------------------
# Generated here so the private half never leaves the box. The repo is private; an admin
# registers the public half as a read-only deploy key.
key=/var/lib/agent-rails/.ssh/id_ed25519
if [[ ! -f $key ]]; then
  sudo -u agent-rails ssh-keygen -q -t ed25519 -N "" -C "agent-rails@vps" -f "$key"
fi
known=/var/lib/agent-rails/.ssh/known_hosts
if ! sudo -u agent-rails ssh-keygen -F github.com -f "$known" &>/dev/null; then
  scanned="$(ssh-keyscan -t ed25519 github.com 2>/dev/null)"
  got="$(ssh-keygen -lf - <<<"$scanned" | awk '{print $2}')"
  [[ $got == "$github_ed25519" ]] || { echo "github.com host key mismatch: $got" >&2; exit 1; }
  sudo -u agent-rails tee -a "$known" >/dev/null <<<"$scanned"
fi

# --- supabase stack files ---------------------------------------------------------------------
"$here/supabase/fetch-upstream.sh" "$stack"
install -m 640 "$here/supabase/docker-compose.agent-rails.yml" "$stack/"
install -m 750 "$here/supabase/check-gateway.sh" "$here/supabase/stack.sh" "$stack/"

# --- secrets and env files --------------------------------------------------------------------
# Written once. Values reach files through stdin and sed on this box, never argv of a long-lived
# process or anything that leaves it.
env_file=/etc/agent-rails/supabase.env
if [[ ! -f $env_file ]]; then
  keys="$(sh "$stack/utils/generate-keys.sh" </dev/null)"
  val() { sed -n "s/^$1=//p" <<<"$keys"; }
  tmp="$(mktemp /etc/agent-rails/.supabase.env.XXXXXX)"
  sed -e "s#__DOMAIN__#$DOMAIN#g" -e "s#__API_DOMAIN__#$API_DOMAIN#g" \
    "$here/supabase/supabase.env.template" >"$tmp"
  for k in POSTGRES_PASSWORD JWT_SECRET ANON_KEY SERVICE_ROLE_KEY DASHBOARD_PASSWORD \
           SECRET_KEY_BASE VAULT_ENC_KEY PG_META_CRYPTO_KEY; do
    v="$(val "$k")"
    [[ -n $v ]] || { rm -f "$tmp"; echo "generate-keys.sh gave no $k" >&2; exit 1; }
    sed -i "s|^$k=__GENERATED__\$|$k=$v|" "$tmp"
  done
  # Anchored to a value: the template's own comments mention the placeholder.
  ! grep -qE '^[A-Z_]+=__GENERATED__$' "$tmp" || { rm -f "$tmp"; echo "unfilled secret in template" >&2; exit 1; }
  chmod 600 "$tmp" && mv "$tmp" "$env_file"
fi
anon="$(sed -n 's/^ANON_KEY=//p' "$env_file")"
service="$(sed -n 's/^SERVICE_ROLE_KEY=//p' "$env_file")"

if [[ ! -f /etc/agent-rails/tunnel.env ]]; then
  install -m 600 "$here/tunnel.env.example" /etc/agent-rails/tunnel.env
fi
if [[ ! -f /etc/agent-rails/dashboard.public.env ]]; then
  sed -e "s#__API_DOMAIN__#$API_DOMAIN#g" -e "s#^NEXT_PUBLIC_SUPABASE_ANON_KEY=.*#NEXT_PUBLIC_SUPABASE_ANON_KEY=$anon#" \
    "$here/dashboard.public.env.example" >/etc/agent-rails/dashboard.public.env
  chown root:agent-rails /etc/agent-rails/dashboard.public.env && chmod 640 /etc/agent-rails/dashboard.public.env
fi
if [[ ! -f /etc/agent-rails/dashboard.env ]]; then
  install -m 600 /dev/null /etc/agent-rails/dashboard.env
  sed -e "s#__DOMAIN__#$DOMAIN#g" -e "s#__API_DOMAIN__#$API_DOMAIN#g" \
    -e "s#^SUPABASE_SERVICE_ROLE_KEY=.*#SUPABASE_SERVICE_ROLE_KEY=$service#" \
    "$here/dashboard.env.example" >/etc/agent-rails/dashboard.env
fi
if [[ ! -f /etc/agent-rails/backup.env ]]; then
  install -m 640 -o root -g agent-rails /dev/null /etc/agent-rails/backup.env
  sed "s#^PGPASSWORD=.*#PGPASSWORD=$(openssl rand -hex 24)#" "$here/backup.env.example" \
    >/etc/agent-rails/backup.env
fi

# --- scripts and units ------------------------------------------------------------------------
install -m 755 "$here/agent-rails-db.sh" /usr/local/bin/agent-rails-db
install -m 755 "$here/agent-rails-backup.sh" /usr/local/bin/agent-rails-backup
install -m 700 "$here/agent-rails-restore-test.sh" /usr/local/sbin/agent-rails-restore-test
install -m 700 "$here/deploy.sh" /usr/local/sbin/agent-rails-deploy
for unit in agent-rails-supabase.service agent-rails-dashboard.service \
            agent-rails-backup.service agent-rails-backup.timer \
            agent-rails-restore-test.service agent-rails-restore-test.timer; do
  install -m 644 "$here/$unit" /etc/systemd/system/
done
systemctl daemon-reload
systemctl enable agent-rails-supabase agent-rails-dashboard
# --now: a timer that is only enabled waits for the next boot, and the backup would never run.
systemctl enable --now agent-rails-backup.timer agent-rails-restore-test.timer

# --- start the stack, then the backup role ----------------------------------------------------
systemctl restart agent-rails-supabase
# Read-only, RLS-bypassing, and not the superuser: this password sits in a file the dashboard's
# user can read. The SQL goes through stdin so the password is never in docker's argv.
backup_pw="$(sed -n 's/^PGPASSWORD=//p' /etc/agent-rails/backup.env)"
docker exec -i agent-rails-supabase-db psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 -q <<SQL
do \$\$ begin
  if not exists (select from pg_roles where rolname = 'agent_rails_backup') then
    create role agent_rails_backup;
  end if;
end \$\$;
alter role agent_rails_backup with login bypassrls password '$backup_pw';
grant pg_read_all_data to agent_rails_backup;
SQL

missing=()
grep -q '^TUNNEL_TOKEN=.' /etc/agent-rails/tunnel.env || missing+=("TUNNEL_TOKEN in /etc/agent-rails/tunnel.env (from Lucas)")
grep -qE '^age1[0-9a-z]{58}$' /etc/agent-rails/backup.age-recipients 2>/dev/null ||
  missing+=("/etc/agent-rails/backup.age-recipients: our age public key (age1...), one per line")
grep -q '^GOOGLE_ENABLED=true' "$env_file" ||
  missing+=("GOOGLE_CLIENT_ID, GOOGLE_SECRET and GOOGLE_ENABLED=true in $env_file")

cat <<EOF

Bootstrap done; the Supabase stack is up on loopback and passed check-gateway.sh.
Remaining, in order (sudoedit for every file — keep secrets out of argv and shell history):
  1. Register as a READ-ONLY deploy key on wayside-labs/agent-rails:
     $(cat "$key.pub")
$(for m in "${missing[@]}"; do echo "  -  $m"; done)
  2. sudo systemctl restart agent-rails-supabase     (picks up the tunnel token and Google keys)
  3. sudo agent-rails-deploy main
  4. The cutover import from hosted Supabase: README.md, "Cutover".
EOF
