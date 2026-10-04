# ADR-027: Private payouts through Cloak, run in the operator's browser

**Status:** Proposed — 2026-10-04. Numbered 027 because 026 is taken ("Hosted chat runs on the
platform key only").

## Context

Every payment Agent Rails makes is public by construction: `execute_payment` moves value from a
known vault to a named destination, and anyone can read who a treasury pays, how much and when.
For a company whose agents pay vendors and contributors, that is a public supplier list and
payroll. Cloak is a Solana shield pool: a zero-knowledge UTXO set, withdrawals and swaps submitted
by a relay, and viewing keys for reporting. It breaks the visible link between the deposit that
funds a payment and the withdrawal that makes it. The Superteam Brasil Privacy Sprint (Cloak and
Zcash tracks, deadline 2026-10-05 04:00 BRT; plan in
`docs/strategy/privacy-sprint-plano-execucao.md`) is the occasion. The question it forces is how
Agent Rails can offer this without weakening what it exists to guarantee.

Six facts constrain the answer. The first, second and last come from Cloak's documentation and
the SDK source; the others from this repository:

- **The vault cannot be the sender.** Withdrawals, private sends and swaps go through Cloak's
  relay, and each request carries an ed25519 signature over its body from the sender's own wallet.
  The SDK reference says the sender must be the end user's real wallet, never an ephemeral,
  session or service-held key. A PDA signs by CPI and cannot produce that signature.
- **Cloak's interface is its SDK.** The docs list the program's instruction tags and the 264-byte
  public-input layout. Everything else that makes a transaction valid — accounts, ext data, chain
  notes, request authentication, proofs — is built inside `@cloak.dev/sdk`. The program is
  upgradeable: Cloak names a Squads 3-of-4 multisig with a one-hour time lock as its authority.
- **A note has no on-chain destination.** ADR-005's allowlist is keyed by destination wallet owner
  and the program derives the token account itself. A shielded note belongs to a key chosen by
  whoever builds the proof, and the note goes wherever that key's holder says.
- **The trigger is an LLM reading untrusted text.** The chat is tool-less by design and by test
  (its requests carry no `tools`). ADR-007 keeps spending capabilities off the agent surface and
  ADR-025 rejected a service-held desk key for that reason.
- **No secret may be stored.** ADR-017: until the passkey vault ships, no secret is persisted at
  all, and there is no encrypted store to put one in.
- **No devnet.** The published SDK targets mainnet only; Cloak's devnet program is served by a
  local-only fork that is not in the npm package. Like SODAX (ADR-025), this cannot be exercised
  on a test cluster.

## Options considered

- **A. The vault PDA deposits into Cloak by CPI and the program drives the withdrawals.** Keeps
  custody in the vault until the deposit. It reverses ADR-001 (the program CPIs only into SPL
  Token, Token-2022, the ATA program and System), ties the program to an interface its owner can
  change behind a one-hour time lock, and cannot authenticate the relayed withdrawals, because a
  PDA cannot sign the request. It also lets the agent choose the note owner: whoever picks the key
  that owns a note decides where the money goes next, which collapses the destination allowlist
  that is the reason the vault exists. Rejected.
- **B. A desk key held by a server or connector, signing for Cloak on the operator's behalf.** The
  shape ADR-025 rejected as its option B: a spending key inside a service that an LLM-driven chat
  steers, against ADR-017 (the server never holds plaintext secrets) and ADR-007 (no spending
  capability on the agent surface). Between the model's output and the key there would be only
  our own validation. Rejected.
- **C. The operator's browser runs the Cloak SDK with their own wallet; keys are derived from a
  wallet signature and every note is created in a form a scan can rebuild.** The model only
  proposes; a person approves each run on a card and again in the wallet, one prompt at a time.
  Chosen.
- **D. Random notes, persisted encrypted or handed to the operator as a recovery file.** Would
  stop the viewing key from being spend authority over deposit notes, which removes the trust
  described in Consequences. Rejected for v1: the encrypted store is ADR-017's passkey path, which
  does not exist; a recovery download depends on the operator saving a file; and a tab that closes
  between the SDK returning a note and the note being saved strands the funds, the failure Cloak's
  own documentation warns about for notes that cannot be rebuilt.

## Decision

C. The pieces, and why each is built the way it is.

**The model proposes, the contract validates.** The chat emits a fenced `template-run` block.
`@agent-rails/contract/template-run` parses it with a strict schema (an unknown field is refused,
and there is no network field, so the model cannot pick one) and the dashboard renders it as an
approval card, the pattern the connector card already uses. Client code imports the contract
through that subpath, never the package root, which pulls `node:crypto` into a browser bundle.
The caps are constants of the template, not fields of the proposal.

**The browser executes.** `@agent-rails/cloak` plans the run, checks the policy and drives it
through injected ports (SDK, wallet, clock, event sink). The Cloak SDK is a dynamic import that
loads when a run starts, because the proving system is large. A run is `preflight` (balance, RPC,
proving files, relay, a ZEC quote), `derive-keys`, `shield` (one deposit, equal to the sum of the
payouts), one `payout` per payee and `report`; `recover` is a separate, explicit action. A SOL
payout is a partial or full withdrawal. A ZEC payout is a private swap of SOL into the verified
wrapped ZEC mint (`A7bdiYdS5GjqGFtxf17ppRHtDKPkkRqbKtR27dxvQXaS`), bounded below by a Jupiter quote
minus 2%. Events and the proof pack are public by construction: strict schemas, and error codes in
place of upstream messages, which can quote an address or a request body.

**Keys come from the wallet; nothing secret is stored.** The wallet signs a fixed, domain-separated
message that names the funder and says what the signature is worth. HKDF-SHA-256 turns the
signature into a master seed, and the SDK's `deriveSpendKey`, `deriveUtxoKeypairFromSpendKey` and
`getNkFromUtxoPrivateKey` turn the seed into `nk`, the viewing key everything else hangs from. The
first run on a device signs twice and stops if the two signatures differ: a wallet that is not
deterministic would derive other keys next time and strand whatever was shielded under the first
set. Deposit notes are made with `createRecoverableDepositUtxo`, and change notes by
`partialWithdraw` and `swapWithChange` in recoverable form, so `scanTransactions` with `nk`
rebuilds what a lost tab held. The browser keeps only public records in `localStorage`: the
signatures of finished steps, a flag for a deposit that may have landed with no signature to cite,
and a 16-hex-character fingerprint that is a hash of `nk`. A different fingerprint stops the next
run before anything is shielded (`keys_mismatch`). The key a log is stored under is a digest of the
payouts, not the payouts, so an address is not left readable in storage.

**A soft policy the model cannot touch.** Per payee 0.01 to 0.05 SOL (0.01 is Cloak's own minimum),
at most 0.10 SOL and four payees per run, no duplicate (address, delivery) pair, the ZEC mint
fixed, no payee equal to the funder (paying yourself through the pool recreates the link it
exists to hide), and a list of reserved addresses refused on sight: the System Program, the
incinerator, the token and associated-token programs, other well-known programs, sysvars and
mints, Cloak's program and the ZEC mint. A list cannot name everything, so before anything is
shielded the runner asks the chain who owns each payee and stops unless it is a wallet account or
does not exist yet. A ZEC payout must also leave at least 0.01 SOL to swap once the exit fee is
taken (about 0.016 SOL gross): a swap under Cloak's floor is refused after the deposit has moved,
so it is turned away while nothing has. A run needs `NEXT_PUBLIC_CLOAK_MAINNET=1`
and the connected wallet listed in `NEXT_PUBLIC_CLOAK_ALLOWED_WALLETS`; an empty or unparseable
list allows nobody. The RPC is `NEXT_PUBLIC_CLOAK_RPC_URL`. All three are public variables,
inlined into the bundle at build time.

**A narrow exception to "mainnet is refused in the UI".** `packages/dashboard/CLAUDE.md` says the
dashboard refuses mainnet. This template runs on mainnet whatever cluster the dashboard has
selected (devnet by default), and only this template does. It is off unless the flag is set, and
then limited to listed wallets.

**Nothing else moves.** No program change. No new API route: the browser calls the RPC, Cloak's
relay and Jupiter directly, so `route-guard.test.ts` and the global rate limiter are untouched.
Nothing in `packages/mcp` or `packages/contract/src/mcp-tools.ts`, so the agent surface stays at
seven tools, and the chat request still carries no `tools`. The dashboard's own source names no
instruction builder, so `privileged-surface.test.ts` is unchanged; the builders live inside the SDK.

**One transaction of our own, for a proof of existence.** Right after the deposit the runner can
send a standalone transaction whose only instruction is the SPL Memo program's, carrying a SHA-256
of the template's privacy text: a commitment made before the text is submitted, which the
submission then reveals (`packages/cloak/src/verify-hash.ts` checks the two against each other
with nothing installed). It is deliberately separate from every Cloak transaction: the SDK builds
the deposit and the relay builds each withdrawal, so a memo cannot ride in them, and a transaction
of our own cannot disturb a payout whatever happens to it. It moves no funds, costs about 0.000005
SOL, adds one wallet prompt, and a failure to write it is reported and never stops the run.

**Not a vault flow.** It bypasses `execute_payment` and `IntentReceipt`, as ADR-025's desk flows
do, and the audit chain does not see it. The "desk" is the operator's own mainnet wallet, funded by
the operator, not by a vault. The record of a run is the proof pack: signatures, amounts and
addresses.

## Consequences

- **The relay can, in principle, rebuild the keys of our deposit notes.** In the SDK a deposit
  note's spend key and blinding derive from `(nk, salt)` (`deriveDepositNoteSecrets`); the salt
  travels in the chain note, which `nk` decrypts; and a change note keeps the owner key of the note
  it came from, so every note in a run descends from one `nk`-derived key. The SDK also registers
  `nk` with Cloak's relay before its first transaction: `POST /viewing-key/register` carries the
  `nk` itself. The viewing key is therefore not merely read-only for the notes this template
  creates. We accept that trust, for these amounts, because the relay is already trusted for
  submission and already sees sender and recipient; the cap of 0.10 SOL a run (0.05 a payee) is
  what bounds the cost of the extra trust. The accountant or auditor receives the CSV and never
  `nk`. No UI string, proof or document may say the viewing key stays only in the browser; the
  proof pack's notes say the relay receives it, and that is the wording to follow.
- **ADR-017 is kept to the letter.** No secret is persisted. Derived keys live in memory for the
  length of a run; the seed and the key bytes the adapter holds are zeroed when it ends, though the
  wallet's signature and some intermediate strings are JavaScript values that cannot be. What
  replaces storage is the wallet signature, and
  it is the root secret: anyone who obtains it can rebuild the keys, which is why the message says
  so and why the leak test searches every output for it. The price is a wallet that signs
  arbitrary messages deterministically (`wallet_cannot_sign_messages`, `keys_not_deterministic`)
  and a fresh derivation each session. When the passkey vault ships, option D becomes available.
- **Resume and Recover are different actions, and both have two dependencies.** The log of
  finished steps is the browser's own `localStorage`; it is what stops a re-run from shielding or
  paying twice, and on another device or after clearing site data a re-run starts from a new
  shield, so Recover is the way home. *Resume* rebuilds only the notes that descend from this run's
  deposit and compares what is left with what the unpaid payouts are owed: less means a payout
  landed without being recorded, and the run stops (`outcome_unknown`) instead of repeating it.
  When the SDK reports a spend as landed after losing its reply, the runner records that signature
  so a resume does not repeat the step. A deposit that fails in a way that cannot say whether it
  left the wallet is marked uncertain, and a new run is blocked until a recovery has looked.
  *Recover* sweeps everything the keys rebuild, the refund of a swap that timed out included, back
  to the funding wallet; when the log names a deposit and the scan finds nothing, that is a stop
  and the log is kept. A scan returns notes without their leaf index and change notes with a zero
  private key, so each note is given its index from the relay's commitment list and each change
  note its owner's key from the deposit it descends from, or it is left out rather than guessed
  at. Rebuilding notes also needs an RPC that still serves the transactions: on 2026-10-04
  PublicNode served Cloak's transactions up to about 19 hours old and returned nothing at 23,
  while Solana's public RPC keeps the full history and answers 403 to a browser origin. The
  provider behind `NEXT_PUBLIC_CLOAK_RPC_URL` matters for resume and recover, not only for rate
  limits.
- **One run at a time per wallet.** Two cards, or two tabs, for one wallet would each shield a
  deposit and spend notes the other counts on. A lock per wallet (`navigator.locks`, with a flag in
  memory where it is missing) refuses the second, the browser is asked before a running page is
  left, and a card that unmounts mid-run does not stop it: stopping would only strand the funds a
  step earlier. What a run leaves behind is the log; the chat history is not persisted, so after
  navigating away the card returns only when the same payouts are asked for again, and finds its
  log.
- **The numbers on the card are the numbers that run.** The ZEC quote bounds the swap, so it is
  fetched again at the moment of approval; if it moved by more than 1% the card shows the new
  floor and asks again (`quote_moved`). The fee shown is the schedule the SDK documents. The SDK
  reads the pool's live configuration when it builds a proof and refuses a fixed fee above twenty
  times the default, so a changed fee reaches the payee as a smaller net, never as a larger
  charge than the proof binds; the first mainnet run measures what was really paid.
- **The policy is soft.** The caps and the allow list are code and configuration in the operator's
  own browser. They bind the model, which cannot raise them, and they make a mistake loud. They
  do not bind the operator: a person with the wallet and the SDK can run anything the SDK allows.
  The card, this ADR and the docs say "soft" for that reason. ADR-005's on-chain ceilings do not
  apply, since there is no Treasury, Policy or session here, and nothing on the card may read as
  if they did.
- **A mainnet transaction can start from a devnet dashboard.** The exception is therefore visible
  where it happens: the flag, the allow list, a red mainnet seal and two confirmations on the
  card. ADR-021's wave 2A amendment keeps mainnet out of the browser for the treasury wizard
  "until someone decides otherwise on purpose"; this is that decision for one template and does
  not reopen the wizard. ADR-011's phases concern the Agent Rails program on mainnet; this flow
  deploys nothing and touches no Agent Rails account.
- **Privacy limits that hold whatever the code does.** Deposit and withdrawal amounts and times
  are public, and so is the funder's deposit. Cloak's relay authenticates the signing wallet,
  receives its viewing key and sees sender and recipient, and Cloak screens the sending wallet, so
  a flagged wallet can be refused. The proof pack lists the payees' addresses on purpose, so a
  judge can check the run. ZEC delivered on Solana is an ordinary SPL token. Anonymity depends on
  pool activity.
- **Cost.** Each payout pays Cloak's exit fee, 0.005 SOL plus 0.3% of what leaves the pool
  (5,060,000 lamports on 0.02 SOL); deposits are free; 0.01 SOL is the minimum for a shield and, read on
  what is left after the fee, for a swap. A full run asks the wallet for roughly six to nine signatures.
- **The audit gate gets worse.** `pnpm audit --prod` is already red because of `@sodax/sdk`
  (ADR-025). `@cloak.dev/sdk` 0.2.5 adds a large transitive tree, and an `npm audit` of the SDK
  alone reported 19 high-severity findings, among them advisories against `axios`,
  `bigint-buffer`, `toml` and `ws`. That figure is npm's, not the pnpm gate CI runs; the pnpm
  figure is recorded in the review log below. Containment is
  ADR-025's: the SDK lives in `packages/cloak` and loads by dynamic import from client code when a
  run starts; no server route needs it.
- **Tests stop short of the real thing.** The planner, the policy, fees, keys and the runner are
  tested against injected ports, with a failure injected after every step. Fee parity is checked
  against the real SDK's `calculateFeeBigint`, so a Cloak release that changes the fee fails a
  test instead of putting a wrong number on the card. A leak test runs a whole run against a fake
  SDK that knows its own secrets and fails if any of them, or the wallet's signature in hex or
  base64, appears in an event, the proof, the CSV, the log or the console. Recovery is tested
  against the real SDK's note primitives, nullifiers and `verifyUtxos`, with only the network
  stubbed, because a fake that returns tidy notes cannot show what a scan really returns.
  Playwright covers the card with a fake SDK. Nothing in CI reaches a real run, because there is no devnet: a real run
  is person-run with small amounts, through the `smoke` script and the card, as with ADR-025. That
  the SDK, the relay and Phantom behave in the browser as they do in Node is known only by doing
  it.

### What would supersede or revisit this

- Cloak separating spend authorization from `nk`. The SDK's `ExpandedSpendKey` already marks
  `ask`, spend authorization, as "future". Once it lands, registering `nk` with the relay stops
  being spend authority, the trust above disappears and the caps can be reconsidered.
- ADR-017's passkey vault shipping. Option D becomes possible: random notes stored encrypted,
  `nk` no longer a spend key, and recovery no longer resting on a deterministic wallet signature.
- A vault-native private payment, if one is ever designed. It needs its own ADR and has to answer
  the note-owner problem of option A first; this ADR does not preclude it.
- The first mainnet runs. The open items are listed in `docs/product/cloak-private-payout.md`:
  whether the relay opens the payee's ZEC token account (both payees of the first run are
  accounts that do not exist yet), how many wallet prompts a run really takes, whether Phantom's
  own edits to a transaction disturb the SDK's checks, what a swap refund looks like, and
  resuming and recovering against a real chain: the re-keying and the leaf lookup are tested
  against the SDK's own primitives, not against mainnet. A finding that contradicts a claim here is an amendment, not a
  silent edit.
- Whether the template stays in the product after the sprint. The flag is off by default; keeping
  or removing it is a product decision this ADR does not make.

## Review log

2026-10-04, before the first mainnet run: an adversarial review of the working tree found, and
this ADR now reflects, the following. Fixed: recovery could not work with the real SDK (no leaf
index, change notes with a zero key) and reported success on an empty result; the SDK's own
"landed" and "outcome unknown" signals were read as generic failures; a deposit that failed
ambiguously could be repeated; a stale Merkle tree was reused after a swap; the run log was
rebuilt from events and could lose a signature; the quote could change between approval and
click; the reserved-payee list was short; the fence scanner was quadratic on hostile text. The
statement that the viewing key never leaves the browser was wrong and has been removed
everywhere. Not fixed, on purpose: the fee on the card is the SDK's schedule and not the pool's
live configuration; the key-derivation message is not bound to an origin, because binding it
would stop a run started on one host (local) from being recovered on another (the VPS); and
there is no entry outside the chat card for a run left pending.

Audit, measured the same day with `pnpm audit --prod --registry https://registry.npmjs.org` (the
default mirror has no audit endpoint, so the gate cannot run there): 21 high findings, no
critical, 32 moderate, 2 low. Nineteen of the high ones arrive through `@sodax/sdk` (ADR-025); two
through `@cloak.dev/sdk` 0.2.5, both denial-of-service advisories against its dependencies
(`ws` below 8.21.0, memory exhaustion from tiny fragments; `underscore` through 1.13.7, unbounded
recursion). The SDK loads in the operator's browser, where `ws` is not the transport, and no
server route imports it.

