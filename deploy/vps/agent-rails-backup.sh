#!/usr/bin/env bash
# Nightly database backup, run by agent-rails-backup.service as the agent-rails user with
# /etc/agent-rails/backup.env (a read-only BYPASSRLS role on 127.0.0.1:54322, created by
# bootstrap.sh — not the superuser, since this user also runs the dashboard).
#   daily/<ts>/      plaintext dump, 7 days, for the weekly restore test on this box
#   offsite/<ts>.tar.age  encrypted to OUR age recipient only; ash-offsite ships this folder to
#                         livro-vps as-is and cannot read it, and we cannot read theirs
set -euo pipefail
umask 077

root=/var/backups/agent-rails
ts="$(date -u +%Y%m%dT%H%MZ)"

agent-rails-db dump "$root/daily/$ts"
tar -C "$root/daily" -cf - "$ts" |
  age -R /etc/agent-rails/backup.age-recipients -o "$root/offsite/$ts.tar.age.part"
# Renamed only when complete, so the offsite job never ships half a file.
mv "$root/offsite/$ts.tar.age.part" "$root/offsite/$ts.tar.age"
echo "backup $ts: $(du -sh "$root/daily/$ts" | cut -f1) plain, $(du -h "$root/offsite/$ts.tar.age" | cut -f1) encrypted"

# Offsite keeps 90 days on livro-vps; locally only what the restore test and a quick rollback need.
find "$root/daily" -mindepth 1 -maxdepth 1 -type d -mtime +7 -exec rm -rf {} +
find "$root/offsite" -maxdepth 1 -name '*.tar.age*' -mtime +3 -delete
