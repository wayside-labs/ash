# @agent-rails/e2e

Layer 5 of the ADR-008 pyramid. The only tests in this repository where the TypeScript
client talks to a validator.

## Why this layer exists at all

Layers 1-4 execute instructions. They do not have a blockhash that expires, a
`getSignatureStatuses` that lags behind inclusion, or a confirmation that can be waited on
and time out — and every one of those is load-bearing in `packages/sdk/src/send-payment.ts`.
Before this package, that file's entire failure taxonomy was asserted only against mocks of
the RPC it was written to survive.

## The blinding proxy is the point

`src/harness/blinding-proxy.ts` sits between the client and the surfnet and forwards
everything faithfully except `getSignatureStatuses`, which it answers with a shape-accurate
null. The transaction is relayed, executed, and settles; only the *answer* is withheld.

Blind the status read, never the send. A dropped send is the easy case — nothing happened.
The dangerous case is the one where the money moved and the caller cannot tell, because that
is the one where a retry pays twice. If you add a test here, make it fail in that direction.

## Both protections, one scenario

`indeterminate.e2e.test.ts` asserts the two mechanisms that stop the double payment, and
they are independent on purpose:

1. The SDK reports `indeterminate` / `UNRESOLVED_OUTCOME`, never `denied`. "Denied" reads as
   an invitation to retry.
2. The on-chain `IntentReceipt` refuses the retry anyway, because `deriveIntentId` is
   deterministic and the second attempt addresses the same PDA.

Both were verified by breaking them. Point the retry at a random `intent_id` and the second
payment succeeds — the suite catches the double spend. Change `indeterminate()` in the SDK to
report `denied` and the first test catches that. A green run here has been seen red.

## Running it

`scripts/verify.sh e2e`. Needs `surfpool` on PATH and `target/deploy/agent_rails.so` built
(`cargo build-sbf`); the group skips loudly without either rather than passing. It is
deliberately **not** part of `verify.sh all` — it boots a validator per file and deploys a
700 KB program, and ADR-008 scopes layer 5 to nightly.

The gate runs this package first, then `pnpm --filter @agent-rails/mcp test:e2e`, which
imports `exports` from here (`harness/surfnet`, `harness/blinding-proxy`) so the MCP handler
suite does not carry a second copy of the harness.

The harness installs the program by writing the loader's accounts through Surfpool's
`surfnet_setAccount` cheatcode, not by running a deploy command. That is not a shortcut, it
is the only thing that works: `solana program deploy` deploys at whatever address its keypair
file names, and `target/deploy/agent_rails-keypair.json` is gitignored, because `.gitignore`
refuses to carry raw secret keys. On a developer's machine that file happens to hold the key
behind `declare_id!`; on a fresh checkout `cargo build-sbf` mints a new one, the program
lands at a random address, and every instruction fails its own declared-id check. CI did
exactly that, silently, at a program id nobody recognised.

A surfnet owns its ledger, so the program can simply be placed where the program says it
lives. No keypair enters the repository and no deploy command runs — which also means
`.claude/hooks/guard.sh` needs no exception for this suite.

## The SPL leg pays in the real token

`spl-payment.e2e.test.ts` uses Circle's **actual devnet USDC mint**, not one the harness
created. The surfnet forks devnet, so that mint is already there with its real decimals: the
program reads six from the account Circle deployed, and a decimals bug would show up here
rather than against a stand-in the harness chose to make convenient.

What is faked is only the balances. Nobody but Circle can mint that token, so
`surfnet_setTokenAccount` writes the vault's account and opens the destination's — the same
move `install-program.ts` makes for the loader, and for the same reason: a surfnet owns its
ledger. The destination's account has to exist beforehand because the policy is created with
`createDestinationAta: false`; the payment path must not be able to open accounts.

The SOL argument — that the two paths differ only in compute (spec §10) — is right about the
policy engine and wrong about everything the token path adds on top: two associated token
accounts, a mint whose decimals the program reads, and a CPI into a token program that can
fail in ways the native path has no equivalent of.

## Scope, and what it is not

Not real devnet. The surfnet *forks* devnet, so uncreated accounts are fetched from the real
cluster, but the program runs locally. The program **is** deployed on devnet now, and
`scripts/devnet-smoke.sh` pays against it on every release tag — that is where a payment
meets a real cluster, and this suite is where it meets one that can be made to misbehave on
demand.
