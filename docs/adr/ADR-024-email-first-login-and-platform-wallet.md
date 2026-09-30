# ADR-024: Email-first sign-in, a platform wallet per account, self-custody wallets as Pro

**Status:** Proposed — the interface, the stub and the gate are built; the custody model behind
the interface (§Open decision) is not chosen, and this ADR is not Accepted until it is.

## Context

ADR-017 opened two doors, Google and a Solana wallet. ADR-018 then met the Google user who has
no wallet with a phrase shown once and kept nowhere: honest, and still a dead end for the
person it was for, because to *see a balance* they must install an extension, import twelve
words and connect it back. On a phone there is no extension to install.

The product target is the opposite shape: sign in with an email, see a balance, talk to the
agent — the simplicity of a consumer bank account, with chain vocabulary one click further in
rather than on the first screen. Power users who already hold a wallet keep using it.

What must not move:

- **The program's thesis.** Agents never hold unbounded funds; they spend from a program-owned
  vault under on-chain limits. Nothing here gives an agent, or the MCP surface, a new tool
  (ADR-007, ADR-021). The privilege split is untouched.
- **ADR-017 §Secrets.** The dashboard's server never holds plaintext key material. A platform
  wallet whose private key sits encrypted-under-a-server-key in our Postgres is option C of
  ADR-017, rejected there, and stays rejected.
- **No commingling.** One wallet per account. The platform never pools balances, never moves
  one account's funds to another, and never signs for an account without that account's
  session in the request.

## Options considered

**A. Keep ADR-018 as is.** Zero custody change; the funnel stays where it is.

**B. Embedded-wallet vendor.** Privy, Turnkey, Dynamic, Crossmint and similar provision a
wallet per user through an authenticated server API and keep the key in a TEE or split across
MPC shares, signing only on the user's authenticated request. The dashboard stores a public key
and a vendor handle. This moves trust to the vendor, not to us, and it is the only option that
works on a phone on day one. Selection criteria: user-initiated **key export** to self-custody
(the Pro recovery path), Supabase JWT accepted as the user's authentication (no second login),
Solana devnet support, and pricing at hackathon volume.

**C. Passkey-wrapped client key.** ADR-018's second option: generate in the browser, wrap under
the passkey PRF key of ADR-017, store only ciphertext. Consistent with every existing decision
and vendor-free, but it needs the passkey path first, and losing every passkey loses the wallet.

**D. Server-held encrypted keys.** Rejected by ADR-017; listed so it is not re-proposed.

## Decision

1. **Magic link is the default door**, Google the second, wallet sign-in stays but moves behind
   a disclosure. `/auth/confirm` verifies a token hash so a link opened in a phone's in-app
   browser works; `/auth/callback` keeps serving the PKCE path. A magic-link identity's subject
   is the auth user id (`identities.provider = 'email'`).

2. **Every account gets a platform wallet record at first sign-in** — `platform_wallets`, one
   row per account, holding the public key, the provider, the vendor handle and a `custody`
   value the UI reads before offering anything that would send funds there. Provisioning runs
   inside the existing idempotent bootstrap, best effort: a provider outage leaves the wallet
   pending, never the account locked out.

3. **Provisioning is behind `PlatformWalletProvider`**, selected by `PLATFORM_WALLET_PROVIDER`.
   The only implementation is `stub`: a valid address whose key is generated non-extractable and
   discarded, recorded as `custody = 'none'`. The UI shows its balance, warns that nothing sent to
   it can be moved, and offers no receive action. An unknown provider name fails loudly.

4. **Self-custody wallets are Pro.** The plan lives in `account_entitlements`, readable by the
   account and writable only by the service role — not on `accounts`, whose self-update policy
   would make Pro self-service. `DASHBOARD_EXTERNAL_WALLETS=everyone` opens the gate per
   deployment; local JSON mode is never gated. This is a product tier, not a security boundary:
   the program decides what any wallet may do.

5. **A Pro wallet is linked to the account by proof**: it signs a one-line statement naming the
   account id and a timestamp, the server verifies the ed25519 signature against the session's
   account, and only then inserts into `linked_wallets` under the service role.

## Open decision

B or C behind the interface. The recommendation is **B for the hosted product with export as a
hard requirement**, because C cannot ship before the passkey path and the target user is on a
phone. Choosing it adds one `PlatformWalletProvider`, changes `custody` for new rows to
`provider`, and needs a decision on what happens to existing `custody = 'none'` rows (they hold
nothing that can be recovered; re-provisioning replaces them).

## Consequences

- Accepted, this supersedes ADR-018's prompt for hosted free accounts: they get a platform
  wallet instead of a phrase. Pro accounts and local mode keep the ADR-018 flow unchanged.
- **Until a real provider exists, a free hosted account cannot bootstrap a treasury** — the
  wizard signs with an external wallet. A deployment that must demo the bootstrap to free
  accounts sets `DASHBOARD_EXTERNAL_WALLETS=everyone`.
- Existing accounts receive their platform wallet on their next sign-in, through the same
  bootstrap; nothing is backfilled by migration, because a migration cannot call a vendor.
- Three tables join the RLS surface, all select-own, none insertable from a user session; the
  one user-session write is `linked_wallets` delete (unlink).
- A vendor under option B is a new party in the trust story. The pitch changes from "nobody but
  you holds the key" to "a named custodian holds the key for the platform wallet; your vault and
  your agents' limits are on chain either way", and the product copy has to say so.
