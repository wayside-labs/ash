# ADR-017: Hosted dashboard: account/org tenancy, Supabase identity, and client-held secrets

**Status:** Accepted

## Context

`packages/dashboard` was built as a single-user local tool. Its entire state is one JSON
document at `~/.agent-rails/dashboard.json` (`lib/server/store.ts:13`), the seven collections
in `dashboardStateSchema` (`lib/schema.ts:143`) carry no notion of an owner, and the chat
falls back to the host's `ANTHROPIC_API_KEY` (`lib/server/llm/providers.ts:44`) or spawns the
host's `claude` binary. `GET /api/export/runner-config` returns MCP environment in cleartext
by design, because on a laptop that is a convenience.

The product decision is to host it: one URL, outsiders signing in, each with their own
treasuries. Every sentence above becomes a defect under that decision. The state is one
mutable document shared by all visitors and `DELETE /api/state` empties it for everyone; an
unknown visitor spends the host's Anthropic subscription with no concurrency ceiling; the
runner-config route becomes a secret-disclosure endpoint on a guessable URL; and on
serverless the filesystem is ephemeral, so the store does not merely leak — it does not work.

Two constraints frame the choice. The Colosseum submission is 2026-10-12 and the judge is
expected to open the real product rather than a mock, which rules out shipping only a
scripted video. And the program's own thesis — an agent never holds unbounded funds, the
floor is the layer below, not the good conduct of the layer above — is the standard this
backend is measured against: a product arguing that, while holding every user's API key in
its database, refutes itself.

Two external facts constrain the design and were verified rather than assumed:

- Supabase `linkIdentity()` is documented for OAuth providers only. Linking a Solana wallet
  to an account created with Google is not covered, so account identity cannot be delegated
  to Supabase wholesale.
- WebAuthn PRF yields a *symmetric* secret. Wrapping a shared key for a member who is not
  present requires that member's *public* key, which PRF alone does not provide.

## Options considered

- A. Stay local; ship a scripted video for the deadline. No backend work at all, and it
  discards the strongest asset available — a judge who can click.
- B. Host a single-tenant, read-only demo with seeded state. Cheap and safe, and it keeps two
  artifacts in sync during the three weeks the code moves fastest, while proving nothing
  about the product a customer would buy.
- C. Multi-tenant SaaS with server-held secrets, encrypted under a server master key. The
  common shape, and the one that contradicts the thesis the program exists to make.
- **D. Multi-tenant SaaS with account/org tenancy, Supabase identity, RLS as the floor, and
  secrets the server cannot read.**

## Decision

Option D.

### Tenancy

`accounts → organizations → workflows`. Organizations ship as single-member workspaces, but
`org_id` and a `memberships` table exist from the first migration: multi-member is then a
feature, not a migration of seven collections' primary key.

Work hangs off the organization (`workflows`, `agents`, `mcps`, `rag`, `skills`,
`integrations`); identity, secrets and settings hang off the account. The rule is mechanical
— *if two members would need to see it, it belongs to the org; if it is a credential or a
preference, it belongs to the account* — because a rule requiring judgement is relitigated
in every review.

### Identity

Supabase Auth provides both entry points: Google via `signInWithOAuth`, and Solana via
`signInWithWeb3` (the Web3 Wallet provider is off by default and must be enabled). Web3
accounts carry no email or phone; the wallet address is the identity identifier.

Because `linkIdentity()` does not cover wallets, the join is ours: an `identities` table maps
each `auth.users` row to one canonical `account_id`. Several wallets per account is the
expected case, not an edge case — `workflowSchema.ownerAddress` (`lib/schema.ts:32`) already
records which wallet owns a given treasury on-chain, so the model costs a link table and no
change to the workflow shape.

Wallet sign-in is rate-limited but not CAPTCHA-gated. Creating a wallet is free and scriptable,
so the compensating rule is a product rule: an account with no key of its own gets the `demo`
chat provider, never the host's.

### Access path

