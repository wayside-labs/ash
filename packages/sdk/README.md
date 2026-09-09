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
import { createSolanaRpc, createNoopSigner } from "@solana/kit";
import { buildPaymentIntent, simulatePayment } from "@agent-rails/sdk";

const rpc = createSolanaRpc("https://api.devnet.solana.com");
const { blockhash, lastValidBlockHeight } = await rpc.getLatestBlockhash().send();

const payment = await buildPaymentIntent({
  intent_id: "...", // optional 32-char hex; auto-generated if omitted
  mint: "So11111111111111111111111111111111111111112",
  destination: "...",
  amount: 1_000_000n,
  expires_at: Math.floor(Date.now() / 1000) + 300,
  treasury: "...",
  policy: "...",
  session: "...",
  feePayer: keypairSigner,
  sessionKey: sessionSigner,
  recentBlockhash: { blockhash, lastValidBlockHeight },
});

await simulatePayment({ rpc, transactionMessage: payment.transactionMessage });
```

`buildPaymentIntent` routes native SOL to `execute_payment_sol` and SPL mints to `execute_payment`, deriving receipt, event authority, vault, and ATA PDAs automatically.
