#!/usr/bin/env bash
# Throwaway Postgres for the integration suites, loopback-only on the VPS (no Docker on the PC).
# Use (repo root): bash studio/deploy/testdb.sh   then   ssh -N -L 54329:127.0.0.1:54329 agent-rails-vps
set -euo pipefail
ssh agent-rails-vps 'set -e
if ! sudo docker ps -a --format "{{.Names}}" | grep -qx ash-studio-testdb; then
  PW=$(openssl rand -hex 16)
  sudo docker run -d --name ash-studio-testdb --restart unless-stopped \
    -p 127.0.0.1:54329:5432 -e POSTGRES_USER=studio -e POSTGRES_DB=studio_test \
    -e POSTGRES_PASSWORD="$PW" postgres:17.11-alpine >/dev/null
  echo "TEST_DATABASE_URL=postgres://studio:$PW@127.0.0.1:54329/studio_test" | sudo tee /opt/ash-studio-testdb.env >/dev/null
  sudo chmod 600 /opt/ash-studio-testdb.env
fi
sudo cat /opt/ash-studio-testdb.env' > studio/.env.test
echo "studio/.env.test written (gitignored)"
