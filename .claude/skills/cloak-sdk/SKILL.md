---
name: cloak-sdk
description: Use when touching the Cloak private-payout integration — packages/cloak, packages/contract/src/template-run.ts, the dashboard's template-run card, or any code that imports @cloak.dev/sdk. Covers Cloak's own guardrails (no secret in a log, explicit relayUrl, signMessage + walletPublicKey in the browser, bigint amounts, DEFAULT_CIRCUITS_URL, recoverable notes), this repo's invariants for it (outside the program, the MCP surface and the vault path; public-only events and proofs), the file map, the commands, and the traps found so far.
---

# Working on the Cloak private-payout integration

A private payout is a browser flow around `@cloak.dev/sdk`, run with the operator's own wallet on
mainnet, outside the vault (ADR-027). The model proposes, a person approves, the wallet signs.
Read `docs/adr/ADR-027-private-payouts-through-cloak-in-the-operators-browser.md` and
`docs/product/cloak-private-payout.md` first; the second ends with what is verified, what is not,
and the known gaps.

SDK reference: <https://docs.cloak.ag/llms.txt> (index) and <https://docs.cloak.ag/sdk/llms.txt>
(the contract map and runtime invariants). The installed types, `@cloak.dev/sdk` `dist/index.d.ts`,
win over both when they disagree: on 2026-10-04 the reference described 0.2.2 and this repo pins
0.2.5 exactly, no caret.

## 1. Cloak's guardrails

They come from the SDK reference and apply to every call written here.

- **Never log a secret.** Spend keys, `nk`, UTXO private keys, blindings, signed messages — the
  wallet's key-derivation signature included — and note payloads. That covers error paths: print
  errors through `describeForConsole`, which cuts long tokens, never `console.log(error)`.
- **`relayUrl` is explicit and is `CLOAK_PRODUCTION_RELAY_URL`.** The SDK has no default and pins
  an origin allow list. Never a custom origin, never `""`. Never set
  `enforceViewingKeyRegistration: false`: with `relayUrl: ""` it turns a payout into a direct
  submission under the user's own key, which publicly links the transaction.
- **In browser code, `signMessage` plus `walletPublicKey`** (and a signer from
  `signerFromWalletAdapter`). Never `depositorKeypair`, `Keypair.fromSecretKey` or a keypair path
  in browser send, withdraw or swap code. Node uses a keypair, in `node.ts` and `smoke.ts` only.
- **The authenticated sender is the key Cloak screens**: the end user's real wallet, never an
  ephemeral, session or service-held key.
- **Amounts are `bigint`** end to end. No `number`, no `parseFloat`; decimal strings go through
  `parseSolToLamports`.
- **Circuits come from `DEFAULT_CIRCUITS_URL`** through `setCircuitsPath`. Never hardcode a
  circuit URL: the deployed program rejects proofs from any other bundle.
- **Every output note is persisted or made recoverable the moment the call returns.** This repo
  makes them recoverable: a deposit with `createRecoverableDepositUtxo` and the same salt as
  `chainNoteSalt`; change through `partialWithdraw` or `swapWithChange`, which do it for you; if
  you ever call `transact` with change yourself, build it with `createRecoverableChangeUtxo`. A
  change note made with `createUtxo` has a random blinding written nowhere, and dropping it loses
  the funds.
- **Pass an explicit `chainNoteViewingKeyNk` on every flow, swaps too**, so a swap's refund secret
  derives from an `nk` we hold.
- Never hand-pack Groth16 public inputs, and never add stale-root retry loops: the SDK retries.

## 2. This repo's invariants

1. **Never in `programs/agent_rails`, `packages/mcp/src/tools/` or
   `packages/contract/src/mcp-tools.ts`.** The agent surface stays at seven tools. A private payout
   is operator-approved from a wallet; it is not an agent tool, and no tool may start one.
2. **It is not a vault flow.** No `execute_payment`, no `IntentReceipt`, no treasury account. Do not
   bolt either on. A vault-native private payment needs its own ADR, and has to solve who owns the
   note first (ADR-027, option A).
