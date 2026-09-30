# Session log — 2026-10-01: email-first sign-in, a platform wallet, and the Pro wallet gate

What was built, and the decisions taken along the way that a reader would otherwise have to
reconstruct from the diff. ADRs record decisions that bind the project; this records the
ones that bound a sprint. The binding one here is ADR-024, and it is **Proposed**, not Accepted.

## The brief

Make the hosted dashboard usable without Phantom or Solflare: email magic link (or Google) as the
default door, a Solana wallet provisioned for every account at first sign-in ("embedded-wallet
provider or documented stub + interface"), a balance on the account page, and "connect external
wallet" behind a Pro flag with copy explaining self-custody against the platform wallet. Stop
conditions: signed-out users redirected; an auto-created wallet record (pubkey + provider
metadata); balance without a wallet adapter on the free tier; Pro enables the adapter and links
the pubkey to the profile; env vars documented; tests for the auth guard; no secrets committed.

## What landed

```
 visitor ─► middleware (sign-in-gate) ──no session──► /account (the front door)
                  │                                     ├─ email ─► signInWithOtp
                  │ session                             ├─ Google ─► signInWithOAuth
                  ▼                                     └─ wallet (disclosure) ─► signInWithWeb3
            dashboard pages                                              │
 email link  ─► /auth/confirm  (token_hash, any browser) ─┐              │ POST /api/auth/bootstrap
 PKCE/Google ─► /auth/callback (code, same browser) ──────┤              │
                                                          ▼              ▼
                          ensureAccountForUser (service role, idempotent)
                            account → identity(email|google|wallet) → org → membership
                            → profile → settings → seed → ensurePlatformWallet (best effort)
                                                          │
                                   PlatformWalletProvider ─► stub | <vendor, undecided>
                                                          ▼
                               platform_wallets (1/account, custody none|provider)
                                                          │
 GET /api/account/wallet (user session, RLS) ◄────────────┘
   { accountId, plan, externalWallets, platformWallet, linkedWallets }
      ├─ free ─► "Your balance" card + locked Pro card; header has no wallet button
      └─ pro  ─► ConnectButton ─► "Link" ─► signMessage(linkMessage) ─► POST /api/account/wallet/link
                                              verifyLinkProof ─► linked_wallets (service role)
```

- **Migration** `20261001000000_platform_wallets.sql`: `account_entitlements`, `platform_wallets`,
  `linked_wallets`, all select-own under RLS and none insertable from a user session;
  `identities.provider` accepts `'email'`.
- **Sign-in.** `EmailSignInForm` leads `/account`'s signed-out state, Google second, wallet sign-in
  behind a disclosure. `useAuth().signInWithEmail`. New `/auth/confirm` route. `resolveIdentity`
  handles the `email` provider (subject = auth user id).
- **Provisioning.** `lib/server/wallet-provider` (interface + `stub`),
  `lib/server/auth/platform-wallet.ts` (`ensurePlatformWallet`, plan and wallet reads,
  `verifyLinkProof`), wired into `ensureAccountForUser` for both new and existing accounts.
- **Gate.** `lib/plan.ts` (`canConnectExternalWallet`), `GatedConnectButton` in the header,
  `ExternalWalletCard` (locked or live), `PlatformWalletCard`, and a Pro-specific message in the
  treasury bootstrap wizard.
- **Routes.** `GET /api/account/wallet`, `POST`/`DELETE /api/account/wallet/link`.
- **Docs.** ADR-024, `docs/runbooks/email-login-and-platform-wallet.md`, `.env.example`, a section
  in `packages/dashboard/CLAUDE.md`.
- **Cherry-picked from prod** (`fix/vps-auth-redirect-and-restore`): `bae2f3e` (callback redirects
  to the public origin) and `d4a395e` (signed-out visitors are sent to sign in; 401/403 recovery).

## Decisions, and why

### A stub and a Proposed ADR, not a vendor

The brief allowed either. Choosing a vendor is a custody decision, and two Accepted ADRs stand in
the way of making it in code: ADR-017 says the server never holds plaintext key material, and
ADR-018 chose "generate, show once, keep nothing" and says a kept key would *supersede* it. So the
seam is built — interface, table, `custody` column the UI reads — and ADR-024 lays out the
choice: an embedded vendor (Privy, Turnkey and similar; recommended, with **user key export as a
hard requirement**, since that is the Pro recovery path) or a passkey-wrapped browser key (ADR-018's
second option, which needs the passkey path first). Server-held encrypted keys stay rejected.

### The stub is keyless, and says so

`stub` generates a non-extractable WebCrypto key pair and keeps only the address. Nobody can ever
sign for it, so it is recorded as `custody = 'none'`; the card shows its balance, a warning, and no
"copy to receive". The alternative — any stub that keeps a key — would be server custody through the
back door. An unknown `PLATFORM_WALLET_PROVIDER` throws instead of falling back, so a typo cannot
quietly hand every new user a keyless address in production.

### The plan is not a column on `accounts`

`accounts_update_self` (tenancy.sql) lets a user update any column of their own account row. A
`plan` there would be a self-service upgrade. `account_entitlements` has a select policy and no
write policy; billing and operators write it under the service role.

### The gate is a product tier, and local mode is never gated

Anyone can call `window.phantom.solana.connect()` from devtools; what a wallet can do is decided
on chain. The gate exists so the default path never asks for an extension. Local JSON mode has no
accounts and the extension is its only signer, so gating it would break the tool and protect
nothing. `DASHBOARD_EXTERNAL_WALLETS=everyone` opens the gate per deployment.

### Linking is proven, and stateless

A linked wallet signs a one-line statement naming the account id and a timestamp. The server
compares that account id with the session's, checks the age (5 min), verifies the ed25519
signature, and only then inserts under the service role — RLS cannot check a signature. No nonce
table: a captured signature names the victim's own account, and replaying your own is a no-op.

### `/auth/confirm` beside `/auth/callback`

The stock magic link is PKCE, which needs the verifier cookie of the browser that asked. On a
phone the mail app usually opens the link in its own browser, and the exchange fails. The
token-hash template plus `verifyOtp` works anywhere. The email template itself is set in the
Supabase dashboard, not `config.toml`: `config push` applies everything the file declares.

### A worktree, and prod's redirect instead of a new one

`feat/workstation-shell` had unrelated uncommitted edits to both locale files, so the work went into
`../agent-rails-wt-email-login`. The unauthenticated redirect already existed, tested, on the
branch prod runs; cherry-picking it beat writing a second version that would conflict later.

## Verification

- `vitest`: 41 files, 363 tests, including the `route-guard` sweep (which picked up the new
  `POST`/`DELETE` handlers) and the privileged-surface allowlist. New: plan gate, link-message
  parsing, real ed25519 proofs (wrong account, wrong key, stale, malformed), provisioning
  idempotency and the concurrent-insert race, email identities, `/auth/confirm`, the link route's
  Pro gate and CSRF refusal, the middleware leaving `/auth/confirm` and `/api/account/*` alone.
- `tsc --noEmit` and `biome check` clean.
- `scripts/verify.sh ui`: `next build` + 49 Playwright tests pass. That suite runs with Supabase
  blanked, so it proves local mode did not regress — **not** the hosted flow.

## Not verified, and owed

- A real magic link against a Supabase project, on a phone.
- A real Phantom link on devnet with a Pro account.
- The migration is not applied anywhere.

## Consequences for the next session

- Until a real provider exists, **a free hosted account cannot bootstrap a treasury**: the wizard
  signs with an external wallet. The Colosseum deployment should set
  `DASHBOARD_EXTERNAL_WALLETS=everyone`.
- Accepting ADR-024 means choosing the provider; plugging one in is one `PlatformWalletProvider`
  plus deciding what happens to existing `custody = 'none'` rows (they hold nothing recoverable,
  so re-provisioning replaces them).
- Existing accounts get their platform wallet on next sign-in; there is no backfill.
