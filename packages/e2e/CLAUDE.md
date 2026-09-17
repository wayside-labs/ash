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

## Scope, and what it is not

SOL path only. `execute_payment_sol` needs no mint, no ATAs and no token program, which cuts
most of the setup while leaving idempotency, the receipt, the audit chain and the
confirmation handling identical — spec §10 separates the two paths on compute, not on logic.
An SPL leg is the obvious next addition.

Not real devnet. The surfnet *forks* devnet, so uncreated accounts are fetched from the real
cluster, but the program runs locally. Deploying to devnet proper needs 7.10 SOL for
programdata against the 5 SOL the CI key holds — see ADR-015's devnet-smoke row.
