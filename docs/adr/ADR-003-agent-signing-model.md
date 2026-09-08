# ADR-003: Direct session signer in v1, `PaymentIntent` payload prepared for signed-intent mode

**Status:** Accepted

## Context

`execute_payment` must verify that an active, authorized agent session requested the payment. The choice determines whether the agent holds a key, needs SOL and RPC access, and what the portable unit of authorization is for future non-Solana adapters. With a single-hop transaction (ADR-001) there is budget for Ed25519 introspection, but it is a classic audit hotspot.

## Options considered

- **A. Direct session signer**: operator registers `session_key`; agent signs the transaction.
- B. Signer service (KMS/Turnkey/Privy) holds the key; identical on-chain model to A.
- C. Signed `PaymentIntent` + relayer with Ed25519 precompile introspection (gasless, chain-agnostic intent).
- D. Dual-mode A and C in v1 (doubles audit surface).

## Decision

Option A on-chain for v1, with three forward-compatibility commitments:

1. `execute_payment`'s instruction data is a canonical `PaymentIntent { intent_id, mint, destination_owner, amount, expires_at, memo }` with a fixed Borsh serialization and a domain separator, so mode C reuses the payload byte-for-byte.
2. `AgentSession.auth_mode: u8` is reserved (`0 = DirectSigner`, `1 = SignedIntent` in v1.1) alongside padding.
3. `fee_payer` is a distinct account from `session_key`, so operator-sponsored fees work now and a relayer slots in later.

Option B is an SDK concern: the `Signer` type is Kit's `TransactionPartialSigner`; `KeypairSigner` and a generic `RemoteSigner` ship in v1.

## Consequences

- One signer flag is the entire on-chain auth check in v1; no introspection code to audit.
- The agent needs SOL for fees unless the operator sponsors via `fee_payer`.
- v1.1 adds signed-intent mode as a program upgrade plus a reference relayer; the same signed intent becomes the input to TradFi adapters in v2.
