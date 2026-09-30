# ADR-019: Self-hosted platform on a VPS, replacing Vercel and managed Supabase

**Status:** Accepted — in production since 2026-09-29. Supersedes the *Platform* section of
ADR-017 only; tenancy, identity, access path and secrets in ADR-017 stand unchanged.

**Amended 2026-09-30.** The first accepted text planned Caddy on a machine of our own, a
`deploy` service user, and stage 2 after 12/10. What was agreed with Lucas and built instead
(PR #77) is recorded below: one VPS shared with the ash stack, our own Cloudflare tunnel, an
`agent-rails` user, a trimmed self-hosted Supabase, and backups — with both stages done before
the freeze. Context and options are unchanged; Decision and Consequences describe what runs.
The operational runbook is `deploy/vps/README.md`.

## Context

ADR-017 put the hosted dashboard on Vercel Hobby with state in managed Supabase, and
`docs/runbooks/deploy-vercel.md` records it running since 2026-09-24. The choice was right for
getting a URL up in a day. What it costs showed up in the same runbook and in ADR-017 itself:

- **Hobby is non-commercial.** ADR-017 names the trigger as *the first pricing page, checkout,
  or advertised sale*. The execution plan's definition of done for 10/10
  (`docs/strategy/colosseum-plano-execucao.md`) includes plans published on the landing page,
  and the business track after 12/10 — The Garage demo day, then outreach — is a sales
  motion. The trigger is days away, not a future event.
- **Serverless constrains the product, not just the ops.** No durable disk (the JSON store
  cannot run), a 300s ceiling the chat route has not been verified against, a region that
  `vercel.json` silently ignores on Hobby, a 12 GB upload without `.vercelignore`. Each is
  worked around in the runbook; each is a workaround a server does not need.
- **Two vendors can pause or terminate the deployment.** Supabase's free tier pauses inactive
  projects; Vercel can disable a Hobby project for commercial use. Neither is likely during
  the hackathon, and either is visible to a judge or a customer if it happens.
- **Positioning.** The pitch is that the guarantee does not rest on anyone's good conduct.
  After 12/10 the audience is investors and buyers judging startup maturity. A deployment on
  two free tiers reads as a prototype; infrastructure the team operates, with a runbook and a
  named owner for patching and backups, reads as a company. This is a judgement, not a
  measurement, and it is the least load-bearing argument here.

The first draft of this ADR (2026-09-24) targeted Oracle Cloud's Always Free Ampere A1. It did
not survive contact:

- **A1 capacity in São Paulo was exhausted** on every attempt, and the region has a single
  availability domain.
- **The allowance it was sized on no longer exists.** Oracle cut the Always Free A1 grant from
  4 OCPU / 24 GB to 2 OCPU / 12 GB on 2026-06-15, through a documentation change rather than an
  announcement ([InfoQ, 2026-07](https://www.infoq.com/news/2026/07/oracle-cloud-free-tier-limits/)).
- **Paying does not unblock it by itself.** On 2026-09-28 the tenancy still showed a service
  limit of 2 cores / 12 GB for A1; a larger shape needs a limit-increase request, with its own
  turnaround, before capacity is even tried.

The budget was then set explicitly: a **paid** machine, up to R$ 80/month, sized for this
platform plus the team's go-to-market services (site, blog, mailing). Prices compared on
2026-09-25/28, BRL at 5.16/USD and 5.90/EUR, before card IOF:

| Provider / plan | vCPU | RAM | Disk | Where | R$/month |
|---|---|---:|---:|---|---:|
| Oracle A1 Flex, 3 OCPU / 18 GB (paid) | 3 Arm cores | 18 GB | 100–200 GB | São Paulo | ~72, *if* the limit is raised |
| Hostinger KVM 2 | 2 (EPYC 9354P) | 8 GB | 100 GB NVMe | chosen at purchase | billed in BRL, within budget |
| Hostinger KVM 4 | 4 | 16 GB | 200 GB NVMe | chosen at purchase | 60 on a 24-month prepay, renews at 150 |
| Hetzner CX33 / CAX21 | 4 shared | 8 GB | 80 GB | Germany / Finland only | ~53 / ~65 |
| Hetzner CX43 | 8 shared | 16 GB | 160 GB | Germany / Finland only | ~97 |
| AWS Lightsail, São Paulo | 2 burstable | 8 GB | 160 GB | São Paulo | ~227 |
| AWS EC2 `t4g.large`, São Paulo | 2 burstable | 8 GB | extra | São Paulo | ~404 |
| Akamai (Linode), São Paulo | 4 shared | 8 GB | 160 GB | São Paulo | ~347 |

Hetzner's cheap lines are EU-only (its US sites sell only CPX/CCX, ~R$ 190+ for 4 GB) and it
raised prices twice in 2026. AWS is three to five times the budget for the same memory.

## Options considered

Where to run it:

- **Oracle A1, paid.** The most memory for the money and dedicated Arm cores, but blocked on a
  limit increase and on capacity, both outside our control, days before the freeze.
- **Hetzner.** The most reputable of the cheap options; the plans inside the budget have 8 GB
  and sit in Europe.
- **Hostinger KVM.** x86, available the same hour, billed in reais, and the team already runs
  a comparable stack on another Hostinger VPS — self-hosted Supabase plus several Next.js apps
  in about 3.3 GB of RAM on the same 2 vCPU / 8 GB plan. Chosen.

What to move (unchanged from the first draft):

- A. **Keep ADR-017's platform.** Zero work before the freeze. Leaves the Hobby clause on a
  collision course with the landing page and every constraint above in place.
- B. **Dashboard on the VPS, Supabase stays managed.** `next start` behind a TLS proxy; the
  database, Auth and RLS are untouched. Removes Vercel and its clause; keeps one vendor and
  its pause policy.
- **C. Dashboard and Supabase both on the VPS.** Supabase's self-hosted distribution (Postgres,
  Auth, PostgREST, gateway) in Docker Compose, the dashboard alongside, one TLS proxy in front.
  The application code does not change: `@supabase/ssr`, RLS and the `identities` join from
  ADR-017 keep working against a different URL.
- D. **Plain Postgres and our own auth.** Drops Supabase entirely. Rewrites ADR-017's identity
  and access path weeks before a deadline; rejected on timing, not merit.

## Decision

A **Hostinger KVM 2** VPS — 2 vCPU AMD EPYC 9354P, 7.8 GiB RAM, ~97 GB NVMe, Ubuntu 22.04,
x86_64 — provisioned and hardened on 2026-09-28, **shared with the ash stack** (site, mail,
listmonk: the go-to-market services this budget was sized for). Option C, reached through B,
both stages completed on 2026-09-29.

### Traffic: our own Cloudflare tunnel, no open port

| Hostname (ash's Cloudflare account) | Target | Exposed |
|---|---|---|
| `console.ash.app.br` | `127.0.0.1:3000` (dashboard) | everything |
| `console-api.ash.app.br` | `127.0.0.1:8000` (Supabase gateway) | path `^/(auth\|rest)/v1/` only |

- Nothing of ours listens on 80/443 and `ufw` is unchanged: ash's certbot owns port 80 in
  standalone mode, and a TLS proxy would have competed with it. Cloudflare terminates TLS.
- The API hostname sits one label under the zone because Universal SSL covers `*.ash.app.br`
  only. Studio, pg-meta and the gateway root never reach the tunnel; Studio is `ssh -L`.
- Security headers live in `next.config.ts`, so every host sends the same ones.

### Supabase: trimmed, pinned, probed

- **Runs:** db, auth, rest, meta, studio and the Envoy gateway, all on loopback. **Off:**
  realtime, storage, imgproxy, functions, the pooler. The dashboard uses none of them.
- **Pinned to hosted's versions** (Postgres `17.6.1.166`, GoTrue `v2.197.0`) so the cutover
  import had no schema drift. Upstream's compose files are fetched at one commit and checked
  against `supabase/upstream.lock`; a changed file stops the install.
- **Our own env template**, not upstream's `.env.example`, whose demo `sb_` secret key would be
  service-role access for anyone.
- **`check-gateway.sh` on every start** asserts that `/pg/` and the `/rest/v1/` root refuse an
  empty `apikey`; if it fails, the unit fails and the tunnel never comes up.
- Auth providers: email magic link (ADR-024), Google, and Solana web3.

### Stages, as run

1. **Stage 1 — dashboard to the VPS.** `next start` on `127.0.0.1:3000` under systemd, first
   deploy 2026-09-29. Releases are built per commit under `/srv/agent-rails/releases/<sha>`
   and swapped atomically.
2. **Stage 2 — Supabase to the VPS.** Cut over 2026-09-29 ~23:05 UTC. Hosted had no rows and
   no users, so the move carried the schema and migration history; a hosted dump taken first
   is kept locally.

The freeze gate held: both stages landed before 2026-10-05. The memory gate held too: the
trimmed stack runs in ~445 MB beside ash.

### Access model

No private key is shared between people, and no single person can lock the other out.

- **Hostinger panel:** the account owner plus Ronaldo, each with their own login and MFA.
  The owner's login is never shared. The panel's recovery console is the way back if SSH is lost.
- **SSH:** one Linux user per person (`lucas`, `ronaldo`), key-only, with sudo. `root` login and
  password authentication are off, verified from outside.
- **Service user:** `agent-rails` — no docker group, no sudo, no SSH. It builds and runs the
  dashboard. `/srv/agent-rails` stays root-owned so it cannot swap files root runs; everything
  that needs docker is a root-owned unit reading root-owned files. (`deploy` is the ash stack's
  user and is in the docker group, i.e. root-equivalent; we do not use it.)
- **Deploys** go as a git bundle over the SSH a person already has (`deploy/vps/push-deploy.sh`):
  the org disables deploy keys, and no GitHub credential lives on the box.
- **Application secrets** live in root-owned `/etc/agent-rails/*.env` (0600/0640), read by
  systemd. The copy both partners can reach is a shared password-manager vault — never the
  repository, never chat.
- **Shared host rule:** reboots, `apt upgrade`, and firewall, sshd or docker-daemon changes are
  announced to the other side first; no reboot without the other person's ack.

## Consequences

- **The VPS is in the US East, not São Paulo** (14 ms to `us-east-1`, ~120 ms to `sa-east-1`).
  With the database now on the same host, server-side calls no longer pay that trip; users in
  Brazil still do, once per request. Moving to a São Paulo data centre remains the remedy.
- We own what the vendors did:
  - **OS patching:** unattended security upgrades are on.
  - **TLS:** Cloudflare, through the tunnel.
  - **Backups:** nightly `agent-rails-db dump` (03:05 UTC) as a read-only role, encrypted with
    `age` to our key, shipped by ash-offsite to livro-vps; a weekly restore test (Mon 04:40 UTC)
    proves the dump restores.
  - **Monitoring:** journal-only by decision (2026-09-29); no alerting.
- **Migrations are not applied by deploys.** `push-deploy.sh` ships code only; a release that
  needs a migration has it applied by hand first (backup, then one transaction with its history
  row, then `notify pgrst, 'reload schema'`). Missing this once made every `/api/state` call 500.
- **One host, two workloads.** ash holds contact lists and mail, not wallets or tenant data,
  but a compromise of one is a compromise of the host. The agent-rails side is split from it by
  user, paths and units; the two move to separate machines when memory runs short or before the
  product holds anything a customer would call production.
- **Docker publishes ports around `ufw`.** The daemon sets `"ip": "127.0.0.1"`, so a published
  port listens locally unless an address is written out; public traffic enters only through
  the tunnel.
- x86_64 removes the arm64 check the first draft required for every image.
- The `claude-cli` chat provider is installed on the host and stays off for hosted tenants.
  ADR-017's rule holds: a visitor without a key of their own never gets the host's subscription
  or API key.
- `deploy-vercel.md` is now the rollback path only.
- The exit is the same Compose files on any VM — the portability the managed stack did not offer.
