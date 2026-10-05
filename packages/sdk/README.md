# @ash/sdk

Hand-written Kit plugin on top of the Codama-generated `@ash/client`.

## Regenerating the on-chain client

The Anchor IDL is checked in at `idl/ash.json`. Regenerate it without a full `anchor build`:

```bash
pnpm idl:build
```

Then regenerate the TypeScript client:

```bash
pnpm codegen
```

CI should fail if `packages/client/src/generated` drifts (`pnpm codegen:check`).

## Usage

```ts
import { createSolanaRpc } from "@solana/kit";
import { deriveIntentId, intentIdToHex, toBaseUnits } from "@ash/contract";
import { buildPaymentIntent, executePayment, precheckReceipt } from "@ash/sdk";

const rpc = createSolanaRpc("https://api.devnet.solana.com");

// The intent id is derived from the payment, not drawn at random: a retry of the same
// payment lands on the same IntentReceipt PDA and the program refuses it (ADR-004).
const intentId = deriveIntentId({
  session,
  destination,
  mint,
  amount: toBaseUnits("12.50", 6), // decimals come from the treasury's MintConfig
  reference: "INV-2026-0041",
});

const precheck = await precheckReceipt({ rpc, session, intentId });
if (precheck.settled) return precheck; // already paid; nothing to send

const { blockhash, lastValidBlockHeight } = await rpc.getLatestBlockhash().send();
const payment = await buildPaymentIntent({
  intent_id: intentIdToHex(intentId),
  mint,
  destination,
  amount: toBaseUnits("12.50", 6),
  expires_at: Math.floor(Date.now() / 1000) + 90,
  treasury,
  policy,
  session,
  feePayer: keypairSigner,
  sessionKey: sessionSigner,
  recentBlockhash: { blockhash, lastValidBlockHeight },
});

const result = await executePayment({
  rpc,
  transactionMessage: payment.transactionMessage,
  lastValidBlockHeight,
  session,
  intentId,
});
```

`buildPaymentIntent` routes native SOL to `execute_payment_sol` and SPL mints to `execute_payment`, deriving receipt, event authority, vault, and ATA PDAs automatically.

## Outcomes

`executePayment` either returns a settled result or throws `AshError`, whose `outcome`
is the field that matters:

- `denied` — a rule refused it and nothing moved. Safe to change something and try again.
- `indeterminate` — the transaction was broadcast and the outcome is unknown. **Never retry.**
  Call `resolvePaymentOutcome` and act on what the receipt says.

`executePayment` already attempts that resolution before it throws, so an indeterminate error
means the receipt was genuinely not observable. The distinction is not cosmetic: treating an
unconfirmed send as a denial is how a slow RPC node becomes a duplicate payment.

## Destinations

`loadDestinationIndex` reads the `AllowlistEntry` PDAs for a policy and `resolveDestination`
maps a label to a wallet owner by exact match after normalization. There is deliberately no
fuzzy matching: the value of an allowlist is that a close-enough name does not get paid.

## Guard-rails

```ts
const client = createSolanaRpc(url).use(
  ash({
    session,
    signer,
    security: { preset: "strict", hooks: [openInvoiceCheck] },
  }),
);
```

`resolveSecurity` validates the posture when the client is built, so a malformed override is
a startup error rather than a surprise on the first payment. `securityCoherenceWarnings`
compares a posture against the chain it points at and explains relaxations the program will
refuse anyway. See the MCP README for the knob-by-knob table.

## Signing

The `Signer` type is Kit's `TransactionPartialSigner`. `createRemoteSigner` keeps the session
key in a separate service or enclave, so the process that parses untrusted tool arguments
holds no key material.
