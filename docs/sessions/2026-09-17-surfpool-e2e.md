# Session log — 2026-09-17: closing the last actionable CI row

What was built, and the decisions taken along the way that a reader would otherwise have to
reconstruct from the diff. ADRs record decisions that bind the project; this records the
ones that bound a sprint.

## What landed

`packages/e2e/` — layer 5 of the ADR-008 pyramid, the only tests where the TypeScript client
talks to a validator. Four tests across two files, ~45s. Wired as `scripts/verify.sh e2e`
and `.github/workflows/e2e.yml` (nightly). ADR-015's "Surfpool E2E" row moved to
"Enforced today"; the deferred table is down to three rows, none of which anyone here can
close.

## Decisions, and why

### Surfpool forking devnet, not real devnet

The brief asked for the suite to run against real devnet. It cannot, and the number is the
argument: deploying this program needs **7.10 SOL** for programdata alone (`solana rent` on
`2 × 698264 + 45` bytes), against the **5 SOL** the CI key holds, before the transient
buffer. The program is not deployed on devnet today, and the faucet rate-limits.

A surfnet forked from devnet keeps most of what real devnet was wanted for: a real validator
with real confirmation semantics, real blockhash expiry, and accounts the tests do not
create fetched from the live cluster. What it does not reproduce is wide-area latency and
packet loss. That is a real gap, and it is smaller than it sounds, because the scenario the
brief actually cares about — a dropped confirmation — is reproduced deterministically rather
than waited for.

This belongs to ADR-015's still-deferred devnet-smoke row, which is a funding decision.

### The SOL path, not SPL

`execute_payment_sol` needs no mint, no associated token accounts and no token program,
which removes roughly two thirds of the setup. Nothing under test goes with it: idempotency,
the receipt PDA, the audit chain and the confirmation handling are identical on both paths,
and spec §10 separates them on compute only. An SPL leg is the obvious next addition; it was
not worth blocking the gate on.

### Blinding the status read, not the send

The proxy forwards everything faithfully except `getSignatureStatuses`, which it answers
with a shape-accurate null. The transaction is relayed, executes, and settles — only the
answer is withheld.

Blinding the send would have been easier and would have tested nothing: a dropped send is
the case where nothing happened. The dangerous case is the one where the money moved and the
caller cannot tell, because that is the one where a retry pays twice. An error response
would have exercised the transport-failure branch instead of the timeout branch, so the
proxy returns the `{context, value: [null]}` a lagging node really sends.

### The guard was narrowed, then the narrowing was given back

`.claude/hooks/guard.sh` denies every `solana program deploy`, and the first harness needed to
deploy on every run. The rule was narrowed — with the owner's decision, not the agent's — to
exempt deploys explicitly pinned to loopback.

That change is **not** in the final diff, because the harness stopped needing it. The
program is now installed by writing the loader's accounts through Surfpool's
`surfnet_setAccount`, so no deploy command runs at all. A security control you no longer
need to touch is one you should not touch, and the narrowed rule was reverted once the
keyless path worked.

The reason the keyless path exists is not elegance. `solana program deploy` deploys at whatever
address its keypair file names, and `target/deploy/agent_rails-keypair.json` is gitignored
because `.gitignore` refuses to carry raw secret keys. Locally that file holds the key
behind `declare_id!` and everything worked; in CI `cargo build-sbf` minted a fresh one, the
program landed at `FFKD9nM8…` instead of `4qjD6vSg…`, the deploy command exited 0, and every
instruction would have failed its own declared-id check. A surfnet owns its ledger, so the
program can simply be placed where the program says it lives.

### The secret does real work

The surfnet leg does not need `DEVNET_KEYPAIR`. Rather than inject it decoratively, the
workflow uses it for a devnet preflight: the surfnet forks devnet, so an unreachable cluster
degrades the fork and would make a red suite look like a client regression. It also keeps
the deferred devnet-smoke row's precondition honest — a drained key should be visible before
it blocks a release, not after. The key is written under `umask 077`, never echoed, never
passed as an argument, and deleted in a step that always runs.

## Both directions, which is the part that counts

Two mechanisms stop the double payment, and each was broken on purpose:

- Retry with a **random** `intent_id` instead of the derived one: the second payment
  succeeds and the suite catches the double spend —
  `a second payment on a spent intent_id must fail: expected null not to be null`.
- Change the SDK's `indeterminate()` to report `denied`: the first test catches it —
  `expected 'denied' to be 'indeterminate'`.

## The gate that passed without running

The first CI run of this workflow reported **green having executed no tests**, and it took
three independent failures lining up:

1. The install step fetched `https://install.surfpool.run`, a host that does not exist. The
   URL was invented rather than looked up.
2. `curl -sSfL ... | bash` gives the pipeline `bash`'s exit status, not `curl`'s, so
   `shell: bash -e` saw a success. `curl: (6) Could not resolve host` scrolled past as
   ordinary output.
3. `scripts/verify.sh` then did exactly what it was designed to do — skip loudly rather than
   pass quietly when the tool is absent — and "loudly" means nothing in a log nobody reads.

Each layer behaved as specified and the composition reported success. The fixes are a
checksum-pinned tarball from the real release, `set -o pipefail`, and `VERIFY_STRICT=1`,
which turns a skip into a failure and is now set in the kani and mutants jobs too, since
they call the same script with the same escape hatch.

The third is the general one. A loud skip is right for a developer's terminal and wrong for
CI, and the script could not previously tell the two apart. This is the second time in this
repository that a tool's presence turned a gate into a tautology, after the coverage binary;
it is the first time it happened in CI rather than locally.

## Two harness bugs worth remembering

The first version polled `getHealth` on a fixed port and found a **stray surfpool from an
earlier run**. Its own child had died on "port already in use", the health check passed
against the other process, and the suite went on to test a validator it had not deployed to.
The harness now takes an ephemeral port and fails if its own child exits. A liveness probe
that cannot tell whose liveness it is measuring is worse than none.

`solana program deploy` opens a TPU client over the websocket port and **panics** — not
fails — when it cannot connect. Surfpool's websocket defaults to 8900 regardless of
`--port`, so it has to be pinned too, and the deploy uses `--use-rpc`.

## What is left, and who unblocks it

| Row | Blocker | Who |
|---|---|---|
| Trident stateful fuzzing | Every published Trident needs `solana-sdk ^2.3`; this tree is Anchor 1.1.2 on solana 3.x | Trident upstream |
| Verifiable build hash | No ADR-011 release workflow; no tag ever pushed | First release |
| devnet smoke on release tags | Same release workflow, plus ~7.1 SOL to deploy | First release / funding |
