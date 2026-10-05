# Devnet and mainnet readiness — 2026-10-02

An audit of `main` at `f0ebc3e`, which is also what runs on `console.ash.app.br`. It covers why
deposits never completed, what is missing for devnet, and what is missing on top of that for
mainnet. The fixes it led to are PR #98 (deposits) and PR #99 (every other wallet flow),
stacked in that order. Both were merged into `main` on 2026-10-02 (`255f701` and `b8dcc6f`)
and are not deployed yet.

"Testnet" in this document means **devnet**. Solana's `testnet` cluster exists for validator
testing; Circle's test USDC, the faucets, and Phantom's Testnet Mode all target devnet.

## Summary

- **Devnet deposits never completed, for three independent reasons:**
  - the QR format
  - the signing order and the wallet's network
  - a recipient with no USDC account

  #98 fixes all three. Only a real Phantom on devnet can confirm it.
- **No browser-wallet transaction has ever landed on the program.** All 128 of its devnet
  transactions were signed by CLI keys. Vault transfer, session create and the bootstrap
  wizard share the deposit's signing flaw. #99 fixes them, with the same caveat.
- **CI has been red on `main` since 2026-09-30.**
  - A Biome error, fixed in #98.
  - `pnpm audit`, still red, almost entirely from `@sodax/sdk`.
  - The nightly E2E has been red since 2026-09-29 because the devnet CI key ran out of SOL.
- **Production chat runs on the operator's personal Claude login,** unbilled, for every
  signed-in user.
- **Mainnet is not close.** ADR-011's own gates are open:
  - a multisig upgrade authority
  - a custodian-held vanity program id
  - an external audit
  - a reproducible verified build

  There are also no priority fees, no published packages, and a custodial deposit flow that needs legal review.

---

## 1. The deposit failure

### 1.1 QR: "this QR code is not a valid address"

The QR encoded a Solana Pay **transaction request**:
`solana:https://console.ash.app.br/api/billing/deposits/<id>/tx`. With a fee wallet configured,
the server built the transfer and paid its fee.

Phantom's **in-app scanner** reads only addresses and Solana Pay **transfer requests**
(`solana:<recipient>?amount=…&spl-token=…&reference=…`). For anything else it shows exactly
that message and never fetches the link.

- **The phone never reached the server.** The tx route has logged every wallet hit since #97
  went live (2026-10-01 03:42 UTC). It recorded zero GETs from any wallet, only POSTs from the
  dashboard's own button.
- **It isn't a network block.** The same route answers wallet-style requests (Phantom,
  okhttp and Dart user agents) with 200 from outside, so Cloudflare blocks nothing.
- **Another project hit the same thing.** hihodl-web#35 (2026-09-27) got the identical message
  from Phantom's scanner and fixed it the same way, by switching to a transfer request.
- **Phantom's own announcement** promises transaction requests only from a tapped `solana:`
  link or the phone's camera app.
- **#96 could not fix it.** Its encoding change (encode the link only when it has a query) was
  correct per the spec, but the scanner does not read this kind of link at all.

### 1.2 "Pay with <wallet>": signed, never landed

Six attempts from Opera on Windows reached the server. The server built a transaction each
time, and that transaction simulates fine on devnet. None reached the chain: the wallet
`2BDm9JPX…2mvR` shows only two incoming USDC faucet claims on devnet since then.

The flow had four problems:

1. **The server signed first.** It signed as fee payer, then asked the extension to sign and
   send. Phantom's guidance for transactions with several signers is the opposite order: sign
   with Phantom first via `signTransaction`, then collect the other signatures. Phantom may add
   Lighthouse assertion instructions, which invalidates any earlier signature.
2. **The wrong network.** A wallet that sends does so on the network it is set to. A devnet
   transaction from a wallet left on mainnet never lands.
3. **An undocumented payload.** The dashboard called the injected
   `request({ method: "signAndSendTransaction", params: { message } })` with the full v0 wire
   bytes. Phantom documents that form only with a legacy `serializeMessage()`.
4. **Unreadable errors.** Wallets reject with plain `{ code, message }` objects. The dialog
   printed them with `String()`, which gives "[object Object]". That is likely why no error
   text was ever reported.

### 1.3 The recipient had no USDC account

`SOLANA_PAY_RECIPIENT` (`G2Rak…`) has no devnet USDC token account. A plain transfer request
cannot create one: Solana Pay's own `createTransfer` refuses a recipient without it. So even a
correct QR would have failed.

---

## 2. Fixes

### PR #98: deposits (merged as `255f701`)

- **The QR, "Open in wallet" and the copied link** are a plain transfer request, which every
  wallet's scanner reads. The payer's wallet covers a network fee of a fraction of a cent.
