# Proof pack: what it is and how to check a run

A **proof pack** is the public record a private payout leaves behind: one JSON file, built by the
runner after the payouts finish and validated against its own schema (`proofPackSchema` in
`packages/contract/src/template-run.ts`, a strict object, so a stray field fails the build of the
pack). It holds signatures, amounts and addresses and nothing else: no key, no note, no viewing
key, no wallet signature.

It is not an attestation. It carries no signature of its own, and a reader should trust the chain
over the file: every claim in it is a pointer to something an explorer shows. The script writes it
as `cloak-proof-<run>.json` (with the CSV beside it), the dashboard offers it as a download.

## The fields (`ash.proof-pack/v1`)

| Field | Meaning |
|---|---|
| `apiVersion`, `template` | `ash.proof-pack/v1` and `builtin:cloak-private-payout` |
| `runId` | `run_` and 12 hex characters; names the run in the timeline and the file |
| `cluster` | always `mainnet-beta`: the template never runs anywhere else |
| `cloakProgramId` | the Cloak program the SDK used (`zh1eLd6rSphLejbFfJEneUwzHRfMKxgzrgkfwA6qRkW` in `@cloak.dev/sdk` 0.2.5) |
| `sdk` | `{ "name": "@cloak.dev/sdk", "version": … }` |
| `funder` | the wallet that signed the deposit and paid |
| `startedAt`, `finishedAt` | ISO 8601 times of the run |
| `shield` | `{ "signature", "amountLamports" }`: the one deposit, equal to the sum of the payouts' gross |
| `commitment` | Optional. `{ "signature", "memo" }`: the standalone SPL Memo transaction, sent right after the deposit, that wrote a SHA-256 of the privacy text on-chain. Absent when it could not be written; the payouts do not depend on it |
| `payouts[]` | per payee: `index`, `label`, `address`, `deliver` (`SOL` or `ZEC`), `grossLamports`, `feeLamports`, `netLamports`, `minOutputBaseUnits` (ZEC only) and `signature` |
| `notes[]` | The honest limits, as sentences (below) |

Amounts are decimal strings in lamports, because JSON has no bigint. They obey the same arithmetic
you can redo by hand:

- `feeLamports = 5,000,000 + floor(grossLamports × 3 / 1000)`: Cloak's exit fee, 0.005 SOL plus 0.3%
- `netLamports = grossLamports − feeLamports`: what the SOL payee receives, or what the swap spends
- `shield.amountLamports = Σ grossLamports` over the payouts
- `minOutputBaseUnits` is the Jupiter quote minus 2%, in ZEC base units (8 decimals); the swap may
  not land below it

For 0.02 SOL that is a fee of 5,060,000 and a net of 14,940,000.

## How to check each signature on a block explorer

Open `https://explorer.solana.com/tx/<signature>` (any explorer will do) for each signature in the
pack.

**Every signature:** the status is a success, and Cloak's program (`cloakProgramId`) is among the
programs the transaction invokes.

**The commitment (`commitment.signature`, when present).** A transaction of its own, signed and paid
for by the `funder`, with one instruction for the SPL Memo program
(`MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr`) and no Cloak involvement at all. The Memo
instruction's text is `commitment.memo`, which is `ash/privacy-text/v1 sha256=` and the hash.
The README's proof-of-existence section explains what it proves and how to check it with
`packages/cloak/src/verify-hash.ts --tx <signature>`.

**The shield (`shield.signature`).** A deposit is signed by the wallet and posted straight to the
chain, so the `funder` is a signer. The funder's SOL balance falls by about
`shield.amountLamports`, plus small network costs; the SDK also builds an ephemeral lookup table
for the deposit, so the funder's history can show a transaction or two that name no payee.

**Each payout (`payouts[i].signature`).** Withdrawals and swaps are submitted by Cloak's relay, not
by the funder: the funder is **not** a signer. Then:

- *SOL payout.* The payee's SOL balance rises by `netLamports` in that transaction.
- *ZEC payout.* A swap is two steps on Cloak's side: the swap is opened, then the relay wraps the
  SOL and routes it through Jupiter in follow-up instructions. The signature in the pack is the
  one the SDK returned for it; delivery is proved by the payee's token account for the ZEC mint
  (`A7bdiYdS5GjqGFtxf17ppRHtDKPkkRqbKtR27dxvQXaS`), whose balance should hold at least
  `minOutputBaseUnits`. Read it from the payee's token history, not from the pack's signature
  alone.

Checking is by hand today. The plan names a scripted `verify`; it has not been written.

