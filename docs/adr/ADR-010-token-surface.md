# ADR-010: SPL + Token-2022 with an extension gate, native SOL vault, fund lifecycle semantics

**Status:** Accepted

## Context

Anchor's `token_interface` lets one instruction serve SPL Token and Token-2022 via `transfer_checked`. Token-2022 extensions are not uniformly safe for a policy engine: `TransferFee` changes the received amount, `TransferHook` injects arbitrary CPI accounts, `ConfidentialTransfer` hides amounts, `PermanentDelegate` lets a mint authority pull from the vault. Native SOL is not an SPL token.

## Options considered

- A. SPL Token only, wSOL for SOL.
- **B. SPL + Token-2022 with a per-mint extension allowlist, native SOL via a lamport vault PDA, policy-gated ATA creation, pause never blocks owner exit.**
- C. B plus `TransferHook` support (arbitrary code inside the payment CPI).
- D. B but SOL via wSOL unwrap-on-pay.

## Decision

Option B.

1. `Treasury` is the token authority; vaults are its ATAs, created idempotently in `add_mint`.
2. `add_mint` (owner-only) is the extension gate. Rejected: `TransferHook`, `ConfidentialTransfer`, `NonTransferable`. Allowed: `TransferFee`, `MetadataPointer`/`TokenMetadata`, `InterestBearing`, `DefaultAccountState`, `PermanentDelegate` (CLI warning). The mint's token program id is stored and asserted in `execute_payment`.
3. `TransferFee`: limits apply to the amount debited from the vault; `check_payment` reports `amount_sent` and `estimated_amount_received`.
4. Native SOL: `sol_vault` (system-owned PDA, `["sol_vault", treasury]`), addressed by the native-mint sentinel; payments go to system-account destinations; a rent-exempt floor is never spendable.
5. `Policy.create_destination_ata` (default `false`); when true, `create_associated_token_account_idempotent` funded by `fee_payer`.
6. Deposits are permissionless with no instruction; the SDK offers `deposit()` sugar; the CLI warns about un-added mints.
7. Withdraw: owner-only, any mint/amount/destination, allowed while paused. `recovery_destination` reserved for v1.1 timelock exemption.
8. Pause blocks `execute_payment` only; `pause` by owner/operator/guardian; `unpause` by owner/operator.
9. Close instructions for treasury, policy, session, allowlist entry with dependency checks; receipts close permissionlessly.
10. Budget: `execute_payment` ≤ ~40k CU, ≤ ~600 bytes with legacy addressing.

## Consequences

- Covers nearly all real payment mints; SOL recipients receive real SOL.
- Extension inspection and the `sol_vault` path are additional audit surface, both small and testable.
- `TransferHook` mints are unsupported until a concrete need justifies the risk.