- **"Pay with <wallet>"** keeps the fee covered:
  1. `POST /api/billing/deposits/<id>/pay` returns the transfer unsigned, with the platform as
     fee payer.
  2. The wallet signs through the Wallet Standard (`solana:signTransaction`), with wire bytes
     in and out.
  3. `POST /api/billing/deposits/<id>/submit` checks the result before the fee wallet signs
     anything, then co-signs and sends it with preflight to the deposit's own cluster. The
     checks are:
     - exactly two signers, with the fee payer first and still unsigned
     - a valid customer signature
     - exactly the requested `createIdempotent` and `transferChecked` instructions
     - at most a compute budget under a priority-fee cap, plus Lighthouse assertions that
       never name the fee payer
- **The session-less `/tx` route is gone.** No route signs anything for an anonymous caller.
- **The fee wallet opens the recipient's USDC account** on the first deposit request. This is
  idempotent and paid once.
- **Wallet errors read as their message.** Code 4001 maps to "rejected".
- **The Biome error that kept CI red is fixed** (`withdraw-dialog.tsx` effect dependencies).
- **Verification:**
  - `scripts/verify.sh ts` is green apart from `pnpm audit`.
  - The dashboard unit tests pass 502/502, including 11 cases for what the fee wallet refuses
    to co-sign.
  - The Playwright suite passes 62/62.
  - Run against npmjs, `pnpm audit` gives the same result as `main`, and none of the advisories
    come from the new Wallet Standard packages.

### PR #99: every wallet flow signs first and the dashboard sends (merged as `b8dcc6f`)

Vault transfer, session create and the bootstrap wizard use one path, `signAndSend`:

1. The wallet signs through the Wallet Standard.
2. A key the browser holds signs after it. This is the `create_key`, for the treasury stage.
3. `POST /api/solana/send` relays the result to the workflow's cluster. It signs and adds
   nothing, and it refuses a transaction with a signature missing.

Further changes:

- **ADR-021 has a dated amendment.** Its wave-2A "create_key before the wallet" rule is reversed.
- **The injected `request()` signing helper is removed.**
- **The Playwright wallet stub signs through the Wallet Standard.** It now records what it was
  asked to sign, and the bootstrap spec asserts the new order.

### What only a human can verify

The Playwright suite stubs the wallet, so a green run proves nothing about a real one.

**Before relying on either PR:**
1. Deploy.
2. In Phantom, open *Settings → Developer Settings → Testnet Mode* and pick Devnet.
3. Run:
   - a deposit by QR, using Phantom's own scanner
   - a deposit with *Pay with Phantom*
   - a vault deposit
   - the bootstrap wizard
4. The server logs `[billing] sponsored deposit sent|refused intent=…` for deposits.
   `docs/runbooks/dashboard-smoke.md` has never been signed off.

---

## 3. Devnet: what is missing

