# Private payout desk (Cloak + Zcash)

Pay a vendor or a contributor in SOL, or in ZEC, with no public link between your wallet and
theirs. You ask in the dashboard chat; the model only drafts; you approve a card and then your own
wallet; your browser shields the funds into Cloak's pool and pays each payee out of it.

> **MAINNET. REAL FUNDS. NOT A VAULT PAYMENT.** This is the one template that runs on Solana
> mainnet, from *your own wallet*, with money you can lose. It is off by default, limited to wallets
> you list, capped at 0.10 SOL a run, and its policy is **soft**: it binds the model, not you. Use
> a throwaway wallet. Nothing here goes through the ASH program, so no treasury ceiling,
> policy, session or audit chain applies. Read [ADR-027](../../../docs/adr/ADR-027-private-payouts-through-cloak-in-the-operators-browser.md)
> and [the product doc](../../../docs/product/cloak-private-payout.md) before the first run.

Unlike the other templates, this one is not docs and config alone. It adds a package
(`packages/cloak`) and a contract module (`@ash/contract/template-run`), and it is
triggered from the dashboard chat. It adds no program instruction and no MCP tool: the agent
surface stays at seven tools.

## What would go wrong without it

Paying people from a company wallet writes a line in a public ledger for each of them: who, how
much, when. Anyone can rebuild your supplier list and your payroll from one address. Put an agent
in charge of the paying and a second problem arrives: a model that reads invoices, listings and
forum posts can be talked into paying a different address, and a key it can reach will oblige.
Here:

- **The model cannot sign.** It writes a proposal as text. It sees no key and no note, picks no
  network, and has no tool: the chat request carries none.
- **A person sees every full address first.** The card shows each payee's full address, the fee and
  what arrives, behind a red mainnet seal and two confirmations. A swapped address is on screen
  before anything moves.
- **The caps are not the model's to change.** 0.01 to 0.05 SOL a payee, 0.10 SOL and four payees a
  run, a fixed ZEC mint. They are constants of the template, not fields of the proposal.
- **There is no hot key to leak.** The keys are derived from a wallet signature each time and
  stored nowhere; the browser keeps only signatures and a fingerprint.
- **The pool unlinks the deposit from the payouts.** On-chain there is a deposit, and later
  withdrawals from a shared pool; not which became which.

