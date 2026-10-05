---
description: Regenerate the IDL and TypeScript client after changing program instructions or accounts.
---

Run `pnpm idl:sync`, then `scripts/verify.sh`.

`idl:sync` chains the three steps in the order that matters — `idl:build` extracts the IDL
from the program, `codegen` regenerates `packages/client/src/generated` from it, and only
then does `build` compile sdk and mcp against the new client. Running them out of order
silently builds the TypeScript side against the previous ABI.

Never hand-edit anything under `packages/client/src/generated`. To change what is generated,
change the program or `packages/client/codama.json` and run this again. CI's
`pnpm codegen:check` regenerates and fails on any difference, so a hand edit does not
survive review.

`idl:build` needs the Solana toolchain and anchor 1.1.2 on PATH. If it is not available,
say so rather than committing a client regenerated from a stale IDL.

Read the IDL diff before committing. A changed account layout is a breaking change for
every downstream client and indexer, and it must be matched by an update to
`programs/ash/tests/layout.rs` and to `docs/spec/accounts-and-instructions.md` §3.