| # | Item | Evidence | Who | Action |
|---|---|---|---|---|
| 1 | Deposits never complete | §1 | code | #98, then the Phantom test |
| 2 | No browser-wallet transaction has ever landed on the program | All 128 devnet transactions are CLI-signed; the bootstrap pre-signed with `create_key`; the UI suite stubs the wallet | code + human | #99, then the Phantom smoke test |
| 3 | CI red on every push since 2026-09-30 | Biome error (fixed in #98) and `pnpm audit`: 52 advisories, 19 high. `axios` (14 high), `toml` (2) and `bigint-buffer` (1) come through `@sodax/sdk` 2.1.0 in `packages/integrations`; `ws` (1) through the Solana client stack | decision | `pnpm.overrides` for `axios` and `ws`; for `toml` and `bigint-buffer` (no fixed release), a justified audit exception or SODAX moved out of the default build |
| 4 | Nightly E2E red since 2026-09-29 | The devnet preflight needs ≥ 0.1 SOL on CI key `5eznzq18…`, which holds 0.0014 | human | Fund it at faucet.solana.com |
| 5 | Production chat runs on the operator's personal Claude login, unbilled | `/usr/bin/claude` is runnable by the service user, `CLAUDE_CODE_OAUTH_TOKEN` is in `/etc/agent-rails/dashboard.env`, and `resolveProvider` tries `claude-cli` first. Deposited credit is never spent. Tools are denied, so it is a cost and terms problem, not a security hole | human | Remove the token from production; merge `feat/tenant-own-llm-key` or set `OPENROUTER_API_KEY` |
| 6 | Nothing runs on devnet | No program transaction since 2026-09-26; the reference agent is stopped; the guardian watcher is `workflow_dispatch` only | human | Restart the reference agent; schedule the watcher |
| 7 | Public RPC throttles | 429s during this audit; `SOLANA_PAY_RPC_URL` is unset in production | human | A free-tier Helius or Triton endpoint |
| 8 | The front door is sign-in only | `/`, `/terms` and `/privacy` all 307 to `/account`; there are no terms or privacy pages | team | Pages (Lucas, D-6) |
| 9 | Restore test never run | The first run is due Mon 2026-10-05 | human | Read its result |

**What is healthy:**
- the dashboard and Supabase units are up
- disk is at 19%
- the nightly backup ran on 2026-10-02 at 03:05 UTC and was shipped offsite at 04:00

---

## 4. Mainnet: what is missing on top

| Area | State | Needed |
|---|---|---|
| Program id | `4qjD6…` is hard-coded in `@agent-rails/contract` and the generated client | ADR-011: a `rail…` vanity id held by the multisig custodians, then `declare_id!`, `Anchor.toml`, the IDL, codegen and every manifest; at least a week of devnet soak on the same id |
| Upgrade authority | One offline key, `F2zW38…` | ADR-011: Squads 3-of-5 with at least one external signer, a timelock and 72 h public notice |
| Audit | None | ADR-011 budgets $30–80k for 1.0.0; a 1.0.0-beta mainnet launch before the audit is allowed only with the multisig and TVL guidance |
| Verified build | The hash is toolchain-pinned, not container-hermetic: solana-verify publishes no images for Agave 3.x | A hermetic build, or say plainly what reproduces |
| On-chain metadata | No `security_txt!`; no IDL on chain | `solana-security-txt`; the IDL via Program Metadata (ADR-011 point 5) |
| Priority fees | None in the SDK, CLI, dashboard or MCP | A compute-unit limit and price on every transaction (the CU baselines exist) |
| RPC | Public endpoints | A paid mainnet RPC with websockets |
| Fee wallet | A hot key in a plain env file | A low balance plus a balance alert |
| Packages | Nothing on npm (all five return 404; `NPM_TOKEN` is unset) | Publish the SDK, MCP and CLI for third-party agents |
| Unsafe default | Leaving `SOLANA_PAY_CLUSTER` unset means mainnet, with real USDC | Make it required |
| Custody | Chat-credit deposits send USDC to an operator wallet, and withdrawals are paid by hand | Legal review before real money: this is custodial, against business rule 2 and the non-custodial pitch |
| Governance | Branch protection still needs two required reviews (a GitHub setting); the bug bounty is inactive | ADR-011 points 3 and 6 |
| Wizard | The dashboard refuses mainnet by design | Lift it deliberately, after everything above |

---

## 5. Human-only checklist

- [x] Retarget #99 to `main` through the REST API before merging #98 with `--delete-branch`.
      Deleting the parent branch closes a stacked child PR.
- [x] Merge #98 and #99 (2026-10-02, 05:24 and 05:25 UTC).
- [ ] Deploy `origin/main` with `deploy/vps/push-deploy.sh`.
- [ ] Run the Phantom smoke test on devnet from §2.
- [ ] Fund the CI key `5eznzq18…` with at least 0.1 devnet SOL.
- [ ] Remove `CLAUDE_CODE_OAUTH_TOKEN` from production. Then give the chat a provider: set
      `OPENROUTER_API_KEY` or merge `feat/tenant-own-llm-key`.
- [ ] Decide the `pnpm audit` policy.
- [ ] Restart the reference agent and schedule the guardian watcher.
- [ ] Set `SOLANA_PAY_RPC_URL` to a dedicated endpoint.
- [ ] Add the terms and privacy pages.
- [ ] Read the first restore-test result (Mon 2026-10-05).

## Sources

- hihodl-web PR #35, Phantom's scanner on transaction requests:
  <https://github.com/hihodl/hihodl-web/pull/35>
- Phantom, introducing deeplinks (transaction requests from a tapped link or the camera app):
  <https://phantom.com/learn/blog/introducing-phantom-deeplinks>
- Phantom, domain and transaction warnings (sign first when there are several signers):
  <https://docs.phantom.com/developer-powertools/domain-and-transaction-warnings>
- Phantom, Lighthouse transaction validation:
  <https://docs.phantom.com/developer-powertools/lighthouse>
- Phantom, sending a transaction (`request()` takes the serialized message):
  <https://docs.phantom.com/solana/sending-a-transaction>
- Phantom, Testnet Mode: <https://docs.phantom.com/developer-powertools/testnet-mode>
- ADR-011 (governance and release) and ADR-021 (operator surfaces), in `docs/adr/`.
