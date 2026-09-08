# ADR-001: Native PDA vault with no external program dependencies

**Status:** Accepted

## Context

Funds must live somewhere the agent cannot reach except through the policy engine. Squads v4 offers audited custody and spending limits but a coarse, human-oriented policy surface and a hard dependency on its program ids and upgrade cadence. An off-chain policy proxy with an SPL delegate is not trust-minimized.

## Options considered

- **A. Pure custom Anchor program** (PDA vault + policy accounts).
- B. Squads v4 as vault, our program as a spending-limit member (two-hop CPI).
- C. Pluggable vault backends behind a policy engine (v1 complexity too high).
- D. Off-chain policy with an SPL delegate (not trust-minimized).

## Decision

Option A. The `Treasury` PDA is the vault authority; vaults are its associated token accounts plus a system-owned `sol_vault`. The program CPIs only into SPL Token / Token-2022, the ATA program, and the System program. `execute_payment` is single-hop.

The policy engine (`Policy`, `AgentSession`, `AllowlistEntry`, `IntentReceipt`) is modeled independently of the vault so that pluggable backends (Squads spending limit, custom adapters) can be added in v2 without changing policy semantics.

## Consequences

- We own custody risk end to end; the human control plane is not inherited (see ADR-002).
- Full control over CU, transaction size, and DX; no third-party program to mock in tests.
- Owners wanting M-of-N control set `owner` to a Squads or Realms PDA (ADR-002), which gives multisig compatibility without a dependency.
