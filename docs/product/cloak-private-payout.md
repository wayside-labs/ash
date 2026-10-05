# Private payout desk (Cloak + Zcash)

**Status:** runner, contract schemas and the `smoke` script implemented on
`feat/cloak-private-payout` and tested offline; the dashboard card is built alongside and is
described here as designed, so check `packages/dashboard` for its final labels. **Never run on
mainnet yet.** · **Decision:** ADR-027 (Proposed) · **Plan:**
`docs/strategy/privacy-sprint-plano-execucao.md` · **Sources:** the Cloak SDK reference
(`https://docs.cloak.ag/sdk/llms.txt`, read 2026-10-04) and the installed `@cloak.dev/sdk@0.2.5`
types and source. The reference describes 0.2.2; where the two differ, this page follows the
installed code.

## What it is

A built-in dashboard template, `builtin:cloak-private-payout`. The operator asks in the chat for a
private payout; the model answers with a proposal that renders as an approval card; on approval
the operator's browser runs the Cloak SDK with the operator's own wallet on **Solana mainnet**:
shield SOL into Cloak's pool, pay each payee from the pool in SOL or in ZEC, then hand back a
viewing-key CSV and a public proof pack.

It exists because a treasury's payments are public: who a company pays, how much and when. The
pool hides which deposit became which payout. The Superteam Brasil Privacy Sprint (Cloak and
Zcash tracks) is the occasion; the capability stands without it.

It is **not a vault payment.** It bypasses `execute_payment` and `IntentReceipt`, like the desk
flows of ADR-025, and there is no Treasury, Policy or session behind it. Its policy is soft
(below). The agent surface is untouched: still seven MCP tools, nothing added to `packages/mcp`
or `packages/contract/src/mcp-tools.ts`, and the chat request still carries no `tools`.

| Need | Use |
|---|---|
| Pay a vendor from the treasury under on-chain limits and an audit chain | `execute_payment` from the vault. Public on-chain. |
| Pay someone with no public link to your own wallet, in small amounts | This template. Private, mainnet, soft policy. |
| Swap inside Solana from a desk | The Jupiter connector (`docs/product/sodax-integration.md` for everything that leaves Solana) |

## Who runs what

| Who | Does | Never does |
|---|---|---|
| The chat model | Drafts the payee list and emits a `template-run` block | Sign, see a key or a note, execute, choose the network, raise a cap |
| The operator | Checks every full address on the card, ticks two confirmations, approves each wallet prompt | |
| The operator's wallet | Signs the key-derivation message, the deposit (and its lookup table), the viewing-key registration, and one message per relayed request | |
| The browser runner (`@ash/cloak`) | Derives keys, shields, pays, rebuilds notes, writes the CSV and the proof | Store a secret, call a server of ours |
| Cloak's relay (`https://api.cloak.ag`) | Authenticates the wallet, receives its viewing key, submits withdrawals and swaps, screens the sender | |
| Jupiter | A keyless, CORS-open ZEC quote that bounds the swap | |
| The RPC | Reads the chain and sends the deposit | |

The model's output is validated by `@ash/contract/template-run` with a strict schema:
an unknown field is refused, a block that is still streaming (no closing fence) is not a block,
and an invalid block becomes a warning card with the validator's message, never half-applied.

## The flow

```
operator ── "pay 0.02 SOL to X and 0.02 SOL in ZEC to Y" ──▶ model (text only, no tools)
              │ a template-run block, validated
              ▼
   approval card: full addresses, fees, MAINNET seal, two confirmations
              │ Approve and run
              ▼
   browser:  preflight → derive-keys → shield → commit → payout (one per payee) → report
                                         │            │
                                  deposit (public)   relayed withdrawal or swap (private)
   recover is a separate action, never part of a run
```