To check only the file's shape, from the workspace (it validates the schema, not the chain):

```bash
cd packages/cloak && node --input-type=module -e '
import { readFileSync } from "node:fs";
import { proofPackSchema } from "@ash/contract/template-run";
proofPackSchema.parse(JSON.parse(readFileSync(process.argv[1], "utf8")));
console.log("shape ok");' /path/to/cloak-proof-<run>.json
```

## What "no direct link" means

The claim is narrow: on-chain, no transaction moves value between the funder and a payee, and no
payout transaction involves the funder. It is a statement about explicit links on the ledger. It
is not a claim that nobody can infer the connection. To check it:

1. **The funder's history.** Open the `funder` address. Around the run it should show the shield,
   a deposit into Cloak, and no transfer to any payee address and none of the payout transactions.
2. **Each payee's history.** Open every payee address. It should show an incoming SOL transfer or
   a ZEC token credit that comes from the pool's side, and no transaction with the funder.
3. **Each payout transaction.** The funder is not a signer and should not appear among the accounts
   it touches. If it does, write that down under Run results: it would mean the link exists.
4. **Indirect links.** A payee the funder paid before, or that pays the funder after, breaks the
   claim even when the pool did its job. Payees must be fresh addresses.

What this check does not show is that the connection cannot be guessed. Amounts and times are
public: a 0.04 SOL deposit followed minutes later by withdrawals of about 0.01494 SOL, in a pool
that sees a few dozen transactions a day, is a correlation an observer can make. And Cloak's relay
sees sender and recipient.

## The limits the pack carries

Each pack ends with these sentences in `notes[]` (`PROOF_NOTES` in `packages/cloak/src/report.ts`),
so the pack cannot circulate without them:

- Deposit and withdrawal amounts are public on-chain; what the pool hides is which deposit became
  which payout.
- Cloak's relay authenticates the signing wallet and receives its viewing key, which for these
  notes is enough to rebuild their keys: nothing here is hidden from the relay.
- Payee addresses appear in this pack on purpose, so the run can be checked; on-chain there is no
  direct link from the funder to them, though amounts and timing can still be correlated.
- ZEC delivered on Solana is an ordinary SPL token until it is shielded in a Zcash wallet.
- Fees are the schedule the SDK documents (0.005 SOL + 0.3% per payout); the pool's on-chain
  configuration is what applies.

## Run results

> **EMPTY. No mainnet run has been made yet.** Fill this section after a real run, from the proof
> pack and the explorer, and write only what you saw. Never paste a signature a run did not
> produce. The pack names the funder and the payees by design, so publish it only for disposable
> wallets.

| Field | Value |
|---|---|
| Run id | `<RUN_ID>` |
| Date (UTC) | `<DATE>` |
| Funder (disposable wallet) | `<FUNDER_WALLET>` |
| SDK version | `<SDK_VERSION>` |
| Shield signature | `<SHIELD_SIGNATURE>` |
| Shield amount (lamports) | `<LAMPORTS>` |
| Commitment signature (SPL Memo, the privacy text's hash) | `<COMMIT_TX_SIGNATURE>` |
| Payout 1: label, delivery, gross / fee / net | `<LABEL>`, `<SOL or ZEC>`, `<GROSS>` / `<FEE>` / `<NET>` |
| Payout 1 signature | `<PAYOUT_1_SIGNATURE>` |
| Payout 2: label, delivery, gross / fee / net | `<LABEL>`, `<SOL or ZEC>`, `<GROSS>` / `<FEE>` / `<NET>` |
| Payout 2 signature | `<PAYOUT_2_SIGNATURE>` |
| ZEC the payee holds afterwards (base units) | `<ZEC_BASE_UNITS>` |
| Wallet prompts counted | `<COUNT>` |
| Network cost beyond Cloak's fees (lamports) | `<LAMPORTS>` |

Checks. Leave a box empty until you have done it.

- [ ] Every signature above is a success on the explorer
- [ ] The funder signed the shield
- [ ] `verify-hash.ts --tx <COMMIT_TX_SIGNATURE> --signer <FUNDER_WALLET>` ends with `RESULT: VERIFIED`
- [ ] The funder signed no payout
- [ ] Each SOL payee received `netLamports`
- [ ] Each ZEC payee holds at least `minOutputBaseUnits` of ZEC
- [ ] The funder's history shows no transfer to any payee
- [ ] No payee's history shows the funder
- [ ] Anything that differs from this page: `<WHAT_DIFFERED>`
