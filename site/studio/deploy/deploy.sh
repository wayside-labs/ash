#!/usr/bin/env bash
# Ships the committed studio/ tree to the VPS and builds there: one VPS, one image, no registry.
# Use (Git Bash, repo root): bash studio/deploy/deploy.sh
set -euo pipefail
HOST=${HOST:-agent-rails-vps}
[ -z "$(git status --porcelain -- studio)" ] || { echo "studio/ has uncommitted changes" >&2; exit 1; }
VERSION=$(git rev-parse --short HEAD)

git archive --format=tar HEAD:studio | ssh "$HOST" \
  'sudo rm -rf /opt/ash-studio/src && sudo mkdir -p /opt/ash-studio/src && sudo tar -x -C /opt/ash-studio/src'
ssh "$HOST" "set -e; cd /opt/ash-studio
  sudo cp src/deploy/docker-compose.yml .
  sudo docker build -q -t ash-studio:$VERSION src
  # Pinned in .env so a later plain 'docker compose ps/logs/restart' on the box resolves the image.
  if sudo grep -q '^APP_VERSION=' .env; then sudo sed -i 's/^APP_VERSION=.*/APP_VERSION=$VERSION/' .env
  else echo 'APP_VERSION=$VERSION' | sudo tee -a .env >/dev/null; fi
  # Backup scripts are code and ship with every deploy; the systemd units are a manual one-time
  # install (see README, "Backup").
  sudo mkdir -p backup && sudo install -m 755 src/deploy/backup/*.sh backup/
  # The app runs as uid 10001 (Dockerfile) and writes post images here. If compose created the
  # bind mount it would be root's, and every upload would fail with EACCES. Idempotent: an
  # existing directory keeps its files and gets the owner set again.
  sudo install -d -o 10001 -g 10001 /opt/ash-studio/uploads
  sudo docker compose up -d --remove-orphans
  # The gate is the live probe (app answers, database reachable, worker beating). The full health
  # also goes red for a job that died in the last 24 h or an error in the worker's last cycle;
  # that must be seen, but it must not fail a deploy that may be the very fix for it.
  ok=0
  for i in \$(seq 1 30); do
    if sudo docker exec ash-studio wget -qO /dev/null 'http://127.0.0.1:3000/api/health?probe=live' 2>/dev/null; then ok=1; break; fi
    sleep 5
  done
  sudo docker compose ps
  # node, not wget: busybox wget prints no body on a 503, and the body is what says why.
  sudo docker exec ash-studio node -e \"fetch('http://127.0.0.1:3000/api/health').then(async (r) => { console.log(await r.text()); r.ok || console.log('WARNING: health is red; the checks above say why'); })\" || true
  if [ \$ok != 1 ]; then
    echo 'app never came up (live probe)' >&2
    sudo docker compose logs --tail 50 app worker
    exit 1
  fi"
echo "deployed $VERSION"