| Step | What happens | Wallet prompts |
|---|---|---|
| `preflight` | Reads only. The connected wallet is the one the run was planned for; the RPC, Cloak's proving files and the relay answer; every ZEC payout has a quote; the balance covers the shield plus 0.02 SOL. Skipped balance check on a resume. | 0 |
| `derive-keys` | The wallet signs the fixed message once, twice on the first run on a device to prove it signs deterministically. HKDF turns the signature into a master seed, the SDK turns the seed into the viewing key `nk`. A stored fingerprint that does not match stops the run here. | 1–2 |
| `shield` | One deposit, equal to the sum of the payouts, as a note a scan can rebuild. Inside this step the SDK registers the viewing key with the relay (once per page session; there is no separate step for it) and builds an ephemeral lookup table. | 2–3 for the lookup table and the deposit, plus 1 for the registration |
| `commit` | Optional (the dashboard card and the smoke script ask for it by default; `--no-commit` skips it). A standalone transaction, signed and paid for by the funder, with one SPL Memo instruction whose text is `ash/privacy-text/v1 sha256=` and the SHA-256 of the privacy text: the commitment half of the text's proof of existence (the README has the verification steps). It touches no Cloak transaction and moves no funds, and a failure never stops the run: it is reported and the payouts go on. Skipped on a resume that already holds its signature. | 1 |
| `payout` | One per payee, in order. SOL: a partial withdrawal (a full one when the pool holds exactly that amount). ZEC: a private swap of SOL into the verified ZEC mint, to the payee's token account, with the payee's wallet named so the relay can open that account, and a minimum output of the quote minus 2%. The wallet signs the relay request, not a transaction. | 1 per SOL payout; 1–5 per swap |
| `report` | `scanTransactions` with `nk`, then the compliance report as CSV, then the proof pack. A failed CSV does not fail the run: the transactions are final. | 0 |
| `recover` | Explicit and separate. Rebuilds the notes from the chain and withdraws everything spendable back to the funder. That withdrawal links the pool exit to the funder. | 1 for the sweep, plus the `derive-keys` prompts |

The plan expects 7 to 10 prompts for the two-payee demo run, the commitment's one included. The steps add up to more when the
swap needs several approvals (the SDK re-prompts a swap, up to 5 times); a private withdrawal
signs exactly once however often the network retries.

**Resume.** The browser's log of finished steps (signatures only) decides what a re-run skips: a
shield that landed is not repeated and a payout with a signature is not paid again. On resume the
runner rebuilds the notes from the chain and requires the pool to still hold what the unfinished
payouts need; if it does not, the run stops with `outcome_unknown` instead of paying twice. The
log lives in this browser's `localStorage`, so on another device, or after clearing site data, a
re-run would start from a new shield: use Recover instead. A run that finishes clears its log, so
asking for the same payout again is a new payout.

**Stop.** "Stop after this step" ends the run at the next step boundary. If the shield had landed,
the message says the funds are in the pool and that the same wallet can resume or recover them.

## Configuration

All three variables are public: `NEXT_PUBLIC_*` is inlined into the browser bundle at build time,
so set them before `next build` or `pnpm dashboard` starts, and rebuild after changing them. On
the VPS they come from `/etc/agent-rails/dashboard.public.env`. Nothing here is a secret.

| Variable | Meaning |
|---|---|
| `NEXT_PUBLIC_CLOAK_MAINNET` | `1` switches the template's mainnet exception on. Anything else: the card says it is off and Run stays disabled. |
| `NEXT_PUBLIC_CLOAK_ALLOWED_WALLETS` | Wallets allowed to run it: base58 addresses separated by commas or whitespace. An entry that is not an address is dropped, so a typo shrinks the list and never widens it. Empty allows nobody. |
| `NEXT_PUBLIC_CLOAK_RPC_URL` | A mainnet RPC that answers browser origins. Unset, the dashboard uses PublicNode (`https://solana-rpc.publicnode.com`). |

**The RPC matters twice.** Solana's public endpoint answers 403 to a browser `Origin` (checked
2026-10-04 with `https://console.ash.app.br`: 403 with the header, 200 without), so it cannot be
the browser's RPC. PublicNode needs no signup and answers CORS (preflight 204,
`access-control-allow-origin: *`), but it keeps only about a day of history: on 2026-10-04 it
served Cloak's transactions up to 19 hours old and returned nothing at 23. Resume, Recover and the
CSV read old transactions, so for anything beyond a same-session run use a provider that keeps
full history and list the dashboard's origin in its allowed origins. CORS is configured at the RPC
provider, never on the VPS or in the dashboard.

## Running it

### From a terminal: the `smoke` script

The same run the dashboard does, from a Solana CLI keypair file. It is the first mainnet check and
the fallback if the browser path misbehaves. **It signs and sends nothing without
`--confirm-mainnet`.**

