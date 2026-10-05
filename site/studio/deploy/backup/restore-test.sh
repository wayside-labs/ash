#!/usr/bin/env bash
# Weekly proof that the newest dump restores into a throwaway Postgres of the same image and that
# the studio tables answer. pg_isready alone is not proof.
set -euo pipefail
DUMP=$(ls -1t /var/backups/ash-studio/diario/studio-*.dump | head -n1)
IMAGE=$(docker inspect -f '{{.Config.Image}}' ash-studio-db)
NAME=ash-studio-restore-test
docker rm -f "$NAME" >/dev/null 2>&1 || true
trap 'docker rm -f "$NAME" >/dev/null 2>&1 || true' EXIT
docker run -d --name "$NAME" --network none -e POSTGRES_PASSWORD=restore-test \
  -e POSTGRES_USER=studio -e POSTGRES_DB=studio "$IMAGE" >/dev/null
# Over TCP on purpose: the init phase runs a socket-only server that answers and then restarts.
for _ in $(seq 1 30); do
  docker exec "$NAME" psql -h 127.0.0.1 -U studio -d studio -c 'select 1' >/dev/null 2>&1 && break
  sleep 2
done
start=$(date +%s)
docker exec -i "$NAME" pg_restore -U studio -d studio --no-owner --exit-on-error <"$DUMP"
counts=$(docker exec "$NAME" psql -U studio -d studio -Atc \
  "select (select count(*) from jobs)||' jobs, '||(select count(*) from audit_log)||' audit rows, '||(select count(*) from worker_heartbeat)||' heartbeats, '||(select count(*) from blog_posts)||' posts'")
echo "$(date -u +%FT%TZ) ok $DUMP restored in $(($(date +%s) - start))s: $counts"
