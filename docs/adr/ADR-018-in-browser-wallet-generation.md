# ADR-018: In-browser wallet generation, shown once and never held

## Context

ADR-017 gave the hosted dashboard two doors: Google via `signInWithOAuth`, and Solana via
`signInWithWeb3`. It also anticipated the account that walks in through the first door with no
key at all — *"an account with no key of its own gets the `demo` chat provider, never the
host's"* — and made that the compensating rule for wallet sign-in being free and scriptable.

That rule keeps a keyless visitor safe, but it does not make them a user. Everything the
product is for — a treasury, a policy, a session an agent spends under — starts with a wallet
that owns something on chain. A person who signs in with Google and has never held SOL today
reaches a dashboard that can only show them a demo. The nearest instruction the product can
give is "go install a wallet extension, come back, and connect it", which is the point in the
funnel where a first-time user leaves.

Three facts constrain any answer.

ADR-017 §Secrets already decided how client-held key material works here: a passkey's PRF
output derives an X25519 pair, the private half never leaves the browser, and — decisively —
*"until the passkey path ships, no secret is persisted at all"*. No passkey code exists yet.
There is therefore no sanctioned place to store a generated key.

The product's own pitch is that it does not custody. Agents pay from a program-owned vault
precisely so nobody has to trust a third party with unbounded funds, and the owner is a wallet
the owner already controls. A dashboard that mints keys and keeps them is a different product
with a different threat model.

And `workflowSchema.ownerAddress` records which wallet owns a treasury on chain. That field is
a label, not an authority: the program enforces ownership against the pubkey in the on-chain
account. Whatever we generate has to end up somewhere that can actually sign.

## Options considered

**Connect only.** Enable `signInWithWeb3`, offer nothing else, leave keyless accounts in demo
mode. Smallest, entirely within ADR-017, and leaves the funnel exactly where it is.

**Generate and keep, encrypted under the passkey.** The dashboard becomes a usable wallet: it
holds the key, wrapped by the ADR-017 mechanism, and signs. This is the only option that makes
the generated key useful *inside* the product — and it requires shipping the passkey path
first, changes what the product custodies, and lands after the 2026-10-05 freeze.

**Generate, show once, keep nothing.** The browser produces a BIP-39 phrase, displays it under
the same guards a wallet uses, and forgets it. To spend, the user imports the phrase into a
wallet they choose and connects it back. Nothing is persisted, so nothing in ADR-017 has to
move.

## Decision

Generate, show once, keep nothing.

The phrase is twelve words, 128 bits, from `@scure/bip39`. The address shown beside it is
derived at `m/44'/501'/0'/0'` — the path Phantom, Solflare, Backpack and `solana-keygen` all
treat as account 0. That path is the entire contract with the user: it is what makes the
phrase import into *whichever* wallet they already trust and show the address we promised. It
is covered by tests whose vectors come from `solana-keygen recover` (Agave 3.1.14), not from
our own code, because a derivation that agrees only with itself hands the user a phrase that
opens an empty account somewhere else.

Nothing is written to `localStorage`, to the store, or to the server. The generated key exists
as React state for the life of the dialog. Closing it is the end of the key.

Revealing follows the ceremony wallets converged on, for the reason they converged on it: the
threat at this moment is a camera, a shoulder, or a screen share, and none of those are stopped
by anything technical. The phrase is blurred by default; revealing it is a deliberate second
action behind a warning that names those three; the user confirms they have somewhere private
to write it before any word is legible.

A `.txt` export is offered, behind its own warning. This is a departure from Phantom, which
offers no such button, and the warning is where the departure is paid for: the download folder
is usually replicated to iCloud, Drive or OneDrive and indexed by desktop search, so the
warning says that, and the user confirms it before the file is written.

The prompt to do any of this appears once, after a Google sign-in, to an account with no
wallet connected. Its third option is "not now", and dismissal is remembered, because a product
that asks again every visit teaches people to click past warnings.

## Consequences

A user who takes this path cannot sign from the dashboard. They hold a phrase and an address;
to use either, they import into a wallet and connect it back. The UI has to say so at the
moment it hands the phrase over, or the feature reads as a wallet and is not one.

If we later choose the second option — key kept, wrapped under a passkey — this decision is not
in the way. The generation and the reveal are the same; what changes is that the key also gets
encrypted and stored, and that supersedes this ADR rather than contradicting it.

Two new runtime dependencies enter the dashboard: `@scure/bip39` and `micro-key-producer` for
SLIP-0010 ed25519 derivation. Both are from the audited noble/scure family that the Solana
client stack already leans on. Neither is hand-rolled cryptography, and neither should ever be
replaced by hand-rolled cryptography.

The phrase reaches the clipboard if the user asks, and clipboards are readable by other pages
and often synced across devices. The copy button clears it after thirty seconds, which is a
mitigation and not a fix, and the UI does not pretend otherwise.

We are generating key material in a web page. That is strictly worse than an audited extension
generating it in an isolated process, and it is worth saying plainly: this exists for the user
who would otherwise have no key at all, not as a recommendation over the wallet they already
have. The prompt offers "connect" first for that reason.