```bash
pnpm --filter @ash/cloak build

# Dry run (the default): the plan, a preflight, and the exact message the wallet would sign.
node packages/cloak/dist/smoke.js \
  --keypair <FUNDER_KEYPAIR.json> \
  --payee-sol <SOL_PAYEE> --payee-zec <ZEC_PAYEE> \
  --amount-sol 0.02 --amount-zec 0.02

# The real run: the same command plus --confirm-mainnet.
# (`pnpm cloak-smoke <flags>` at the repo root runs the same file.)
# After a stop with funds in the pool: run the same command again to resume, or
node packages/cloak/dist/smoke.js --keypair <FUNDER_KEYPAIR.json> --recover --confirm-mainnet
```

| Flag | Meaning |
|---|---|
| `--keypair <file>` | Solana CLI keypair (a JSON array of 64 bytes). Required. Use a throwaway one. |
| `--payee-sol`, `--amount-sol` | Payee paid in SOL, and the SOL leaving the pool for it (default 0.02) |
| `--payee-zec`, `--amount-zec` | Payee paid in ZEC through a private swap, and the SOL swapped for it (default 0.02) |
| `--rpc <url>` | A mainnet RPC (default PublicNode). Pass one with full history to recover later. |
| `--out <file>` | Where the proof pack goes (default `cloak-proof-<run>.json`); the CSV goes beside it as `<file>.csv` |
| `--log <file>` | Public progress log used to resume (default `cloak-smoke-log.json`) |
| `--confirm-mainnet` | Actually sign and send |
| `--recover` | Send whatever is still spendable in the pool back to the keypair |

Exit codes: **0** done, **1** the run failed, **2** bad input (including a payout the policy
refuses, or a log written for other payouts), **3** the dry run found a problem (a dependency is
down or the balance is short), so a script can tell.

A dry run still touches the network: it reads the balance, loads and hash-checks Cloak's proving
files (about 23 MB) and asks Jupiter for a quote. It signs and sends nothing. The progress log holds
only signatures, a hash of the payouts and the key fingerprint; a re-run with the same payouts
resumes from it, and a log written for different payouts is refused so nothing is skipped by
mistake. The script does not read the `NEXT_PUBLIC_*` variables: its gate is `--confirm-mainnet`
and its only allowed wallet is the keypair's own address.

### From the dashboard chat

1. Set the three variables and rebuild.
2. Connect a **throwaway** wallet in the header, on mainnet, holding about 0.1 SOL. It has to be
   on the allow list. Do not use a vault owner or any key that matters.
3. Ask in the chat, for example: "pay 0.02 SOL to `<address>` and 0.02 SOL in ZEC to `<address>`".
   The model is told to ask for an address it was not given rather than guess one. The schema only
   checks that an address is well formed, so the card is where a wrong one is caught.
