#!/usr/bin/env bash
# Daily dump of the studio database plus the uploaded images. Retention: 7 daily, 4 weekly,
# 6 monthly. A dump pg_restore cannot list is a failure: an empty file looks like a backup.
set -euo pipefail
DEST=/var/backups/ash-studio
STAMP=$(date -u +%Y-%m-%dT%H%MZ)
mkdir -p "$DEST"/{diario,semanal,mensal}

TMP="$DEST/diario/.studio-$STAMP.dump.partial"
OUT="$DEST/diario/studio-$STAMP.dump"
docker exec ash-studio-db pg_dump -U studio -d studio -Fc >"$TMP"
docker exec -i ash-studio-db pg_restore --list >/dev/null <"$TMP"
mv "$TMP" "$OUT"

UP="$DEST/diario/uploads-$STAMP.tar.gz"
tar -czf "$UP.partial" -C /opt/ash-studio uploads
tar -tzf "$UP.partial" >/dev/null
mv "$UP.partial" "$UP"
chmod 640 "$OUT" "$UP"

[ "$(date -u +%u)" = 7 ] && cp -p "$OUT" "$UP" "$DEST/semanal/"
[ "$(date -u +%d)" = 01 ] && cp -p "$OUT" "$UP" "$DEST/mensal/"

# find, not ls: with pipefail, ls on a still-empty weekly/monthly dir fails the whole run.
prune() {
  find "$1" -maxdepth 1 -name "$2" -printf '%T@ %p\n' | sort -rn |
    tail -n +"$(($3 + 1))" | cut -d' ' -f2- | xargs -r rm -f
}
for kind in 'studio-*.dump' 'uploads-*.tar.gz'; do
  prune "$DEST/diario" "$kind" 7
  prune "$DEST/semanal" "$kind" 4
  prune "$DEST/mensal" "$kind" 6
done
echo "$(date -u +%FT%TZ) ok $OUT $(stat -c %s "$OUT") bytes; $UP $(stat -c %s "$UP") bytes"
