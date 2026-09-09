# @agent-rails/client

100% Codama-generated Solana Kit client for the `agent_rails` program. Do not hand-edit files under `src/generated/` — regenerate from the Anchor IDL instead.

## Regenerate

From the repo root:

```bash
pnpm idl:build   # extract idl/agent_rails.json (no full anchor build)
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
  programs/       AGENT_RAILS_PROGRAM_ADDRESS, AgentRailsInstruction enum, client helpers
  types/          PaymentIntent, MintLimit, PolicyArgs, …
```

## Usage

```ts
import {
  AGENT_RAILS_PROGRAM_ADDRESS,
  getExecutePaymentSolInstructionAsync,
  findSessionPda,
} from "@agent-rails/client";
```

For higher-level helpers (`PaymentIntent`, preflight, error mapping), use `@agent-rails/sdk`.