4. The card shows a red mainnet seal and, per payee, the label, the full address, the delivery,
   what leaves the pool, the fee and what arrives (for ZEC, the minimum output and the quote), then
   the totals and the balance the wallet needs. Check every address in full, tick both
   confirmations ("I checked every full address above." and "I understand this is mainnet and
   cannot be undone."), and press **Approve and run**.
5. Approve each wallet prompt. The timeline fills with explorer links as steps finish.
6. When it ends, download the proof pack and the CSV.

If a run stops after the shield, the card offers **Resume** (run it again) and **Recover funds to
my wallet**. Card labels are the `chat.templateRun.*` keys in
`packages/dashboard/src/i18n/locales/en.json`.

## What you get

- **A timeline.** Typed events (`preflight`, `derive-keys`, `shield`, `payout`, `report`,
  `recover`; `started`, `progress`, `done`, `failed`, `skipped`) with signatures, a payee index and
  an error code. Public by construction: a strict schema, no raw upstream message.
- **A proof pack**, `ash.proof-pack/v1`: run id, cluster, Cloak's program id, SDK version,
  funder, start and end times, the shield signature and amount, and for every payout its payee,
  delivery, gross, fee, net, ZEC minimum output and signature, plus the honest limits as notes. It
  holds no key, note or viewing key. How to check one is in
  [`examples/templates/cloak-private-payout/PROOF.md`](../../examples/templates/cloak-private-payout/PROOF.md).
- **A CSV** from the SDK's compliance report, with the columns `Date, Type, Asset, Gross Amount,
  Fee, Net Amount, Running Asset Balance, Recipient, Commitment, Signature, Input Mint, Output
  Asset, Output Mint`. The scan reads the newest 250 transactions that touch Cloak's program (the
  whole pool's, not only yours) and keeps those `nk` can decrypt. It carries the payees' addresses
  and the amounts, which is exactly what the pool hides, so share it with the accountant and
  nobody else. It is not part of ASH' audit chain.

## Costs and amounts

| Item | Amount |
|---|---|
| Exit fee, per payout (a SOL withdrawal or a swap) | 0.005 SOL + 0.3% of what leaves the pool, floored (Cloak's `calculateFeeBigint`) |
| Deposit | free |
| Minimum for a shield and for a swap | 0.01 SOL |
| What preflight asks the wallet to hold on top of the shield | 0.02 SOL, for the lookup table, network fees and the priority fee. A guess until a mainnet run measures it. |
| ZEC minimum output | the Jupiter quote at approval time, minus 2% |
| The swap input | SOL only |

The demo run, two payees at 0.02 SOL:

| | SOL payee | ZEC payee |
|---|---|---|
| Leaves the pool | 0.02 SOL | 0.02 SOL |
| Cloak's exit fee (5,060,000 lamports) | 0.00506 SOL | 0.00506 SOL |
| Delivered | 0.01494 SOL | 0.01494 SOL swapped into ZEC (about 0.00137 ZEC at the quote the plan saw) |

The shield is 0.04 SOL, the wallet needs at least 0.06 SOL, and Cloak keeps 0.01012 SOL. Network
cost comes on top and is unmeasured; the plan's estimate for the whole run is about 0.015 SOL.

## The policy, and why it is soft

The caps are constants of the template (`CLOAK_PAYOUT_LIMITS` and `RESERVED_PAYEE_ADDRESSES` in
`packages/contract/src/template-run.ts`). The model cannot raise them: they are not fields of its
proposal.

| Rule | Value |
|---|---|
| Payees per run | 1 to 4 |
| Per payee | 0.01 to 0.05 SOL (0.01 is Cloak's own minimum) |
| Per run | at most 0.10 SOL |
| Duplicates | no two payouts of the same delivery to the same address |
| ZEC mint | fixed: `A7bdiYdS5GjqGFtxf17ppRHtDKPkkRqbKtR27dxvQXaS` (wrapped ZEC, 8 decimals) |
| Payee equal to the funder | refused: paying yourself through the pool recreates the link |
| Reserved addresses | refused: the System Program, the incinerator, the SPL Token and Token-2022 programs, Cloak's program and the ZEC mint. A fixed list, not a general test for program addresses. |
| Who may run it | the wallet must be in `NEXT_PUBLIC_CLOAK_ALLOWED_WALLETS` (fails closed) and `NEXT_PUBLIC_CLOAK_MAINNET` must be `1` |

**Soft** means it is code and configuration in the operator's own browser. It binds the model and
makes a mistake loud. It does not bind a person who has the wallet and the SDK. None of ADR-005's
on-chain ceilings, windows or allowlist apply here.

## Keys, and what is stored

The wallet is asked to sign this message (`keyDerivationMessage`). It says what the signature is
worth, because whoever holds the signature can rebuild the notes:

```
ASH x Cloak: private payout keys (v1)

Signing derives the keys that control your private payout notes, here and on any device with this wallet.
It does NOT authorize a transaction or move funds.
Only sign this on a site you trust: anyone who gets this signature can spend those notes.

Wallet: <FUNDER_WALLET>
```

HKDF-SHA-256 over the signature (domain `ash/cloak-private-payout/v1`) gives a master seed;
the SDK's `deriveSpendKey` → `deriveUtxoKeypairFromSpendKey` → `getNkFromUtxoPrivateKey` give `nk`.
Deposit notes are made recoverable (`createRecoverableDepositUtxo`) and so are change notes, so a
scan with `nk` rebuilds what a lost tab held. Nothing secret is written anywhere (ADR-017's interim
rule: no secret is persisted until the passkey vault ships).

The browser keeps two kinds of **public** record in `localStorage`: the signatures of finished
steps, keyed by the funder and the exact payouts, and a 16-hex-character fingerprint (a hash of
`nk`) per wallet address. A finished run clears its log. The wallet signature, the notes and `nk`
are derived again when needed and zeroed when the run ends.

### The trade-off, plainly

**The viewing key is not merely read-only for these notes.** In the SDK a deposit note's spend key
and blinding derive from `(nk, salt)`, and the SDK registers `nk` with Cloak's relay
(`POST /viewing-key/register` sends the `nk` itself). With recoverable notes the relay can, in
principle, rebuild the keys of our deposit notes. We accept that trust for amounts capped at 0.10
SOL a run (0.05 a payee), because the relay is already trusted for submission and already sees the
sender and the recipient. The accountant or auditor gets the CSV, never `nk`. Revisit it when Cloak
separates spend authorization (the SDK's `ExpandedSpendKey` marks `ask` as "future") or when the
ADR-017 passkey vault ships and notes can be random and stored encrypted. Raise no cap before then.

## Troubleshooting

| What you see | Why | What to do |
|---|---|---|
| `rpc_unreachable` at preflight, or a 403 in the console | The RPC refuses browser origins (Solana's public endpoint does), or it is rate-limiting you | Use PublicNode (the default) or a provider that lists your dashboard origin in its allowed origins: set it in `NEXT_PUBLIC_CLOAK_RPC_URL` and rebuild. |
| `mainnet_disabled` | `NEXT_PUBLIC_CLOAK_MAINNET` is not `1` in this build | Set it and rebuild. |
| `wallet_not_allowed` | The connected wallet is not in `NEXT_PUBLIC_CLOAK_ALLOWED_WALLETS`, or the entry has a typo (typos are dropped) | Add the exact address and rebuild. |
| `wallet_missing`, `wallet_rejected` | No wallet, or the prompt was closed | Connect it, run again. If the shield landed, the run resumes. |
| `wallet_cannot_sign_messages` | The wallet does not offer message signing, or returned an unusable signature | Use a wallet that signs messages (Phantom). Nothing was spent. |
| `keys_not_deterministic` | The wallet signed the same message twice and got two answers, so keys cannot be derived from it | Use another wallet. Nothing was spent. |
| `keys_mismatch` | This wallet now derives different keys than an earlier run on this device | Nothing was spent. Check you are on the same wallet account. The fingerprint is a check, not a lock: remove it from the site data only if you know why the keys changed and the pool holds nothing under the old ones. |
| `insufficient_balance`, `below_minimum` | The wallet holds less than the shield plus 0.02 SOL, or an amount is under Cloak's minimum | Fund the wallet, or raise the amount to at least 0.01 SOL. |
| `swap_quote_unavailable` | Jupiter gave no usable ZEC quote. The quote bounds the swap, so no quote means no run. | Refresh the quote on the card and retry. |
| `circuits_unreachable`, `relay_unreachable` | Cloak's proving files or relay could not be reached | Retry. Nothing moved if it happened in preflight. |
| `payee_invalid` | A payee is the funder, or an address the template refuses | Change the payee. |
| `outcome_unknown` | The result of a step is unknown: the relay's answer was lost, or on resume the pool no longer holds what the log says is still owed, or the notes the session holds cannot cover the payout | Do not re-run blindly. Open the explorer: the payee's address, and the funder's recent transactions. If the payee already received that payout, it is done: use Recover to bring the rest home and propose a new run for whoever is still unpaid. If nothing arrived, run again to resume. |
| The run stops after the shield | Funds are in the Cloak pool | With the same wallet, in this browser: run again (resume) or Recover. Do not clear site data first. |
| It wants to shield again | The browser's log is gone: another device, or cleared site data | Do not run. Use Recover with the same wallet; the script's `--recover` needs no log. |
| Recover says "Nothing is left in the pool" but you shielded | The RPC cannot see the deposit. A short-history RPC returns an empty scan. | An empty result is not proof the pool is empty. Retry with an RPC that keeps full history. |
| A request fails after a long wait on a prompt | Cloak's signed request is valid for 300 seconds (285 usable), and a clock more than 30 seconds fast cannot authenticate at all | Approve promptly, fix the clock, resume. |
| The ZEC payout fails for the payee's token account | The relay is expected to open it (the SDK types say `recipientWallet` is "used by relay to create ATA if missing"); this is unconfirmed on mainnet | Have the payee open its own token account for the ZEC mint, then resume. |

## Honest limits

These belong in every place that describes the template.

- **Amounts and times are public.** Deposit and withdrawal amounts and timing are on-chain; what the
  pool hides is which deposit became which payout. Distinct amounts and spaced steps help; they do
  not make a small pool large.
- **The relay sees you.** Cloak's relay authenticates the wallet, receives the viewing key (for
  these notes that is enough to rebuild their keys, see above), sees sender and recipient, and
  screens the sender, so a flagged wallet can be refused.
- **Payee addresses are revealed in the proof pack, on purpose,** so a run can be checked. On-chain
  they are not linked to the funder.
- **ZEC on Solana is an ordinary SPL token** after delivery. The privacy comes from the pool, not
  from the token; shielding it in a Zcash wallet is a separate step the template does not do.
- **Anonymity depends on pool activity.** Signatures that mention Cloak's program ran between 8 and
  91 a day over the seven days before 2026-10-04 (failed ones included; every deposit, withdrawal
  and swap step counts), so the set a payout hides in is small.
- **Native ZEC is out of scope.** NEAR Intents (1Click) delivers native ZEC only to transparent
  `t1`/`t3` addresses; an optional leg for it is in the plan and not built.
- **Mainnet only, real funds.** The published SDK has no devnet target.
- **Recover reveals the link** for the amount it sweeps, because the funds return to the funder.

## Verified, and not yet

**Verified (2026-10-04, offline or read-only).**

- `pnpm --filter @ash/cloak test`: 124 tests, offline. The key derivation, the wallet bridge
  and fee parity run against the real SDK; the runner runs against a fake that knows its own
  secrets and a leak test fails if any of them, or the wallet's signature in hex or base64, reaches
  an event, the proof, the CSV, the log or the console. The contract module's 30 tests and the
  package typecheck pass.
- From the plan's experiments: the SDK loads in headless Chromium, and 22.9 MB of proving files
  download and hash-check in 3.3 s; a production build with the SDK as a dynamic import has 103 kB
  of initial JavaScript; Cloak's relay and the proving-file bucket answer CORS; Jupiter quotes
  0.02 SOL for about 0.00183 ZEC with no price impact; `calculateFeeBigint(0.02 SOL)` is 5,060,000.
- While writing this page: the RPC history windows above, and the daily signature counts.

**Not verified: needs a funded mainnet wallet and a person.**

- A signed run end to end, from Node and from the browser with Phantom.
- That Cloak's relay accepts fresh addresses through its risk screening.
- That the relay opens the payee's ZEC token account.
- The real prompt count and the real network cost.
- That Phantom's own edits to a transaction do not disturb the SDK's risk-quote check.
- Browser proving with workers and relay calls from a browser origin. The browser experiment
  covered the SDK load, keys, notes and the proving files, not a real run.
- How the judges read the Zcash track's proof requirement ("a Zcash transaction"): this flow proves
  ZEC on Solana with mainnet signatures, and a strict reading may want a Zcash-network txid.

**Known gaps in the code, 2026-10-04.**

- **Recovered change notes come back without their owner key.** The SDK builds
  `ScanResult.recoveredChangeNotes` with a zero private key: a change note belongs to the key of
  the note it was made from, "deliberately, so that holding a viewing key never confers spend
  authority", and the caller must supply it. Resume and Recover after at least one payout need the
  runner to re-key such a note from the deposit note's derived keypair. The adapter's `recover()`
  passes recovered notes through unchanged and its unit tests use notes with non-zero keys, so
  nothing yet shows this path working on a real chain.
- **A stalled swap's refund is not swept.** If a swap times out before it settles, the SDK refunds
  the principal to a note it can rediscover from `nk` (`discoverSwapRefunds`). Recover does not
  call it.
- **There is no `verify` script.** The plan names one; checking a proof pack is by hand today.
- **Resume trusts the log.** The plan describes checking the chain for a payout that already left;
  the runner checks only that the pool still holds what the unfinished payouts need.

## Where it lives

| Path | Role |
|---|---|
| `packages/contract/src/template-run.ts` | Proposal schema, caps, reserved addresses, events, proof pack. Import it as `@ash/contract/template-run`. |
| `packages/cloak/` | `plan`, `fees`, `quotes`, `policy`, `keys`, `runner`, `report`, `errors` (browser-safe); `adapter` (the only module that imports the SDK); `node` and `smoke` (Node only); `testing` (the fake SDK) |
| `packages/dashboard/src/components/chat/template-run-card.tsx`, `src/hooks/use-template-run.ts`, `src/lib/templates/runners/` | The card, the hook that drives a run, config and storage |
| `examples/templates/cloak-private-payout/` | README, `policy.example.json`, the planner role, the privacy text, the video script, the proof guide |
| `.claude/skills/cloak-sdk/SKILL.md` | The rules for the next agent that touches this |
