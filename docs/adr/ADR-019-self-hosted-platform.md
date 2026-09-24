# ADR-019: Self-hosted platform on an Oracle Cloud VM, replacing Vercel and managed Supabase

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

Budget is the constraint that made the managed stack attractive. It no longer binds: Oracle
Cloud's Always Free tier includes an Ampere A1 allowance of up to 4 OCPU and 24 GB RAM with
200 GB of block storage, with no expiry. A tenancy was opened on 2026-09-24 with home region
São Paulo (`sa-saopaulo-1`), the same region as the Supabase project (`sa-east-1`) and the
Vercel function (`gru1`), so latency does not move.

Two facts observed that day constrain the plan:

- **A1 capacity in São Paulo was exhausted.** Instance creation returned *out of capacity* for
  `VM.Standard.A1.Flex`, and the region has a single availability domain. Always Free compute
  exists only in the home region, so moving regions is not a way around it.
- **The fallback is too small for this stack.** A `VM.Standard.E2.1.Micro` (1/8 OCPU, 1 GB RAM,
  x86) was provisioned and hardened as a foothold. It can run a long-lived Node process — the
  reference agent from the execution plan — but not a Next.js build, and not Supabase.

## Options considered

- A. **Keep ADR-017's platform.** Zero work before the freeze. Leaves the Hobby clause on a
  collision course with the landing page and every constraint above in place.
- B. **Dashboard on the VM, Supabase stays managed.** `next start` behind a TLS proxy; the
  database, Auth and RLS are untouched. Removes Vercel and its clause; keeps one vendor and
  its pause policy.
- **C. Dashboard and Supabase both on the VM.** Supabase's self-hosted distribution (Postgres,
  Auth, PostgREST, gateway) in Docker Compose, the dashboard alongside, one TLS proxy in front.
  The application code does not change: `@supabase/ssr`, RLS and the `identities` join from
  ADR-017 keep working against a different URL.
- D. **Plain Postgres and our own auth.** Drops Supabase entirely. Rewrites ADR-017's identity
  and access path three weeks before a deadline; rejected on timing, not merit.

## Decision

Option C, reached through B, and gated on hardware.

### Stages

1. **Stage 1 — dashboard to the VM (= option B).** Built on the A1, run with `next start`
   (already bound to `127.0.0.1` by the package script) under systemd, behind Caddy for
   automatic TLS. Supabase stays managed. Cutover is DNS: the Vercel deployment stays up,
   untouched, until the checks in `deploy-vercel.md` §5 pass against the VM.
2. **Stage 2 — Supabase to the VM.** Self-hosted Supabase on the same A1, data moved by
   `pg_dump`/`pg_restore`, the Google provider and the Web3 (Solana) provider reconfigured on
   our Auth instance, redirect URLs moved to our domain.

### Gates

- **No A1, no migration.** The micro VM does not host the dashboard or the database. If the A1
  is not provisioned by **2026-10-01**, stage 1 moves to after 12/10 and the submission ships
  from Vercel as ADR-017 planned.
- **ADR-017's freeze wins.** Stage 1 lands before 2026-10-05 or after 12/10, never in the
  final week. Stage 2 is after 12/10 unless it reaches parity by 2026-10-01.
- **A domain first.** TLS and the Google OAuth redirect both need a hostname we control; the
  `*.vercel.app` name does not move. The product name is still open (execution plan, *Aberto*),
  so a neutral hostname is acceptable for stage 1.

### Access model

No private key is shared between people, and no single person can lock the other out.

- **Oracle Cloud console:** at least two administrators — the tenancy owner and Ronaldo — each
  with their own user and MFA. The tenancy owner's login is never shared.
- **SSH:** one Linux user per person, key-only, with sudo; public keys only on the server
  (Ronaldo's from `github.com/0xcf02.keys`, after he confirms it is the key he wants). The image's
  default `ubuntu` user is kept for automation and removed from interactive use once both
  personal users exist.
- **Service user:** `deploy`, without sudo, owns the application directories and runs the
  services. Deploys act as `deploy`, never as a person.
- **Application secrets** (Supabase keys, `ALLOWED_ORIGINS`, optional `ANTHROPIC_API_KEY`) live
  in root-owned `0600` environment files on the server, read by systemd. The copy both partners
  can reach is a shared password-manager vault — never the repository, never chat.

## Consequences

- We own what the vendors did: OS patching (unattended security upgrades are on), TLS renewal
  (Caddy), **backups** (nightly `pg_dump` off the VM is a stage 2 prerequisite, not a follow-up —
  without it the managed tier was the safer choice), and uptime monitoring, which does not exist
  yet.
- A1 is `aarch64`. Every image and native dependency must have an arm64 build. This must be
  verified for the Supabase self-hosted images, including the Auth version that supports the
  Web3 provider, before stage 2 is scheduled. The micro VM is x86, so nothing built on one runs
  on the other.
- The `claude-cli` chat provider becomes technically possible on a server with a disk, and stays
  off. ADR-017's rule holds: a visitor without a key of their own gets `demo`, never the host's
  subscription or API key.
- `deploy-vercel.md` stays the reference for the managed deployment until stage 1 is cut over,
  then becomes the rollback path. `docs/runbooks/deploy-vps.md` is the runbook for this ADR.
- The Always Free tier has its own reclamation policy for idle compute, and its limits are
  Oracle's to change. The exit is the same Compose file on any VM — the portability that the
  managed stack did not offer.