3. **The model proposes and never executes.** The chat request carries no `tools`
   (`openrouter-api.test.ts` asserts it). The proposal schema is a `strictObject` with no `network`
   field; the caps are constants of the template, not proposal fields. The card and each wallet
   prompt are the gates.
4. **The dashboard's source names no `get…Instruction` builder.** `privileged-surface.test.ts`
   scans `packages/dashboard/src` for the pattern and for a forbidden list. The builders live inside
   the SDK, not in a dashboard file.
5. **Client files import `@agent-rails/contract/template-run`, never the package root.** The root
   pulls `node:crypto` into a browser bundle, and only `next build` catches it. The root entry of
   `@agent-rails/cloak` is browser-safe: no SDK import and no Node built-in. `adapter.ts` is the only
   module that imports the SDK, through a dynamic import; `node.ts` and `smoke.ts` are Node-only.
6. **Events and proofs carry public data only.** Strict schemas, error codes in place of upstream
   messages (`RUN_ERROR_CODES`, `classifyError`), `message` at most 300 characters. No key, note,
   viewing key, secret-bearing signature or raw SDK error text in an event, the proof pack, the CSV,
   the progress log, a console line or `localStorage`. `localStorage` holds run logs (signatures)
   and the key fingerprint, nothing else.
7. **Secrets stay inside the `PayoutSession` closure in `adapter.ts`.** They cross `ports.ts` only
   as signatures, amounts and the fingerprint. Do not widen `PayoutSession` to return a note, a key
   or a tree. Zero seeds (`seed.fill(0)`) and call `dispose()`.
8. **The mainnet exception stays narrow:** off unless `NEXT_PUBLIC_CLOAK_MAINNET=1`, the wallet
   allow list fails closed, this template only. Do not extend it to another dashboard path.
9. **The policy is soft, and every surface says so.**
10. **Two tests are the guard rails.** The leak test in `packages/cloak/src/runner.test.ts`
    ("what never leaves the session") runs a whole run against a fake SDK that knows its secrets and
    fails if any, or the wallet's signature in hex or base64, appears anywhere an operator could
    copy from; it has a positive control, so keep it. `fees.test.ts` checks our exit fee against the
    real SDK's `calculateFeeBigint`. When you add something that touches secrets or money, extend
    them; do not weaken them.

## 3. File map

| Path | What it is |
|---|---|
| `packages/contract/src/template-run.ts` | Proposal schema and fence, caps (`CLOAK_PAYOUT_LIMITS`), reserved addresses, `RUN_STEPS`, `RUN_ERROR_CODES`, event and proof-pack schemas |
| `packages/cloak/src/plan.ts`, `fees.ts`, `quotes.ts`, `constants.ts` | The plan and its numbers, the exit fee, the Jupiter ZEC quote |
| `packages/cloak/src/policy.ts` | `checkRunPolicy`, `parseAllowedWallets` |
| `packages/cloak/src/keys.ts` | The signed message, HKDF, the determinism check |
| `packages/cloak/src/runner.ts` | `runPrivatePayout` and `recoverFunds`, over injected ports |
| `packages/cloak/src/ports.ts` | `WalletPort`, `SdkPort`, `PayoutSession`: the only seams |
| `packages/cloak/src/adapter.ts` | The one module that talks to the SDK; wallet and keypair modes |
| `packages/cloak/src/report.ts`, `errors.ts` | Run log, proof pack, notes; `RunError`, `classifyError`, `describeForConsole` |
| `packages/cloak/src/node.ts`, `smoke.ts` | Node only: keypair reading, the `smoke` script |
| `packages/cloak/src/testing.ts`, `test-support.ts` | The fake SDK and wallet; shared fixtures. No real wallet address appears in them. |
| `packages/dashboard/src/components/chat/template-run-card.tsx`, `hooks/use-template-run.ts`, `lib/templates/runners/` | The card, the hook that drives a run, config and storage |
| `examples/templates/cloak-private-payout/` | README, policy statement, planner role, privacy text, video script, proof guide |

