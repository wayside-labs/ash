# ADR-019: Self-hosted platform on a VPS, replacing Vercel and managed Supabase

**Status:** Proposed. Supersedes the *Platform* section of ADR-017 only; tenancy, identity,
access path and secrets in ADR-017 stand unchanged.

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
x86_64 — provisioned and hardened on 2026-09-28. Option C, reached through B.

### Stages

1. **Stage 1 — dashboard to the VPS (= option B).** Built and run with `next start` (already
   bound to `127.0.0.1` by the package script) under systemd, behind Caddy for automatic TLS.
   Supabase stays managed. Cutover is DNS: the Vercel deployment stays up, untouched, until
   the checks in `deploy-vercel.md` §5 pass against the VPS.
2. **Stage 2 — Supabase to the VPS.** Self-hosted Supabase on the same VPS, data moved by
   `pg_dump`/`pg_restore`, the Google provider and the Web3 (Solana) provider reconfigured on
   our Auth instance, redirect URLs moved to our domain.

### Gates

- **ADR-017's freeze wins.** Stage 1 lands before 2026-10-05 or after 12/10, never in the
  final week. Stage 2 is after 12/10.
- **A domain first.** TLS and the Google OAuth redirect both need a hostname we control; the
  `*.vercel.app` name does not move. The product name is still open (execution plan, *Aberto*),
  so a neutral hostname is acceptable for stage 1.
- **Memory before stage 2.** Measured on the team's other VPS, the self-hosted Supabase
  containers use ~1.3 GB. Stage 2 is scheduled only if, with stage 1 and the go-to-market
  services running, at least 3 GB stay available; otherwise the plan is upgraded first.

### Access model

No private key is shared between people, and no single person can lock the other out.

- **Hostinger panel:** the account owner plus Ronaldo, each with their own login and MFA,
  through the panel's account-sharing feature (to be confirmed in the panel). The owner's
  login is never shared. The panel's recovery console is the way back in if SSH is lost.
- **SSH:** one Linux user per person (`lucas`, `ronaldo`), key-only, with sudo; public keys
  only on the server (Ronaldo's from `github.com/0xcf02.keys`). `root` login and password
  authentication are off, verified from outside.
- **Service user:** `deploy`, without sudo, owns the application directories and runs the
  services. Deploys act as `deploy`, never as a person.
- **Application secrets** (Supabase keys, `ALLOWED_ORIGINS`, optional `ANTHROPIC_API_KEY`) live
  in root-owned `0600` environment files on the server, read by systemd. The copy both partners
  can reach is a shared password-manager vault — never the repository, never chat.

## Consequences

- **The VPS is in the US East, not São Paulo.** Measured from the machine: 14 ms to AWS
  `us-east-1`, ~120 ms to `sa-east-1`. During stage 1 every server-side call to the managed
  Supabase pays that round trip, and a page that makes several of them pays it several times.
  Stage 2 removes it by putting the database next to the dashboard. Accepted for now; moving
  the VPS to a São Paulo data centre is the remedy if stage 1 feels slow.
- We own what the vendors did: OS patching (unattended security upgrades are on), TLS renewal
  (Caddy), **backups** (nightly `pg_dump` off the VPS is a stage 2 prerequisite, not a
  follow-up — without it the managed tier was the safer choice), and uptime monitoring, which
  does not exist yet.
- **Docker publishes ports around `ufw`.** On the team's other VPS, Kong's 8000/8443 answered
  from the internet while `ufw` allowed only 22. Here the daemon sets `"ip": "127.0.0.1"`, so a
  published port listens locally unless an address is written out; public traffic enters only
  through the proxy.
- **One host, two workloads.** The go-to-market services share the VPS under their own
  Compose project and service user. They hold contact lists, not wallets or tenant data, but a
  compromise of one is a compromise of the host. They move to a second VPS when memory runs
  short or before the product holds anything a customer would call production.
- x86_64 removes the arm64 check the first draft required for every image.
- The `claude-cli` chat provider becomes technically possible on a server with a disk, and stays
  off. ADR-017's rule holds: a visitor without a key of their own gets `demo`, never the host's
  subscription or API key.
- `deploy-vercel.md` stays the reference for the managed deployment until stage 1 is cut over,
  then becomes the rollback path. `docs/runbooks/deploy-vps.md` is the runbook for this ADR.
- The exit is the same Compose file on any VM — the portability that the managed stack did
  not offer.
