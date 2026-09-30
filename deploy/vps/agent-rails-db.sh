#!/usr/bin/env bash
# Dump and restore the agent-rails database in the shape Supabase's own migration guide uses:
# our schema as SQL, everything's rows as data, restored with triggers off. One tool for three
# jobs — the nightly backup, the weekly restore test, and the hosted → VPS cutover import — so
# the path the cutover takes is the one exercised every week.
# Installed as /usr/local/bin/agent-rails-db. Connection comes from libpq env (PGHOST, PGPORT,
# PGUSER, PGPASSWORD, PGSSLMODE); passwords never go in argv.
#   agent-rails-db dump <dir>                   write schema.sql, data.dump, counts.tsv, manifest
#   agent-rails-db check <dir>                  offline integrity check of a dump directory
#   agent-rails-db restore [--public-only] <dir>  load a dump into the target and compare counts
#                                                 (DATA_PGUSER: role that loads the rows)
set -euo pipefail
umask 077

# Schemas we own. auth rows go in the data dump only: GoTrue creates and migrates its own schema.
own_schemas=(-n public -n supabase_migrations)
data_schemas=(-n public -n auth -n supabase_migrations)
# GoTrue's bookkeeping; the target's GoTrue has already written its own rows there.
skip_data=(--exclude-table-data=auth.schema_migrations)

counts() {
  psql -XAt -v ON_ERROR_STOP=1 -F $'\t' -c "
    select format('%I.%I', schemaname, relname) from pg_stat_user_tables
    where schemaname = 'public' order by 1" |
    while read -r t; do printf '%s\t%s\n' "$t" "$(psql -XAtc "select count(*) from $t")"; done
}

dump() {
  local dir=$1
  mkdir -p "$dir"
  # CREATE SCHEMA → IF NOT EXISTS: a fresh Supabase already has public, and ON_ERROR_STOP on
  # restore would otherwise abort on the first line.
  pg_dump --schema-only --no-owner "${own_schemas[@]}" |
    sed -E 's/^CREATE SCHEMA ([a-z_]+);/CREATE SCHEMA IF NOT EXISTS \1;/' >"$dir/schema.sql"
  pg_dump -Fc --data-only --no-owner "${data_schemas[@]}" "${skip_data[@]}" -f "$dir/data.dump"
  counts >"$dir/counts.tsv"
  {
    echo "taken_at $(date -u +%FT%TZ)"
    echo "server $(psql -XAtc 'show server_version')"
    echo "client $(pg_dump --version)"
    echo "source ${PGHOST:-local}:${PGPORT:-5432}"
  } >"$dir/manifest"
  check "$dir"
}

check() {
  local dir=$1
  [[ -s $dir/schema.sql ]] || { echo "empty schema.sql in $dir" >&2; return 1; }
  grep -q 'CREATE TABLE public\.' "$dir/schema.sql" || { echo "no public tables in schema.sql" >&2; return 1; }
  local n
  n="$(pg_restore --list "$dir/data.dump" | grep -c ' TABLE DATA ')"
  (( n > 0 )) || { echo "no table data in data.dump" >&2; return 1; }
  echo "ok $dir: $(grep -c . "$dir/counts.tsv") public tables counted, $n table-data entries"
}

restore() {
  local only=() dir
  [[ ${1:-} == --public-only ]] && { only=(-n public -n supabase_migrations); shift; }
  dir=${1:?dir}
  check "$dir"
  # Schema as PGUSER (postgres on Supabase) so later migrations own what they alter; rows as
  # DATA_PGUSER (supabase_admin), because session_replication_role needs a superuser. The image
  # gives both roles POSTGRES_PASSWORD (supabase/postgres migrations/db/migrate.sh).
  # Errors still reach stderr; -o only drops pg_dump's set_config() result rows.
  psql -X -q -o /dev/null -v ON_ERROR_STOP=1 -f "$dir/schema.sql"
  # replica: FK and user triggers stay off while rows arrive in table order, as the dump has no
  # dependency order across schemas (public.identities → auth.users).
  PGUSER="${DATA_PGUSER:-$PGUSER}" PGOPTIONS='-c session_replication_role=replica' \
    pg_restore --data-only --no-owner --single-transaction --exit-on-error "${only[@]}" \
    -d "${PGDATABASE:-postgres}" "$dir/data.dump"
  if diff <(sort "$dir/counts.tsv") <(counts | sort); then
    echo "restored: row counts match $dir/counts.tsv"
  else
    echo "row counts differ from the dump (< dump, > restored)" >&2
    return 1
  fi
}

case "${1:-}" in
  dump) dump "${2:?dir}" ;;
  check) check "${2:?dir}" ;;
  restore) shift; restore "$@" ;;
  *) echo "usage: agent-rails-db dump|check|restore [--public-only] <dir>" >&2; exit 2 ;;
esac
