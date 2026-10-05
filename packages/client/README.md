# @ash/client

100% Codama-generated Solana Kit client for the `ash` program. Do not hand-edit files under `src/generated/` — regenerate from the Anchor IDL instead.

## Regenerate

From the repo root:

```bash
pnpm idl:build   # extract idl/ash.json (no full anchor build)
pnpm codegen     # render Kit client into src/generated/
```

CI drift gate:

```bash
pnpm codegen:check
```

## Layout

```
src/generated/
  accounts/       Treasury, Policy, AgentSession, AllowlistEntry, IntentReceipt
  instructions/   22 typed instruction builders (sync + async account resolution)
  pdas/           treasury, policy, session, solVault, allowlist entry
  events/         PaymentExecuted, TreasuryPaused, …
  errors/         Anchor custom errors 6000–6041
  programs/       ASH_PROGRAM_ADDRESS, AshInstruction enum, client helpers
  types/          PaymentIntent, MintLimit, PolicyArgs, …
```

## Usage

```ts
import {
  ASH_PROGRAM_ADDRESS,
  getExecutePaymentSolInstructionAsync,
  findSessionPda,
} from "@ash/client";
```

For higher-level helpers (`PaymentIntent`, preflight, error mapping), use `@ash/sdk`.