What it does not do is in [Honest limits](#honest-limits). The short version: amounts and times
stay public, Cloak's relay sees you, and the policy is soft.

## Roles

```
 chat model          proposes           you             approve            your browser
 (text only)  ─▶  template-run block ─▶  payout card ─▶  wallet prompts ─▶  @ash/cloak
 no key, no tool     JSON, validated    full addresses     one per step       derives keys in memory
                                        fees, MAINNET      you sign each      stores nothing secret
                                                                                   │
                                          deposit (public) ◀─────── shield ────────┤
                                          Cloak pool                               │
                              payee A: SOL ◀── relayed withdrawal ◀────────────────┤
                              payee B: ZEC ◀── relayed private swap (verified mint)┘
```

| Role | What it is | Holds a key? | Can move funds? |
|---|---|---|---|
| Planner | [`agents/payout-planner.md`](agents/payout-planner.md): the chat model | No | No. It proposes. |
| Operator | You | Your wallet app does | You approve the card, then every wallet prompt |
| Desk | **Your own mainnet wallet** (next section) | Yes, in your wallet app | Signs the shield and authenticates each relayed request |
| Runner | `@ash/cloak`, in your browser | Derives keys in memory, zeroes them, stores none | Only after you approve |
| Cloak relay | `https://api.cloak.ag` | Receives your viewing key | Submits the withdrawals and swaps |

## The desk is your own wallet

In the other templates the desk is a wallet the vault pays, and a separate, human-signed step acts
from it. Here there is no vault: the **desk is the operator's own mainnet wallet**. You fund it,
it signs the deposit into Cloak, and its signature authenticates each request the relay submits.
The vault, which lives on devnet, never sees it.

That is why the advice is blunt. Use a **throwaway wallet** holding about 0.1 SOL. Do not use the
owner or operator key of any treasury, a CI key, or anything you would mind losing: the caps limit
how much one run can move, not what a wallet that has been connected to a site can lose elsewhere.

## Setup (mainnet)

1. **A throwaway wallet** with about 0.10 SOL. The two-payee demo run needs at least 0.06 SOL (the
   0.04 SOL shield plus a 0.02 SOL network buffer); 0.10 leaves room to retry.
2. **One or two fresh payee addresses** of yours. The template refuses a payee equal to the funder.
3. **A mainnet RPC that answers browser origins.** Solana's public endpoint answers 403 to a
   browser. PublicNode (`https://solana-rpc.publicnode.com`) needs no signup and is the dashboard's
   default; it keeps only about a day of history, which is enough for a run and not for resuming
   or recovering a day later. For a recorded run use a provider with full history and list the
   dashboard's origin in its allowed origins. CORS is the provider's setting, never the VPS's.
4. **The three public variables**, then rebuild. They are inlined into the bundle at build time:

   ```bash
   # packages/dashboard/.env.local (local) or /etc/agent-rails/dashboard.public.env (VPS)
   NEXT_PUBLIC_CLOAK_MAINNET=1
   NEXT_PUBLIC_CLOAK_ALLOWED_WALLETS=<FUNDER_WALLET>
   NEXT_PUBLIC_CLOAK_RPC_URL=<MAINNET_RPC_URL_THAT_ANSWERS_BROWSER_ORIGINS>
   ```

   `NEXT_PUBLIC_CLOAK_ALLOWED_WALLETS` is a comma- or space-separated list of base58 addresses; an
   entry that is not an address is dropped, and an empty list allows nobody. Without
   `NEXT_PUBLIC_CLOAK_MAINNET=1` the card explains the template is off and Run stays disabled.
5. **A dry run from a terminal first.** It is the default and signs nothing:

   ```bash
   pnpm --filter @ash/cloak build
   node packages/cloak/dist/smoke.js --keypair <FUNDER_KEYPAIR.json> \
     --payee-sol <SOL_PAYEE> --payee-zec <ZEC_PAYEE>
   ```

   (`pnpm cloak-smoke <flags>` at the repo root runs the same file.)

   It prints the plan, whether the RPC, Cloak's proving files and the relay answer, the balance, and
   the exact message the wallet would be asked to sign. Add `--confirm-mainnet` to run for real.
   Flags, exit codes, resume and `--recover` are in the
   [product doc](../../../docs/product/cloak-private-payout.md#from-a-terminal-the-smoke-script).

`policy.example.json` states the same limits for a reviewer. As in every template, no tool reads
it: the variables above and the constants in `packages/contract/src/template-run.ts` are what apply.

## Running one payout

1. Connect the throwaway wallet in the dashboard header, on mainnet. It must be on the allow list.
2. Ask in the chat, for example: "pay 0.02 SOL to `<SOL_PAYEE>` and 0.02 SOL in ZEC to
   `<ZEC_PAYEE>`". A model without an address should ask for it. The schema only checks that an
   address is well formed, so the card is where you catch a wrong one.
3. Read the card. Check **every address in full**, the fees and the total balance needed. Tick
   both confirmations and press **Approve and run**.
4. Approve each wallet prompt: expect roughly seven to ten for two payees (the first is the
   key-derivation message, which moves nothing; one more signs the proof-of-existence memo
   described below). The timeline fills with explorer links.
5. Download the proof pack and the CSV. A run that stops after the shield can be resumed (run it
   again) or recovered (everything spendable returns to your wallet, which re-links that amount).

What the run does, step by step, and what to do when it stops:
[the product doc](../../../docs/product/cloak-private-payout.md#the-flow).

## What you keep

- **Proof pack** (JSON, public data only): every signature, who paid, who was paid and the fees,
  and the signature of the commitment transaction when one was written.
  [`PROOF.md`](PROOF.md) explains each field and how a reader checks a run on an explorer,
  including what "no direct link" means.
- **CSV** from the viewing key: the accountant's file. It names the payees and the amounts, which
  is what the pool hides from everyone else, so it goes to the accountant and nobody more.
- **Privacy text and video script** for the Privacy Sprint submission:
  [`PRIVACY.md`](PRIVACY.md) (Portuguese, under 300 words), [`PRIVACY.en.md`](PRIVACY.en.md),
  [`VIDEO.md`](VIDEO.md).

## Proof of existence: commit, then reveal (for the Privacy Sprint judges)

> **Status: not written on mainnet yet.** This section describes the commitment the runner sends.
> The table below stays empty until a real run has produced it; fill it in, remove this note, then
> submit. Never paste a signature a run did not produce.

The privacy text in [`PRIVACY.md`](PRIVACY.md) (Portuguese, under 300 words) is the text that was
submitted. Before it was submitted, a **SHA-256 of it was written on Solana mainnet**, in a
transaction of its own. That is the commitment; the submission is the reveal. Anyone can hash the
text again and compare it with what the chain holds. If a single character of the text had been
edited after the commitment, the two would differ.

**The transaction.** One instruction, for the SPL Memo program
(`MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr`), signed and paid for by the funder wallet. Its
memo is exactly:

```
agent-rails/privacy-text/v1 sha256=331f0b7a354c8f18dfbbc71d25d5d3f99d23c74797fde752446a23e0c0313148
```

**Where it comes from.** The runner sends it right after the Cloak deposit, as a standalone
transaction: never inside a Cloak transaction (the SDK builds the deposit and the relay builds
every withdrawal, so a memo cannot ride in them), and it moves no funds. It is one more wallet
signature, and it can never stop a payout: if it cannot be written, the run says so and goes on.
When it succeeds, its signature is in the proof pack under `commitment`.

| Written on mainnet (filled in after the run) | |
|---|---|
| Transaction signature | `<COMMIT_TX_SIGNATURE>` |
| Signed and paid by | `<FUNDER_WALLET>` |
| Block time (UTC) | `<COMMIT_DATE>` |

**What it proves.** That this exact text existed, unchanged, no later than the block time of that
transaction. It does not hide anything (a hash reveals nothing about the text), it says nothing
about whether the text is true, and it is not an attestation by anyone but the signing wallet.
The English translation, [`PRIVACY.en.md`](PRIVACY.en.md), is **not** committed; `--text-file`
prints its hash for reference only.

### How to verify it

You need Node 22 or later and a checkout of this repository. Nothing to install and nothing to
build: the script imports only Node's own modules. From the repository root:

```bash
# 1. Hash the text in this repository, and print the memo that should be on-chain.
node --experimental-strip-types packages/cloak/src/verify-hash.ts

# 2. Read the transaction back from a Solana RPC and compare. Add --signer to also require that
#    the team's wallet paid for it, and --rpc <url> to use another endpoint than the public one.
node --experimental-strip-types packages/cloak/src/verify-hash.ts \
  --tx <COMMIT_TX_SIGNATURE> --signer <FUNDER_WALLET>
```

(`pnpm verify-hash` runs the first form.) The first command prints the word count, the SHA-256
and the memo. The second ends with `RESULT: VERIFIED` and the block time, or with
`RESULT: NOT VERIFIED` and the reason, and exits 0 or 1 accordingly (2 when the RPC could not be
read).

**Without our code.** The script's `--print-text` prints the exact bytes that are hashed, so any
SHA-256 tool agrees with it, and the explorer shows the memo:

```bash
node --experimental-strip-types packages/cloak/src/verify-hash.ts --print-text | sha256sum
# expected: 331f0b7a354c8f18dfbbc71d25d5d3f99d23c74797fde752446a23e0c0313148
```

Open `https://explorer.solana.com/tx/<COMMIT_TX_SIGNATURE>` and compare the Memo instruction's
text with the memo above.

**What is hashed.** The text between the markers in `PRIVACY.md`, Unicode NFC, line ends as LF,
trailing spaces removed, runs of blank lines cut to one, the whole text trimmed, then UTF-8 with no
byte-order mark. To check a copy pasted from the submission form, pipe it in with `--stdin`; the
result is the same whatever its line ends or trailing spaces.

**If the text was edited after the commitment,** step 2 fails, by design. The text that was
committed is the one in this repository at the commit named in the submission (`git show
<COMMIT>:examples/templates/cloak-private-payout/PRIVACY.md`).

## Honest limits

- Deposit and withdrawal **amounts and times are public**; the pool hides which deposit became
  which payout.
- **Cloak's relay sees you.** It authenticates your wallet, receives your viewing key, sees sender
  and recipient. With the notes this template creates, the viewing key is enough to rebuild their
  keys, which is why the run is capped; ADR-027 states the trade-off.
- **Payee addresses appear in the proof pack on purpose,** so a run can be checked.
- **ZEC on Solana is an ordinary SPL token** once delivered; the privacy is the pool's.
- **Anonymity depends on how busy the pool is,** and a payout hides among few others today (the
  measured counts are in the product doc).
- **The policy is soft.** Code and configuration in your own browser.
- Native ZEC to a Zcash address is not built. NEAR Intents delivers native ZEC only to transparent
  `t1`/`t3` addresses.

## Files

| File | |
|---|---|
| [`agents/payout-planner.md`](agents/payout-planner.md) | The planner's role: drafts the list and the `template-run` block, holds nothing |
| [`policy.example.json`](policy.example.json) | The caps, flags and refusals above, for review |
| [`PROOF.md`](PROOF.md) | What the proof pack is, how to verify it, and the (empty until a run) results |
| [`PRIVACY.md`](PRIVACY.md), [`PRIVACY.en.md`](PRIVACY.en.md) | The privacy text for the submission, with word counts |
| [`packages/cloak/src/verify-hash.ts`](../../../packages/cloak/src/verify-hash.ts) | The judges' script: hashes the text and checks it against the on-chain memo (see [Proof of existence](#proof-of-existence-commit-then-reveal-for-the-privacy-sprint-judges)) |
| [`VIDEO.md`](VIDEO.md) | The two-minute script |

## Out of scope for v1

- **Anything from the vault.** No `execute_payment`, no session, no ceiling. A private payment that
  starts in the vault needs its own ADR and has to solve who owns the note first (ADR-027, option A).
- **Larger runs.** More than 0.05 SOL a payee, 0.10 SOL a run or four payees; inputs other than
  SOL; swap targets other than the verified ZEC mint.
- **Native ZEC.** The NEAR Intents leg is optional in the plan and not built.
- **Devnet.** The published Cloak SDK has no devnet target.
- **Unattended runs.** Every run needs a person and a wallet prompt for each step.