## 4. Commands

```bash
pnpm --filter @agent-rails/cloak test         # offline; real SDK for keys, bridge and fee parity
pnpm --filter @agent-rails/cloak typecheck
pnpm --filter @agent-rails/cloak build        # tsdown; dist/smoke.js, adapter, node, testing
pnpm --filter @agent-rails/contract exec vitest run src/template-run.test.ts
node packages/cloak/dist/smoke.js --keypair <KEYPAIR.json> --payee-sol <A> --payee-zec <B>
                                              # or: pnpm cloak-smoke <the same flags>
```

The last command is a dry run: that is the default, and it signs and sends nothing. **Never add
`--confirm-mainnet` yourself.** Signing and sending on mainnet is the person's act, with their own
funds; an agent working on this code stops at the dry run and the tests. The script reads the
keypair file it is given, so do not open that file yourself.

Bumping `@cloak.dev/sdk`: change the exact pin, then rerun the tests (fee parity and the adapter
tests run against the real SDK), re-read the types for anything the adapter relies on
(`ScanResult`, `UtxoSwapResult`, the key helpers), re-measure `pnpm audit --prod`, and record any
behaviour change in ADR-027 as an amendment.

## 5. Traps found so far

- **The reference lags the code.** It said, for 0.2.2, that nothing recovers a change note; the
  pinned 0.2.5 has `createRecoverableChangeUtxo` and `ScanResult.recoveredChangeNotes`. Read the
  installed types.
- **Recovered change notes have a zero owner key.** The scanner builds them with
  `privateKey: 0n`, because change belongs to the key of the note it was made from, so that a
  viewing key alone gives no spend authority. Spending one after a reload needs the runner to
  re-key it from the deposit note's derived keypair. The adapter's `recover()` does not do this yet
  and its tests use non-zero keys. Treat it as open until a real chain shows it working.
- **`scanTransactions` walks Cloak's program, not the wallet.** It pages the newest signatures that
  mention the program, bounded by `limit` (500 for recovery, 250 for the CSV), and trial-decrypts
  with `nk`. An RPC with short history (PublicNode keeps about a day) returns an empty scan, and an
  empty scan is not proof the pool is empty.
- **A swap that times out refunds to a note.** `discoverSwapRefunds` can find it from `nk`; Recover
  does not call it yet, and `swapToZec` ignores `result.refund`.
- **A deposit is wallet-signed, public and linked to the funder; withdrawals and swaps are
  submitted by the relay.** Do not describe the shield as private.
- **The SDK registers `nk` with the relay** before the first transaction. For the notes this repo
  creates, that is enough to rebuild their keys (ADR-027). Registration is not a run step: it
  happens inside `shield`, once per page session.
- **A signed relay request lives 300 seconds** (285 usable), and a clock more than 30 seconds fast
  cannot authenticate. A private withdrawal signs once; a swap may prompt up to five times.
- **Wallets reject with plain objects**, not `Error`s; that is why `classifyError` reads `code` and
  `message` from anything.

## 6. Do not

- Log, emit, store or return a key, note, `nk`, blinding, signature over a secret or raw SDK error.
- Add a `network` field, a cap field, or any new field to the proposal that lets the model widen a
  run; add a payout kind without extending the policy, the plan and the leak test.
- Add an API route for this flow, or call the privileged builders from a dashboard file.
- Turn the browser flow into a server flow: no server holds a key for this template (ADR-027
  option B, ADR-025 option B, ADR-017).
- Raise a cap, or generalize the mainnet exception, without a new ADR.
- Describe the policy as a guarantee, the viewing key as read-only for these notes, or the deposit
  as private.
- Use real wallet addresses in tests, fixtures or docs. Use placeholders or the `addr()` helper.
- Run `scripts/rehearse-template-prompt.ts` unasked: it calls the chat route and spends the
  platform's chat key.
