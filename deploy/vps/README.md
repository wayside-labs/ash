# VPS deployment (ADR-019)

The dashboard and a trimmed self-hosted Supabase on the team VPS, which is shared with the ash
stack (site, mail, listmonk). Traffic arrives only through our own Cloudflare tunnel; nothing
here opens a port or changes anything host-wide.

## Layout and ownership

| Path / unit | Owner | What |
|---|---|---|
| `/srv/agent-rails/releases/<sha>`, `current` | `agent-rails` builds, root swaps | dashboard releases (`deploy.sh`) |
| `/srv/agent-rails/supabase` | root, 0750 | upstream compose files (pinned by `supabase/upstream.lock`) + our overlay |
| `/etc/agent-rails/*.env` | root, 0600/0640 | secrets; generated once by `bootstrap.sh` |
| `/var/backups/agent-rails/{daily,offsite}` | `agent-rails` | nightly dumps; `offsite/` is what ash-offsite ships |
| `agent-rails-supabase.service` | root | compose up → `check-gateway.sh` → tunnel |
| `agent-rails-dashboard.service` | `agent-rails` | `next start` on 127.0.0.1:3000 |
| `agent-rails-backup.timer` | `agent-rails` | 03:05 UTC, before ash-offsite at 04:00 |
| `agent-rails-restore-test.timer` | root | Mon 04:40 UTC, after ash's own test |

The ash side owns `/opt/ash*`, `/var/backups/ash-*`, `/var/backups/offsite`, `/etc/ash-*` and
`ash-*` units. **Announce reboots, `apt upgrade`, and firewall/sshd/docker-daemon changes in the
team chat first; no reboot without the other person's ack.**

No person or service user is in the `docker` group. `agent-rails` has neither docker nor sudo;
everything that needs docker is a root-owned unit reading root-owned files.

## Network

| Hostname (ash's Cloudflare account) | Tunnel target | Exposed |
|---|---|---|
| `console.ash.app.br` | `http://127.0.0.1:3000` | everything (the dashboard) |
| `console-api.ash.app.br` | `http://127.0.0.1:8000` | **path `^/(auth\|rest)/v1/` only** |
| `vendor-{oracle,notary,compute}.ash.app.br` | `http://127.0.0.1:4101` / `4102` / `4103` | everything (demo vendors, `vendors/install.sh`) |

- The API hostname has one label under the zone because Universal SSL covers `*.ash.app.br`, not
  `*.console.ash.app.br`.
- The browser needs the API hostname: `@supabase/ssr`'s browser client calls Auth directly.
- Studio, pg-meta (`/pg/`) and the gateway root stay off the tunnel. Reach Studio with
  `ssh -L 8000:127.0.0.1:8000 agent-rails-vps`, then http://localhost:8000 (basic auth:
  `DASHBOARD_USERNAME` / `DASHBOARD_PASSWORD` in `/etc/agent-rails/supabase.env`).
- Nothing listens on 80/443: ash's certbot takes port 80 twice a day in standalone mode.

## Supabase: what runs

Upstream's `docker/docker-compose.yml` at the commit in `supabase/upstream.lock`, with
`supabase/docker-compose.agent-rails.yml` on top:

- **on:** db (`supabase/postgres:17.6.1.166`, same build as hosted), auth (`gotrue v2.197.0`, same as
  hosted, Google + Solana web3), rest, meta, studio, the Envoy gateway (loopback), and the tunnel.
- **off** (profile `unused`): realtime, storage, imgproxy, functions, supavisor; the logs
  overlay is never loaded. The dashboard uses none of them.
- **not from upstream's `.env.example`:** it ships demo values for the `sb_` keys that
  `generate-keys.sh` never replaces. `supabase/supabase.env.template` is our own list, with
  those left empty (legacy key mode).
- **checked on every start:** `check-gateway.sh` asserts that `/pg/` and the `/rest/v1/` root
  refuse an empty `apikey` header. That header is compared against the asymmetric keys we leave
  empty. If the probe fails, the unit fails and the tunnel never starts.

Bumping upstream: change `commit` in `upstream.lock`, run
`supabase/fetch-upstream.sh --print /tmp/sb` where there is network, read the diff (the Envoy
template above all), paste the sums.

## First install

