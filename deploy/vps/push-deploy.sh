#!/usr/bin/env bash
# Deploy a branch or tag of this checkout to the VPS: bundle it here, stream it over SSH, build
# and switch there (agent-rails-deploy). Nothing on the box can fetch from GitHub, by design.
#   deploy/vps/push-deploy.sh feat/vps-stage1-dashboard
#   deploy/vps/push-deploy.sh origin/main          (what GitHub has, not the local branch)
# Needs sudo on the box for the SSH user (AGENT_RAILS_HOST, default agent-rails-vps).
set -euo pipefail

ref="${1:?usage: push-deploy.sh <branch|tag|origin/branch>}"
host="${AGENT_RAILS_HOST:-agent-rails-vps}"
# A bundle carries named refs, so a bare sha has no name to travel under; deploy a branch or tag.
full="$(git rev-parse --symbolic-full-name "$ref")"
[[ $full == refs/* ]] || { echo "$ref is not a branch or tag name" >&2; exit 1; }

echo "deploying $ref ($(git rev-parse --short "$ref^{commit}")) to $host"
git bundle create - "$full" 2>/dev/null | ssh "$host" sudo agent-rails-deploy "$ref"
