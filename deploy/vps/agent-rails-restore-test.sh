#!/usr/bin/env bash
# Weekly: restore the newest nightly dump into a throwaway container of the same Postgres image
# and compare row counts. Root, because it starts a container (see agent-rails-supabase.service).
# Restores public only: a bare image has no GoTrue to migrate the auth schema to the dump's
# shape. The cutover import (README) restores everything into the real stack instead.
set -euo pipefail

image="$(sed -nE 's/^ *image: (supabase\/postgres:[^ ]+)$/\1/p' \
  /srv/agent-rails/supabase/docker-compose.agent-rails.yml)"
latest="$(ls -1d /var/backups/agent-rails/daily/*/ 2>/dev/null | sort | tail -1)"
[[ -n $image && -n $latest ]] || { echo "no image or no nightly dump to test" >&2; exit 1; }
name=agent-rails-restore-test

POSTGRES_PASSWORD="$(openssl rand -hex 16)"
export POSTGRES_PASSWORD PGPASSWORD=$POSTGRES_PASSWORD
export PGHOST=127.0.0.1 PGPORT=54399 PGUSER=postgres PGDATABASE=postgres
trap 'docker rm -f "$name" >/dev/null 2>&1 || true' EXIT
docker rm -f "$name" >/dev/null 2>&1 || true
# `-e NAME` with no value copies it from this environment, keeping the password out of argv.
docker run -d --name "$name" -e POSTGRES_PASSWORD -p 127.0.0.1:54399:5432 "$image" >/dev/null

# The image runs its init migrations before accepting TCP; give it up to three minutes.
for _ in $(seq 90); do
  pg_isready -q && psql -XAtc 'select 1' >/dev/null 2>&1 && break
  sleep 2
done
echo "testing $latest against $image"
DATA_PGUSER=supabase_admin agent-rails-db restore --public-only "$latest"
