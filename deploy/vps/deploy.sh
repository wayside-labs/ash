#!/usr/bin/env bash
# Build and switch the dashboard to a git ref. Installed by bootstrap.sh as
# /usr/local/sbin/agent-rails-deploy. The code arrives as a git bundle on stdin, sent over the
# operator's own SSH by push-deploy.sh from a laptop checkout:
#   deploy/vps/push-deploy.sh <branch|tag>
# The org disables deploy keys, and this way the box holds no credential that reaches GitHub
# at all. Empty stdin reuses what the mirror already has, which is how a rollback runs:
#   ssh agent-rails-vps sudo agent-rails-deploy <sha-of-an-earlier-release> </dev/null
# Everything that touches the checkout runs as `agent-rails`; root only swaps the service.
set -euo pipefail

ref="${1:?usage: agent-rails-deploy <branch|tag|sha> < repo.bundle}"
base=/srv/agent-rails
mirror="$base/repo.git"
keep=3
[[ $EUID -eq 0 ]] || { echo "run with sudo" >&2; exit 1; }
[[ -t 0 ]] && { echo "expects a git bundle on stdin (use push-deploy.sh)" >&2; exit 1; }

as_deploy() { sudo -u agent-rails -H -- "$@"; }

# bootstrap.sh pre-creates repo.git (the root-owned parent is not writable by agent-rails), so
# "not initialised yet" means no HEAD inside it rather than no directory.
[[ -f $mirror/HEAD ]] || as_deploy git init -q --bare "$mirror"

bundle="$(mktemp /var/lib/agent-rails/incoming.XXXXXX)"
trap 'rm -f "$bundle"' EXIT
cat >"$bundle"
if [[ -s $bundle ]]; then
  chown agent-rails:agent-rails "$bundle"
  # verify checks the bundle's own checksum and that every prerequisite is already present.
  as_deploy git -C "$mirror" bundle verify -q "$bundle"
  as_deploy git -C "$mirror" fetch -q --force "$bundle" '+refs/*:refs/*'
fi
sha="$(as_deploy git -C "$mirror" rev-parse --verify "$ref^{commit}")"
release="$base/releases/$sha"
previous="$(readlink -f "$base/current" 2>/dev/null || true)"
echo "deploying $ref at $sha"

# Each release is its own tree, so the running server keeps serving its .next while the next
# one builds. A release that already built is reused, which makes a rollback a symlink swap.
if [[ ! -f $release/.built ]]; then
  as_deploy rm -rf "$release"
  as_deploy mkdir -p "$release"
  as_deploy git -C "$mirror" archive "$sha" | as_deploy tar -x -C "$release"
  # NEXT_PUBLIC_* are inlined at build time, so the build must see the public env file.
  # --ignore-scripts for the same reason as vercel.json: the root `prepare` runs
  # `lefthook install`, which needs a .git the archive does not carry.
  as_deploy bash -c '
    set -euo pipefail
    set -a; . /etc/agent-rails/dashboard.public.env; set +a
    cd "$1"
    corepack pnpm install --frozen-lockfile --ignore-scripts
    # The vendors, the CLI (the scripted buyer pays through it) and the MCP server (agents on
    # this box run it) ride along; turbo builds their shared dependencies once.
    corepack pnpm turbo run build --filter=@agent-rails/dashboard --filter=@agent-rails/vendors \
      --filter=@agent-rails/cli --filter=@agent-rails/mcp --filter=@agent-rails/knowledge-mcp
    touch .built
  ' _ "$release"
fi

switch_to() {
  ln -sfn "$1" "$base/current.tmp"
  mv -T "$base/current.tmp" "$base/current"
  systemctl restart agent-rails-dashboard
  # Only the vendor instances someone enabled; `current` moved under them too.
  for unit in $(systemctl list-units --plain --no-legend 'agent-rails-vendor@*' | awk '{print $1}'); do
    systemctl restart "$unit"
  done
}

healthy() {
  for _ in $(seq 30); do
    if curl -fsS -o /dev/null http://127.0.0.1:3000/; then return 0; fi
    sleep 1
  done
  return 1
}

switch_to "$release"
if ! healthy; then
  echo "new release did not answer on 127.0.0.1:3000" >&2
  journalctl -u agent-rails-dashboard -n 40 --no-pager >&2
  if [[ -n $previous && -d $previous ]]; then
    echo "rolling back to $(basename "$previous")" >&2
    switch_to "$previous"
  fi
  exit 1
fi
echo "live: $sha"

# Keep the newest few releases for instant rollback; never delete the live one.
ls -1dt "$base"/releases/*/ | tail -n +$((keep + 1)) | while read -r old; do
  [[ $(readlink -f "$old") == $(readlink -f "$base/current") ]] || rm -rf "$old"
done