The repo is private and the box has no GitHub key until bootstrap makes one, so the scripts go
over the SSH you already have, from a laptop checkout of the branch being installed:

```sh
git archive --prefix=agent-rails-deploy/ HEAD deploy/vps | ssh agent-rails-vps 'tar -x -C ~'
ssh -t agent-rails-vps 'cd ~/agent-rails-deploy/deploy/vps &&
  sudo DOMAIN=console.ash.app.br API_DOMAIN=console-api.ash.app.br ./bootstrap.sh'
```

It prints what is still missing. Fill each item with `sudoedit`:

1. The deploy key it printed, registered read-only on `wayside-labs/agent-rails`.
2. `TUNNEL_TOKEN` in `/etc/agent-rails/tunnel.env`. Lucas writes it there himself once
   `/etc/agent-rails` exists; it never passes through chat.
3. `/etc/agent-rails/backup.age-recipients`: our `age1…` public key. Keep the identity (private
   key) off this box, in the team password manager. Without it no backup can be read, including
   by us.
4. `GOOGLE_CLIENT_ID`, `GOOGLE_SECRET` and `GOOGLE_ENABLED=true` in
   `/etc/agent-rails/supabase.env`: the hosted project's Google OAuth client. Also add
   `https://console-api.ash.app.br/auth/v1/callback` to its authorized redirect URIs.

Then `sudo systemctl restart agent-rails-supabase` and `sudo agent-rails-deploy main`.

## Cutover from hosted Supabase

Every user signs in again afterwards, because the JWT secret is new. Their accounts, identities
and tenant data carry over.

1. Announce a short write freeze on the Vercel deployment.
2. Dump hosted from the VPS (the PGDG `pg_dump` 17 is installed). Read the password without echo,
   so it stays out of argv and history:
   ```sh
   sudo -i
   read -rs PGPASSWORD; export PGPASSWORD PGSSLMODE=require PGDATABASE=postgres
   export PGHOST=aws-0-sa-east-1.pooler.supabase.com PGUSER=postgres.rjevwiebjrclgjaumdds
   agent-rails-db dump /var/backups/agent-rails/cutover-hosted
   ```
3. Restore into the local stack, which must still be fresh: nothing pushed to it and no
   `supabase db push` against it. The restore stops at the first object that already exists.
   The schema is created as `postgres`, so later migrations can
   alter it. The rows go in as `supabase_admin`, because loading with triggers off needs a
   superuser:
   ```sh
   export PGHOST=127.0.0.1 PGPORT=54322 PGSSLMODE=disable PGUSER=postgres
   export PGPASSWORD="$(sed -n 's/^POSTGRES_PASSWORD=//p' /etc/agent-rails/supabase.env)"
   DATA_PGUSER=supabase_admin agent-rails-db restore /var/backups/agent-rails/cutover-hosted
   ```
   It ends by comparing every public table's row count with the dump.
4. `sudo systemctl restart agent-rails-supabase agent-rails-dashboard`, then sign in with Google
   and with a wallet at https://console.ash.app.br.
5. Point people at the new URL. Keep hosted untouched for a week as the fallback.

## Backups

- **Nightly:** `agent-rails-db dump` runs as the read-only `agent_rails_backup` role (BYPASSRLS +
  `pg_read_all_data`, never the superuser). The tarball is encrypted with `age` to our recipient,
  written to `offsite/`, and shipped to livro-vps by ash-offsite. Livro-vps keeps 90 days, and its
  write-only rrsync key cannot read, delete or overwrite. Locally: 7 days in plain, 3 days encrypted.
- **Weekly:** `agent-rails-restore-test` restores the newest dump (public schema) into a
  throwaway container of the same image and compares row counts.
- **Handoff to ash-offsite:** confirmed and tested by Lucas on 2026-09-29. At 04:00 UTC it ships
  `offsite/*.tar.age` byte-for-byte (no re-encryption) to `agent-rails-db/` on livro-vps. Names
  must be unique: a name already there is skipped silently, hence the per-second timestamps.
- **Failure alerts:** `agent-rails-*` failures only reach the journal until ash's Telegram
  alerting also watches `agent-rails-*`.
- **Restoring from offsite:** fetch the `.tar.age` from livro-vps, then
  `age -d -i <identity> x.tar.age | tar -x`, then step 3 of the cutover against the target.