Route handlers remain the surface, and they act as the user: `@supabase/ssr` carries the
caller's JWT into every query, so RLS is enforced on the connection the request actually uses.
Zod validation and business logic stay in the handlers; the service role is reserved for jobs
and admin paths; realtime, if used, is read-only in the browser.

RLS resolves in two hops — `auth.uid() → identities.account_id → memberships.org_id` — rather
than trusting a JWT claim, which would go stale between linking a wallet and the next token
refresh.

This changes *why* origin checking matters (issue #19). With a cookie-borne session, a
cross-site request carries the session; the check stops being a courtesy on a local port and
becomes the CSRF defence of an authenticated application.

### Secrets

The server never holds plaintext. Enrolling a passkey derives an X25519 key pair from the PRF
output: the private half never leaves the browser, the public half is stored on the account.
Storing the public half now — while every org has exactly one member and nothing is shared —
is what allows org-shared secrets to be wrapped per member later without every existing user
re-enrolling.

Personal secrets are the default. An org-scoped secret is envelope-encrypted: one data key per
org, wrapped to each member's public key. Resolution follows scope: a resource owned by an org
uses the org's key, falling back to the operator's personal key only when the org has none.

A passkey is demanded at the moment the first secret is stored, not at signup, so a visitor
reaches the product before meeting a ceremony. Any linked wallet can unlock as a second path.
With neither, the ciphertext is unrecoverable by design, and the UI says so before the first
secret is saved.

Two consequences follow immediately. `GET /api/export/runner-config` ceases to exist: with the
plaintext in the browser, the client composes the file, and the comment justifying a
server-side route stops being true. And `maskState` loses its purpose — masking exists because
the server holds plaintext it must not return.

Until the passkey path ships, no secret is persisted at all: a user's key lives in their
browser for the session and is sent per request.

### Platform

Vercel Hobby. With Fluid compute its ceiling is 300s, so the chat route's `maxDuration = 120`
fits the free plan; the 60s figure that argued for Pro is the pre-Fluid limit. The constraint
that does bind is contractual — Hobby is restricted to non-commercial personal use — so the
upgrade trigger is written down as *the first pricing page, checkout, or advertised sale*, not
a timeout. State moves to managed Postgres (Supabase) because serverless has no durable disk.
`claude-cli` cannot run there at all (there is no `claude` binary in the runtime); it survives
as a documented development-only provider.

The dashboard stays in `packages/dashboard`, importing `@agent-rails/contract` and the
generated client directly, so `codegen:check` keeps catching drift between the program and the
UI.

### Scope boundary

2026-10-05 is a freeze: if sign-in and per-account state are not standing, the SaaS stops where
it is and the remaining week belongs to the demo, the video and the P1 issues. On 2026-10-12 a
judge signs in to the real deployment, where a seeded demo organization is waiting and the chat
runs in `demo` mode.

The CLI keeps writing its manifest locally (`--out` defaults to a relative `.agent-rails`,
keyed by RPC — the two were never the same file, whatever `store.ts:9` claims). The bridge is
an explicit manifest import in the dashboard, which is also what retires that comment.

## Consequences

- Three route files (`/api/state`, `/api/state/[resource]`, `/api/state/[resource]/[id]`) stop
  serving a global document and start serving rows scoped by RLS; `mutateState` becomes a
  transaction rather than a read-modify-write of one file.
- A policy bug is now a disclosure, and there is no application layer behind it to absorb one.
  RLS policies need tests of their own, which is a better use of the first test battery (#22)
  than `maskState`.
- Issue #19 survives with its threat model rewritten and two items deleted: SSRF is already
  handled in `resolveRpcUrl`, and the runner-config item dies with the route.
- Organizations exist in the schema before they exist in the product. The cost is honest — a
  join nobody needs yet — and it is paid once, instead of a primary-key migration later.
- Losing every passkey and every linked wallet means losing the stored secrets. That is the
  price of the server not being able to read them, and it is stated in the UI rather than
  discovered.
- Hobby's non-commercial clause means the plan becomes a release-gate item: pricing and
  deployment plan change together, or the deployment is in violation on the day it earns money.
