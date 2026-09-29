#!/usr/bin/env bash
# Build and switch the dashboard to a git ref. Installed by bootstrap.sh as
# /usr/local/sbin/agent-rails-deploy and run by a person with sudo:
#   sudo agent-rails-deploy [branch|tag|sha]     (default: main)
# Everything that touches the checkout runs as `agent-rails`; root only swaps the service.
set -euo pipefail

ref="${1:-main}"
base=/srv/agent-rails
mirror="$base/repo.git"
keep=3
[[ $EUID -eq 0 ]] || { echo "run with sudo" >&2; exit 1; }

as_deploy() { sudo -u agent-rails -H -- "$@"; }

# bootstrap.sh pre-creates repo.git (the root-owned parent is not writable by agent-rails), so
# "not cloned yet" means no HEAD inside it rather than no directory.
if [[ ! -f $mirror/HEAD ]]; then
  as_deploy git clone --mirror git@github.com:wayside-labs/agent-rails.git "$mirror"
fi
as_deploy git -C "$mirror" fetch --prune --quiet
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
    corepack pnpm turbo run build --filter=@agent-rails/dashboard
    touch .built
  ' _ "$release"
fi

switch_to() {
  ln -sfn "$1" "$base/current.tmp"
  mv -T "$base/current.tmp" "$base/current"
  systemctl restart agent-rails-dashboard
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
