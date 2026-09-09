# @agent-rails/sdk

Hand-written Kit plugin on top of the Codama-generated `@agent-rails/client`.

## Regenerating the on-chain client

The Anchor IDL is checked in at `idl/agent_rails.json`. Regenerate it without a full `anchor build`:

```bash
pnpm idl:build
```

Then regenerate the TypeScript client:

```bash
pnpm codegen
```

CI should fail if `packages/client/src/generated` drifts (`pnpm codegen:check`).

## Usage (scaffold)

```ts
import { createSolanaRpc, createSolanaRpcSubscriptions } from "@solana/kit";
import { agentRails, buildPaymentIntent } from "@agent-rails/sdk";

const rpc = createSolanaRpc("https://api.devnet.solana.com");
const plugin = agentRails({
  session: "...",
  signer: keypairSigner,
});

const intent = buildPaymentIntent({
  mint: "...",
  destination: "...",
  amount: 1_000_000n,
  expiresAt: Math.floor(Date.now() / 1000) + 300,
});
```

Preflight simulation, error mapping, and instruction builders are stubbed for the next SDK iteration.
