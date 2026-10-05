# ASH — Account & Instruction Specification (v1)

**Program:** `ash` · **Framework:** Anchor 1.x · **Serialization:** Borsh (Anchor default; no alignment padding) · **`PROGRAM_VERSION`:** `1`

This document is the byte-level contract between the program, the Codama-generated clients, the indexer, and the test suite. Account layouts are snapshot-tested in CI (ADR-008); any change here is a breaking change unless it lands inside a `reserved` block.

Related: [`ARCHITECTURE.md`](../../ARCHITECTURE.md) · [ADRs](../adr/README.md)

---

## 1. Constants

| Name | Value | Notes |
|---|---|---|
| `PROGRAM_VERSION` | `1u8` | Written into every account's `version` field |
| `MAX_GUARDIANS` | `5` | Fixed array in `Treasury` |
| `MAX_MINTS` | `4` | Fixed array in `Treasury` and `Policy` |
| `MAX_MEMO_LEN` | `64` bytes | `PaymentIntent.memo` |
| `MAX_NAME_LEN` | `32` bytes | UTF-8, zero-padded; `Policy.name`, labels |
| `MAX_INTENT_TTL_SECONDS` | `3_600` | `intent.expires_at - now` must be `≤` this |
| `MIN_INTENT_TTL_SECONDS` | `5` | Guards against accidentally pre-expired intents |
| `RECEIPT_GRACE_SECONDS` | `3_600` | `close_receipt` allowed after `expires_at + grace` |
| `MIN_WINDOW_SECONDS` | `60` | Lower bound on any window duration |
| `MAX_SESSION_TTL_SECONDS` | `31_536_000` | 365 days; `create_session` upper bound |
| `NATIVE_MINT` | `So11111111111111111111111111111111111111112` | Sentinel for native SOL in `MintConfig` / `MintLimit` / `SpendCounter` |
| `SOL_VAULT_FLOOR_LAMPORTS` | rent-exempt minimum for a 0-byte account (`890_880` at current rent params) | Never spendable; read from `Rent` sysvar at runtime, not hardcoded |
| `DOMAIN_AUDIT` | `b"ash/audit/v1"` | Hash-chain domain separator |
| `DOMAIN_INTENT` | `b"ash/intent/v1"` | Reserved for v1.1 signed-intent mode |

### Enumerations

```rust
#[repr(u8)] pub enum AuthMode        { DirectSigner = 0, SignedIntent = 1 /* v1.1 */ }
#[repr(u8)] pub enum DestinationMode { Any = 0, Allowlist = 1 }
#[repr(u8)] pub enum ReceiptStatus   { Executed = 1 }
#[repr(u8)] pub enum MintFlags       { IsNative = 1 << 0, HasTransferFee = 1 << 1, HasPermanentDelegate = 1 << 2 }
```

---

## 2. PDA seeds

| Account | Seeds | Notes |
|---|---|---|
| `Treasury` | `["treasury", create_key]` | `create_key` is an ephemeral keypair that signs `create_treasury` once (Squads pattern); unlimited treasuries per owner, no index bookkeeping |
| `sol_vault` | `["sol_vault", treasury]` | System-owned, 0 data bytes; bump stored in `Treasury.sol_vault_bump` |
| Vault ATA | ATA derivation `(treasury, mint, token_program)` | One per configured mint; created idempotently in `add_mint` |
| `Policy` | `["policy", treasury, name]` | `name` is the 32-byte zero-padded UTF-8 name |
| `AllowlistEntry` | `["allow", policy, destination_owner]` | Keyed by wallet owner, never by token account |
| `AgentSession` | `["session", treasury, session_key]` | One session per key per treasury; rotation = new key |
| `IntentReceipt` | `["receipt", session, intent_id]` | `intent_id` is the raw 16 bytes |
| Event authority | `["__event_authority"]` | Anchor `emit_cpi!` |

All seeds are ASCII literals without a trailing NUL. Bumps are stored on each account and re-verified with `seeds = [...], bump = account.bump`.

---

## 3. Account layouts

All accounts begin with the 8-byte Anchor discriminator, then `version: u8`, then `bump: u8`. Offsets below are absolute from byte 0.

### 3.1 `Treasury` — 944 bytes

| Offset | Size | Field | Type | Notes |
|---|---|---|---|---|
| 0 | 8 | discriminator | | |
| 8 | 1 | `version` | `u8` | `= PROGRAM_VERSION` |
| 9 | 1 | `bump` | `u8` | |
| 10 | 1 | `sol_vault_bump` | `u8` | |
| 11 | 32 | `create_key` | `Pubkey` | Seed component; never used again |
| 43 | 32 | `owner` | `Pubkey` | Cold |
| 75 | 32 | `operator` | `Pubkey` | Warm |
| 107 | 160 | `guardians` | `[Pubkey; 5]` | Unused slots are `Pubkey::default()` |
| 267 | 1 | `guardian_count` | `u8` | |
| 268 | 1 | `paused` | `bool` | |
| 269 | 8 | `paused_at` | `i64` | Unix seconds; 0 if never |
| 277 | 32 | `paused_by` | `Pubkey` | Last pauser |
| 309 | 1 | `allow_any_destination` | `bool` | Ceiling flag for `DestinationMode::Any` |
| 310 | 1 | `allow_create_destination_ata` | `bool` | Ceiling flag |
| 311 | 8 | `timelock_seconds` | `u64` | **Reserved v1.1.** Must be `0` in v1 |
| 319 | 32 | `recovery_destination` | `Pubkey` | **Reserved v1.1.** Set at creation; timelock-exempt withdraw target |
| 351 | 448 | `mints` | `[MintConfig; 4]` | See 3.1.1 |
| 799 | 1 | `mint_count` | `u8` | |
| 800 | 4 | `active_sessions` | `u32` | Non-revoked, non-closed sessions; gates `close_treasury` |
| 804 | 4 | `policy_count` | `u32` | Open policies; gates `close_treasury` |
| 808 | 8 | `created_at` | `i64` | |
| 816 | 128 | `reserved` | `[u8; 128]` | Zeroed |

Rent ≈ 0.0075 SOL.

#### 3.1.1 `MintConfig` — 112 bytes

| Offset | Size | Field | Type | Notes |
|---|---|---|---|---|
| 0 | 32 | `mint` | `Pubkey` | `NATIVE_MINT` for SOL; `Pubkey::default()` if slot unused |
| 32 | 32 | `token_program` | `Pubkey` | SPL Token, Token-2022, or System program for native |
| 64 | 1 | `decimals` | `u8` | Cached from the mint (9 for SOL) |
| 65 | 1 | `flags` | `u8` | `MintFlags` bitfield |
| 66 | 1 | `funding_mode` | `FundingMode` | `0` = `IsolatedVault`, `1` = `NativeAllowance` (ADR-014) |
| 67 | 5 | `_pad` | `[u8; 5]` | Zeroed |
| 72 | 40 | `ceiling` | `MintCeiling` | See below |

`MintCeiling` — 40 bytes: `max_per_tx: u64`, `max_short_window: u64`, `max_long_window: u64`, `max_lifetime: u64`, `min_short_window_seconds: u32`, `min_long_window_seconds: u32`. Amounts in base units.

### 3.2 `Policy` — 546 bytes

| Offset | Size | Field | Type | Notes |
|---|---|---|---|---|
| 0 | 8 | discriminator | | |
| 8 | 1 | `version` | `u8` | |
| 9 | 1 | `bump` | `u8` | |
| 10 | 32 | `treasury` | `Pubkey` | |
| 42 | 32 | `name` | `[u8; 32]` | Seed component |
| 74 | 384 | `mint_limits` | `[MintLimit; 4]` | See 3.2.1 |
| 458 | 1 | `mint_count` | `u8` | |
| 459 | 1 | `destination_mode` | `u8` | `DestinationMode` |
| 460 | 1 | `require_memo` | `bool` | Non-empty memo required |
| 461 | 1 | `create_destination_ata` | `bool` | Requires ceiling flag |
| 462 | 4 | `active_sessions` | `u32` | Gates `close_policy` |
| 466 | 8 | `created_at` | `i64` | |
| 474 | 8 | `updated_at` | `i64` | |
| 482 | 64 | `reserved` | `[u8; 64]` | Zeroed |

Rent ≈ 0.0047 SOL.

#### 3.2.1 `MintLimit` — 96 bytes

| Offset | Size | Field | Type | Notes |
|---|---|---|---|---|
| 0 | 32 | `mint` | `Pubkey` | Must exist in `Treasury.mints` |
| 32 | 8 | `per_tx_max` | `u64` | |
| 40 | 8 | `short_window_max` | `u64` | |
| 48 | 4 | `short_window_seconds` | `u32` | `≥ MIN_WINDOW_SECONDS`, `≤ long_window_seconds` |
| 52 | 8 | `long_window_max` | `u64` | |
| 60 | 4 | `long_window_seconds` | `u32` | |
| 64 | 8 | `lifetime_max` | `u64` | Per session; `u64::MAX` = unlimited (still `≤` ceiling) |
| 72 | 8 | `approval_threshold` | `u64` | **Reserved v1.1.** Must be `0` in v1 |
| 80 | 4 | `cooldown_seconds` | `u32` | **Reserved v1.1.** Must be `0` in v1 |
| 84 | 12 | `reserved` | `[u8; 12]` | Zeroed |

### 3.3 `AgentSession` — 588 bytes

| Offset | Size | Field | Type | Notes |
|---|---|---|---|---|
| 0 | 8 | discriminator | | |
| 8 | 1 | `version` | `u8` | |
| 9 | 1 | `bump` | `u8` | |
| 10 | 32 | `treasury` | `Pubkey` | |
| 42 | 32 | `policy` | `Pubkey` | |
| 74 | 32 | `session_key` | `Pubkey` | Seed component; signer in `AuthMode::DirectSigner` |
| 106 | 1 | `auth_mode` | `u8` | `AuthMode`; must be `0` in v1 |
| 107 | 32 | `label` | `[u8; 32]` | Human label ("billing-agent-prod") |
| 139 | 8 | `created_at` | `i64` | |
| 147 | 8 | `expires_at` | `i64` | |
| 155 | 1 | `revoked` | `bool` | |
| 156 | 8 | `revoked_at` | `i64` | |
| 164 | 8 | `seq` | `u64` | Executed payments; starts at 0 |
| 172 | 32 | `audit_head` | `[u8; 32]` | See §6 |
| 204 | 320 | `spend` | `[SpendCounter; 4]` | Index-aligned with `Policy.mint_limits` at creation; see 3.3.1 |
| 524 | 64 | `reserved` | `[u8; 64]` | Zeroed |

Rent ≈ 0.0050 SOL.

#### 3.3.1 `SpendCounter` — 80 bytes

| Offset | Size | Field | Type |
|---|---|---|---|
| 0 | 32 | `mint` | `Pubkey` |
| 32 | 8 | `short_window_start` | `i64` |
| 40 | 8 | `short_spent` | `u64` |
| 48 | 8 | `long_window_start` | `i64` |
| 56 | 8 | `long_spent` | `u64` |
| 64 | 8 | `lifetime_spent` | `u64` |
| 72 | 8 | `last_payment_at` | `i64` |

Counters are looked up by `mint`, not by index, so a policy update that reorders slots cannot misattribute spend. A mint added to the policy after session creation gets a zeroed counter on first use if a free slot exists, otherwise `MintNotInSession`.

### 3.4 `AllowlistEntry` — 186 bytes

| Offset | Size | Field | Type | Notes |
|---|---|---|---|---|
| 0 | 8 | discriminator | | |
| 8 | 1 | `version` | `u8` | |
| 9 | 1 | `bump` | `u8` | |
| 10 | 32 | `policy` | `Pubkey` | |
| 42 | 32 | `destination_owner` | `Pubkey` | Wallet owner (system account) |
| 74 | 32 | `label` | `[u8; 32]` | e.g. `"openai-billing"` |
| 106 | 8 | `per_tx_max_override` | `u64` | `0` = no override; otherwise must be `≤` policy `per_tx_max` |
| 114 | 8 | `added_at` | `i64` | |
| 122 | 32 | `added_by` | `Pubkey` | |
| 154 | 32 | `reserved` | `[u8; 32]` | Zeroed |

Rent ≈ 0.0022 SOL.

### 3.5 `IntentReceipt` — 243 bytes

| Offset | Size | Field | Type | Notes |
|---|---|---|---|---|
| 0 | 8 | discriminator | | |
| 8 | 1 | `version` | `u8` | |
| 9 | 1 | `bump` | `u8` | |
| 10 | 32 | `session` | `Pubkey` | |
| 42 | 16 | `intent_id` | `[u8; 16]` | |
| 58 | 32 | `mint` | `Pubkey` | |
| 90 | 32 | `destination_owner` | `Pubkey` | |
| 122 | 8 | `amount` | `u64` | Debited from vault (pre-fee) |
| 130 | 8 | `seq` | `u64` | Session sequence number of this payment |
| 138 | 8 | `slot` | `u64` | |
| 146 | 8 | `timestamp` | `i64` | |
| 154 | 8 | `expires_at` | `i64` | Copied from intent; gates `close_receipt` |
| 162 | 1 | `status` | `u8` | `ReceiptStatus::Executed` |
| 163 | 32 | `fee_payer` | `Pubkey` | Rent refund target |
| 195 | 32 | `memo_hash` | `[u8; 32]` | `sha256(memo)`; zero if empty |
| 227 | 16 | `reserved` | `[u8; 16]` | Zeroed |

Rent ≈ 0.0026 SOL, refunded on close.

### 3.6 `sol_vault`

System-owned PDA with zero data. Balance minus `Rent::minimum_balance(0)` is spendable. Lamports move via `system_program::transfer` with `invoke_signed` using `["sol_vault", treasury, sol_vault_bump]`.

---

## 4. Instruction argument types

### 4.1 `PaymentIntent`

```rust
pub struct PaymentIntent {
    pub intent_id: [u8; 16],        // client-generated; UUIDv7 or deterministic
    pub mint: Pubkey,               // NATIVE_MINT for SOL
    pub destination_owner: Pubkey,  // wallet owner; ATA derived on-chain
    pub amount: u64,                // base units debited from the vault
    pub expires_at: i64,            // unix seconds; now + [MIN, MAX]_INTENT_TTL
    pub memo: Vec<u8>,              // ≤ MAX_MEMO_LEN; stored as sha256 in the receipt
}
```

Serialized size: `100 + 4 + len(memo)` bytes (≤ 168). In v1.1 signed-intent mode the signed message is `DOMAIN_INTENT ‖ program_id ‖ treasury ‖ session ‖ borsh(PaymentIntent)`; this is documented now so v1 SDKs can already produce it.

### 4.2 `MintLimitInput`, `MintCeilingInput`, `PolicyInput`

Mirror the on-chain structs without reserved fields:

```rust
pub struct MintLimitInput  { mint, per_tx_max, short_window_max, short_window_seconds, long_window_max, long_window_seconds, lifetime_max }
pub struct MintCeilingInput{ max_per_tx, max_short_window, max_long_window, max_lifetime, min_short_window_seconds, min_long_window_seconds }
pub struct PolicyInput     { mint_limits: Vec<MintLimitInput> /* ≤ 4 */, destination_mode: u8, require_memo: bool, create_destination_ata: bool }
```

---

## 5. Instructions

Notation: **(s)** signer, **(w)** writable. `clock` = `Clock::get()`. `event_authority` and `program` accounts are implied on every instruction that emits (Anchor `#[event_cpi]`). Role checks compare against `Treasury` fields; "owner or operator" means either key signs.

### 5.1 Owner instructions

#### `create_treasury(owner, operator, recovery_destination, allow_any_destination, allow_create_destination_ata)`
- Accounts: `payer` (s,w), `create_key` (s), `treasury` (w, init), `sol_vault` (w, init as system account with rent floor), `system_program`.
- Checks: `owner != Pubkey::default()`, `operator != Pubkey::default()`.
- Effects: initializes `Treasury` with zero guardians, zero mints, `paused = false`, `timelock_seconds = 0`; funds `sol_vault` to `Rent::minimum_balance(0)`.
- Event: `TreasuryCreated`.

#### `set_roles(new_owner: Option<Pubkey>, new_operator: Option<Pubkey>)`
- Accounts: `owner` (s), `treasury` (w).
- Checks: `owner == treasury.owner`; new values non-default.
- Event: `RolesUpdated`.

#### `add_guardian(guardian)` / `remove_guardian(guardian)`
- Accounts: `owner` (s), `treasury` (w).
- Checks: role; `guardian_count < MAX_GUARDIANS` / guardian present; no duplicates.
- Events: `GuardianAdded` / `GuardianRemoved`.

#### `add_mint(ceiling: MintCeilingInput)`
- Accounts: `owner` (s,w as rent payer), `treasury` (w), `mint`, `vault_ata` (w, init_if_needed via ATA program; omitted for native), `token_program`, `associated_token_program`, `system_program`.
- Checks: role; `mint_count < MAX_MINTS`; not already configured; `mint.owner ∈ {spl_token, spl_token_2022}` or `mint == NATIVE_MINT`; for Token-2022, enumerate extensions and reject `TransferHook`, `ConfidentialTransferMint`, `NonTransferable` (`UnsupportedMintExtension`); set `HasTransferFee` / `HasPermanentDelegate` flags; `min_short_window_seconds ≥ MIN_WINDOW_SECONDS`, `min_short ≤ min_long`.
- Effects: writes `MintConfig` (mint, token program, decimals, flags, ceiling).
- Event: `MintAdded`.

#### `remove_mint()`
- Accounts: `owner` (s), `treasury` (w), `mint`, `vault_ata` (`Option`; required iff the mint is **not** native), `sol_vault` (`Option`; required iff the mint **is** native).
- Checks: role; vault balance is zero (`vault_ata.amount == 0`), or `sol_vault` at floor for native; no open policy references the mint (enforced by requiring `policy_count == 0` **or** by a client-side sweep followed by an on-chain `Policy.mint_limits` check per policy; v1 chooses the strict `policy_count == 0` rule for auditability).
- Effects: clears the `MintConfig` slot (`mint_count -= 1`), leaving it available for a later `add_mint`. The vault ATA is **not** closed: it is empty and rent-exempt, and `add_mint` re-adopts it idempotently.
- Event: `MintRemoved`.

`vault_ata` and `sol_vault` are mutually exclusive optionals because the emptiness check differs by path: a token vault must hold zero, while `sol_vault` must sit exactly at `Rent::minimum_balance(0)` — it can never be closed, only drained to its floor. The strict `policy_count == 0` rule has a useful second-order effect: a *live* policy naming an unconfigured mint is unreachable on-chain, so `execute_payment`'s `MintNotConfigured` check (§5.3 step 7) is pure defense in depth.

#### `enable_native_allowance(amount_cap, expiry_ts)` (ADR-014)
- Accounts: `owner` (s,w as rent payer), `treasury` (w), `mint`, `owner_ata` (w, the owner's own ATA — **not** `vault_ata`), `subscription_authority` (w, native program PDA), `native_delegation` (w, native program PDA), `token_program`, `system_program`, `native_subscriptions_program` (address-pinned to `NATIVE_SUBSCRIPTIONS_PROGRAM = De1egAFMkMWZSN5rYXRj9CAdheBamobVNubTsi9avR44`).
- Checks: role; mint configured and currently `FundingMode::IsolatedVault`; `amount_cap > 0`; `subscription_authority` and `native_delegation` match `native_allowance::find_subscription_authority`/`find_fixed_delegation` derivations, the latter seeded with `delegatee = treasury` — never a session key.
- Effects: CPIs the native program's `initSubscriptionAuthority` (idempotent) then `createFixedDelegation` (`nonce = NATIVE_ALLOWANCE_NONCE = 0`, `delegatee = treasury`), then sets `MintConfig.funding_mode = NativeAllowance` for this mint. One-way in v1: no `disable_native_allowance`; reverting means `remove_mint` + `add_mint`.
- Event: `NativeAllowanceEnabled`.

Funds under `NativeAllowance` never touch `vault_ata` or the program's custody at all — they stay in the owner's own wallet until `execute_payment` pulls them via the native program's `transferFixed`, which requires `delegatee` (the treasury PDA) to sign. An agent's session key can never satisfy that signature, so it cannot call the native program directly and bypass ASH' policy engine — see `native_allowance.rs`'s module doc for the full argument.

#### `set_ceiling(mint, ceiling: MintCeilingInput, allow_any_destination, allow_create_destination_ata)`
- Accounts: `owner` (s), `treasury` (w).
- Checks: role; mint configured; window minimums valid.
- Effects: overwrites the slot's ceiling and the two treasury flags. Existing policies that now exceed the ceiling are **not** mutated; they fail closed at `execute_payment` via the runtime re-check (§5.3 step 9) and must be brought into compliance with `update_policy`.
- Event: `CeilingUpdated`.

#### `withdraw(amount)`
- Accounts: `owner` (s), `treasury`, `mint` (or `NATIVE_MINT` path), `vault_ata` (w) or `sol_vault` (w), `destination` (w; token account for SPL, system account for SOL), `token_program` (SPL path), `system_program`.
- Checks: role only. **Explicitly permitted while `paused`.** Does **not** require the mint to be configured in `Treasury.mints`: vault ATAs survive `remove_mint`, and `sol_vault` accepts permissionless deposits from `create_treasury`, so a configured-slot check would trap funds. For native, `amount ≤ balance - floor`. `amount > 0`.
- Effects: `transfer_checked` or system transfer with PDA signer.
- Event: `Withdrawn`.

#### `close_treasury()`
- Accounts: `owner` (s), `treasury` (w, close → `rent_destination`), `sol_vault` (w), `rent_destination` (w), `system_program`.
- Checks: role; `active_sessions == 0`; `policy_count == 0`; `mint_count == 0` (all vaults removed); `sol_vault` at floor. `rent_destination ≠ sol_vault` (draining a PDA into itself is a no-op, and after close nobody can sign for that address).
- Effects: drains `sol_vault` floor to `rent_destination`; closes `treasury`.
- Event: `TreasuryClosed`.

#### `pause()`
- Accounts: `authority` (s), `treasury` (w).
- Checks: `authority ∈ {owner} ∪ guardians`. The operator is **excluded**: a compromised warm key already has `revoke_session`, and must not be able to freeze the treasury or to undo a guardian's pause. Idempotent success with no event if already paused.
- Effects: `paused = true`, `paused_at`, `paused_by`.
- Event: `TreasuryPaused`.

#### `unpause()`
- Accounts: `owner` (s), `treasury` (w).
- Checks: `owner == treasury.owner`. Guardians cannot unpause; the operator cannot either. Idempotent success with no event if not paused. `paused_at` / `paused_by` are left as the last pauser's record.
- Event: `TreasuryUnpaused`.

### 5.2 Operator instructions

#### `create_policy(name: [u8; 32], args: PolicyInput)`
- Accounts: `operator` (s,w rent payer), `treasury` (w), `policy` (w, init).
- Checks: `operator ∈ {treasury.operator, treasury.owner}`; `name` non-empty UTF-8; `1 ≤ len(mint_limits) ≤ 4`; each `mint` configured in treasury; each limit passes `validate_limit` (windows `≥ MIN`, `short ≤ long`, non-zero maxima); `policy_leq_ceiling(args, treasury)` (§7.2); `approval_threshold`/`cooldown_seconds` written as `0`.
- Effects: `treasury.policy_count += 1`.
- Event: `PolicyCreated`.

#### `update_policy(args: PolicyInput)`
- Accounts: `operator` (s), `treasury`, `policy` (w).
- Checks: role; same validation and ceiling check as create; `policy.treasury == treasury.key()`.
- Effects: overwrites limits/flags, `updated_at = now`. Sessions keep their counters (looked up by mint).
- Event: `PolicyUpdated` (includes old and new limits digest).

#### `close_policy()`
- Accounts: `operator` (s), `treasury` (w), `policy` (w, close → `rent_destination`), `rent_destination` (w).
- Checks: role; `policy.active_sessions == 0`. Allowlist entries must be removed first (client sweep; the program cannot enumerate them; a dangling entry PDA is harmless because its seeds bind it to the closed policy key and it can still be closed by `remove_allowlist_entry` with the policy key as an unchecked account).
- Effects: `treasury.policy_count -= 1`.
- Event: `PolicyClosed`.

#### `add_allowlist_entry(destination_owner, label: [u8; 32], per_tx_max_override)`
- Accounts: `operator` (s,w), `treasury`, `policy`, `entry` (w, init).
- Checks: role; `policy.treasury == treasury`; `destination_owner` is not `treasury`, `sol_vault`, or any vault ATA (self-payment loop); if `per_tx_max_override != 0` then `≤ min(policy.mint_limits[*].per_tx_max)`.
- Event: `AllowlistEntryAdded`.

#### `remove_allowlist_entry()`
- Accounts: `operator` (s), `treasury`, `policy` (unchecked key, may be closed), `entry` (w, close → `rent_destination`), `rent_destination` (w).
- Checks: role against `treasury`; `entry.policy == policy.key()`; if `policy` is live, `policy.treasury == treasury`.
- Event: `AllowlistEntryRemoved`.

#### `create_session(session_key, label: [u8; 32], expires_at, auth_mode)`
- Accounts: `operator` (s,w), `treasury` (w), `policy` (w), `session` (w, init).
- Checks: role; `policy.treasury == treasury`; `now < expires_at ≤ now + MAX_SESSION_TTL_SECONDS`; `auth_mode == 0` (`InvalidAuthMode` otherwise in v1); `session_key ∉ {owner, operator, guardians}` (privilege separation).
- Effects: `seq = 0`; `audit_head = sha256(DOMAIN_AUDIT ‖ session.key())` (genesis); `spend[i].mint = policy.mint_limits[i].mint` for configured slots, counters zero; `treasury.active_sessions += 1`; `policy.active_sessions += 1`.
- Event: `SessionCreated`.

#### `revoke_session()`
- Accounts: `authority` (s), `treasury` (w), `policy` (w), `session` (w).
- Checks: `authority ∈ {operator, owner}`; not already revoked.
- Effects: `revoked = true`, `revoked_at = now`; decrements both `active_sessions` counters.
- Event: `SessionRevoked`.

#### `close_session()`
- Accounts: `operator` (s), `treasury` (w), `policy` (w), `session` (w, close → `rent_destination`), `rent_destination` (w).
- Checks: role; `session.revoked || now ≥ session.expires_at` → `SessionStillActive`. If expired but not revoked, decrements both `active_sessions` counters first; if already revoked it does **not**, because `revoke_session` released them.
- Event: `SessionClosed` (carries final `seq` and `audit_head` so the chain terminus is on record).

`treasury` is writable and `policy` is present because this instruction can decrement `Treasury.active_sessions` *and* `Policy.active_sessions`; an earlier revision of this spec listed a read-only `treasury` with no `policy`, which cannot perform the stated effect. `active_sessions` means "sessions that could still pay", so it must move exactly once per session in each direction: `revoke_session` decrements, and `close_session` decrements only what revocation did not. Undercounting would let `close_policy` run out from under live agents; overcounting would strand the policy permanently.

### 5.3 Agent instructions

Two instructions share one code path in the policy crate; they differ only in the transfer leg.

#### `execute_payment(intent: PaymentIntent)` — SPL Token / Token-2022

Accounts (16 with event CPI, plus 5 more `Option`al accounts when the mint's
`funding_mode == NativeAllowance`; see ADR-014):

| # | Account | Flags | Constraint |
|---|---|---|---|
| 0 | `fee_payer` | s,w | Pays receipt rent (and destination ATA rent if created) |
| 1 | `session_key` | s | `== session.session_key` |
| 2 | `treasury` | | seeds |
| 3 | `policy` | | `key == session.policy` (`has_one` on `session`) |
| 4 | `session` | w | seeds `["session", treasury, session_key]` |
| 5 | `allowlist_entry` | | `Option`; required iff `policy.destination_mode == Allowlist`; seeds `["allow", policy, intent.destination_owner]` |
| 6 | `mint` | | `key == intent.mint`; `mint.owner == mint_config.token_program` |
| 7 | `vault_ata` | w | ATA(`treasury`, `mint`, `token_program`). Unused when `funding_mode == NativeAllowance`, but still required in the account list — its address is still derived and validated, just not debited |
| 8 | `destination_owner` | | `key == intent.destination_owner`; must not be `treasury` or `sol_vault` |
| 9 | `destination_ata` | w | ATA(`destination_owner`, `mint`, `token_program`); `init_if_needed` only if `policy.create_destination_ata`. Doubles as the native program's `receiverAta` in `NativeAllowance` mode |
| 10 | `receipt` | w | init, seeds `["receipt", session, intent.intent_id]`, payer `fee_payer` |
| 11 | `token_program` | | `key == mint_config.token_program` |
| 12 | `associated_token_program` | | |
| 13 | `system_program` | | |
| 14 | `event_authority` | | ASH' own self-CPI event authority (`#[event_cpi]`), unrelated to the native program's |
| 15 | `program` | | ASH itself, for `emit_cpi!` |
| 16 | `owner_source_ata` | w | `Option`; required iff `NativeAllowance`. The **owner's** ATA — never `vault_ata` |
| 17 | `native_delegation` | w | `Option`; required iff `NativeAllowance`. Native `FixedDelegation` PDA |
| 18 | `native_subscription_authority` | | `Option`; required iff `NativeAllowance` |
| 19 | `native_event_authority` | | `Option`; required iff `NativeAllowance`. The *native program's* event authority, distinct from row 14 |
| 20 | `native_subscriptions_program` | | `Option`; required iff `NativeAllowance`; address-pinned to `NATIVE_SUBSCRIPTIONS_PROGRAM` |

Ordered checks and effects:

1. `!treasury.paused` → `Paused`.
2. `session.treasury == treasury`, `session.policy == policy` (account constraints).
3. `session_key.is_signer` (constraint); `session.auth_mode == DirectSigner` → `InvalidAuthMode`.
4. `!session.revoked` → `SessionRevoked`; `now < session.expires_at` → `SessionExpired`.
5. `MIN_INTENT_TTL ≤ intent.expires_at - now ≤ MAX_INTENT_TTL` → `IntentExpired` / `IntentTtlTooLong`.
6. `intent.amount > 0` → `AmountZero`; `len(memo) ≤ MAX_MEMO_LEN` → `MemoTooLong`; `policy.require_memo ⇒ len(memo) > 0` → `MemoRequired`.
7. `mint_config = treasury.mints.find(intent.mint)` → `MintNotConfigured`; `!mint_config.is_native` (native uses `execute_payment_sol`).
8. `limit = policy.mint_limits.find(intent.mint)` → `MintNotInPolicy`.
9. **Runtime ceiling re-check:** `limit ≤ mint_config.ceiling` → `PolicyExceedsCeiling` (protects against `set_ceiling` lowering under a live policy).
10. Destination: if `Allowlist`, `allowlist_entry` present and seeds verified → else `DestinationNotAllowed`; `effective_per_tx = if entry.per_tx_max_override != 0 { min(override, limit.per_tx_max) } else { limit.per_tx_max }`. If `Any`, `treasury.allow_any_destination` must still hold → `PolicyExceedsCeiling`.
11. `destination_ata` existence: if missing and `!policy.create_destination_ata` → `DestinationAtaCreationDisabled`; else create idempotently (rent from `fee_payer`).
12. `receipt` init (Anchor). Duplicate `intent_id` fails here with the system program's "account already in use"; the SDK maps it to `DUPLICATE_INTENT`.
13. Policy crate: `counter = session.spend.find_or_insert(intent.mint)` → `MintNotInSession` if no free slot; `new_counter = policy::evaluate(&limit, &counter, intent.amount, effective_per_tx, now)?` → `ExceedsPerTxMax` / `ExceedsShortWindow` / `ExceedsLongWindow` / `ExceedsLifetime` / `MathOverflow`.
14. Transfer, routed by `mint_config.funding_mode` (ADR-014) — the only step that differs by custody model; steps 1–13 are identical either way:
    - `IsolatedVault`: CPI `transfer_checked(vault_ata → destination_ata, amount, mint_config.decimals)` signed by `treasury` seeds.
    - `NativeAllowance`: re-derive `native_subscription_authority`, `native_delegation`, `native_event_authority` and check them against `native_allowance::find_*`; CPI the native program's `transferFixed(delegation_pda, subscription_authority, owner_source_ata → destination_ata, mint, token_program, delegatee=treasury, event_authority, self_program; amount, delegator=treasury.owner, mint)`, `invoke_signed` with `treasury` seeds. `treasury` is `delegatee`, never `session_key` — an agent holding only the session key cannot produce that signature, so it cannot call the native program directly and skip steps 1–13.
15. Commit: `session.spend[i] = new_counter`; `session.seq += 1`; `session.audit_head = policy::next_audit_head(...)` (§6); write `receipt` fields (`amount = intent.amount`, `seq = session.seq`, `slot`, `timestamp`, `expires_at`, `status = Executed`, `fee_payer`, `memo_hash`).
16. `emit_cpi!(PaymentExecuted { ... })`.

Steps 1–13 perform no external effects; the first side effect is the receipt init in step 12, which is rolled back with the transaction on any later failure. Step 14's `NativeAllowance` branch commits nothing itself either — if the native program's CPI fails (delegation expired, exhausted, or revoked), the whole transaction reverts and step 15 never runs, identically to a failed `transfer_checked`.

#### `execute_payment_sol(intent: PaymentIntent)` — native SOL

Accounts: `fee_payer` (s,w), `session_key` (s), `treasury`, `policy`, `session` (w), `allowlist_entry` (Option), `sol_vault` (w), `destination_owner` (w; must be system-owned, `!= treasury`, `!= sol_vault`), `receipt` (w, init), `system_program`, `event_authority`, `program`. (12 accounts.)

Same checks as above with: step 7 requires `mint_config.is_native` and `intent.mint == NATIVE_MINT`; step 11 skipped; step 14 is `system_program::transfer(sol_vault → destination_owner, amount)` with `invoke_signed`, preceded by `sol_vault.lamports - amount ≥ Rent::minimum_balance(0)` → `InsufficientVaultBalance`.

### 5.4 Permissionless instructions

#### `close_receipt()`
- Accounts: `anyone` (s), `receipt` (w, close → `fee_payer`), `fee_payer` (w; `key == receipt.fee_payer`).
- Checks: `now ≥ receipt.expires_at + RECEIPT_GRACE_SECONDS` → `ReceiptNotExpired`.
- Event: `ReceiptClosed`. `treasury` in the event is `Pubkey::default()`: this instruction is permissionless and must succeed after the session (and even the treasury) has been closed, so neither account is present. Indexers route on `session`.

Deposits have no instruction: transfer tokens to the vault ATA or lamports to `sol_vault`.

---

## 6. Audit hash chain

```
genesis:  audit_head_0 = sha256(DOMAIN_AUDIT ‖ session_pubkey)
step:     audit_head_n = sha256(
              DOMAIN_AUDIT            // 12 bytes
            ‖ audit_head_{n-1}        // 32
            ‖ seq_n (u64 LE)          // 8   (seq after increment, i.e. n)
            ‖ intent_id               // 16
            ‖ mint                    // 32
            ‖ destination_owner       // 32
            ‖ amount (u64 LE)         // 8
            ‖ slot (u64 LE)           // 8
          )
```

Implemented in `ash-policy::next_audit_head` using `solana_program::hash::hashv` on-chain and `sha2` off-chain; both are tested against shared vectors in `crates/ash-policy/tests/vectors.json`. `verifyChain` replays `PaymentExecuted` events ordered by `seq` and compares the final head with `AgentSession.audit_head` (or the `SessionClosed` event's terminal head).

---

## 7. Policy crate API (`ash-policy`)

`#![no_std]`-compatible, `#![forbid(unsafe_code)]`, no Solana dependencies (types mirrored as plain structs with `[u8; 32]` keys).

```rust
pub fn validate_limit(l: &MintLimit) -> Result<(), PolicyError>;
pub fn validate_ceiling(c: &MintCeiling) -> Result<(), PolicyError>;

/// Partial order: every amount ≤ ceiling, every window duration ≥ ceiling minimum.
pub fn limit_leq_ceiling(l: &MintLimit, c: &MintCeiling) -> bool;
pub fn policy_leq_ceiling(p: &PolicyInputView, t: &TreasuryView) -> Result<(), PolicyError>;

/// Advances bucket starts to the current bucket; resets spent on rollover. Pure.
pub fn rollover(counter: &SpendCounter, l: &MintLimit, now: i64) -> SpendCounter;

/// rollover + all limit checks; returns the counter after applying `amount`.
pub fn evaluate(
    l: &MintLimit, counter: &SpendCounter, amount: u64, effective_per_tx: u64, now: i64,
) -> Result<SpendCounter, PolicyError>;

/// Remaining capacity per dimension after rollover; used by check_payment / get_session.
pub fn remaining(l: &MintLimit, counter: &SpendCounter, now: i64) -> Remaining;

pub fn genesis_audit_head(session: &[u8; 32]) -> [u8; 32];
pub fn next_audit_head(prev: &[u8; 32], seq: u64, intent_id: &[u8; 16], mint: &[u8; 32],
                       destination_owner: &[u8; 32], amount: u64, slot: u64) -> [u8; 32];
```

### 7.1 Bucket rollover

```
if now ≥ window_start + window_seconds:
    elapsed_buckets = (now - window_start) / window_seconds     // integer
    window_start   += elapsed_buckets * window_seconds
    spent           = 0
```

Uses `checked_*` throughout; a fresh counter has `window_start = 0`, which rolls to the current bucket on first use. Kani harnesses prove: no overflow for `now ∈ [0, i64::MAX/2]`; `window_start ≤ now < window_start + window_seconds` after rollover; rollover is idempotent within a bucket.

### 7.2 Ceiling comparison

`policy_leq_ceiling` fails with `PolicyExceedsCeiling` if any mint in the policy is not configured in the treasury, any `limit_leq_ceiling` is false, `destination_mode == Any && !allow_any_destination`, or `create_destination_ata && !allow_create_destination_ata`.

---

## 8. Events

Single enum, emitted via `emit_cpi!`. Every variant carries `treasury: Pubkey` and `schema_version: u8 (= 1)`.

| Variant | Additional fields |
|---|---|
| `TreasuryCreated` | `owner, operator, recovery_destination` |
| `RolesUpdated` | `owner, operator` |
| `GuardianAdded` / `GuardianRemoved` | `guardian` |
| `MintAdded` / `MintRemoved` | `mint, token_program, flags` (+ `ceiling` on add) |
| `CeilingUpdated` | `mint, ceiling, allow_any_destination, allow_create_destination_ata` |
| `TreasuryPaused` / `TreasuryUnpaused` | `by, at` |
| `Withdrawn` | `mint, amount, destination, by` |
| `TreasuryClosed` | — |
| `PolicyCreated` / `PolicyUpdated` / `PolicyClosed` | `policy, name`. `PolicyCreated` adds `limits_hash: [u8;32]` = sha256 of the serialized `PolicyInput`; `PolicyUpdated` adds `previous_limits_hash` and `limits_hash`, so revisions chain the way payments do; `PolicyClosed` adds neither, having no args to commit to |
| `AllowlistEntryAdded` / `AllowlistEntryRemoved` | `policy, destination_owner, label, per_tx_max_override` |
| `SessionCreated` | `session, policy, session_key, label, expires_at, auth_mode` |
| `SessionRevoked` | `session, by, seq, audit_head` |
| `SessionClosed` | `session, seq, audit_head` |
| `PaymentExecuted` | `session, seq, audit_head, intent_id, mint, destination_owner, amount, slot, memo_hash, receipt` |
| `ReceiptClosed` | `session, intent_id, receipt` |

Off-chain only (same schema in `@ash/contract`): `PaymentDenied { session, intent, reason_code, source: "hook" | "simulation" }`.

---

## 9. Error codes

Anchor custom errors start at 6000. `reason_code` strings are what the SDK, MCP tools, and adapters surface.

| Code | Name | `reason_code` | Raised by |
|---|---|---|---|
| 6000 | `Paused` | `TREASURY_PAUSED` | execute_* |
| 6001 | `Unauthorized` | `UNAUTHORIZED` | all role-gated ixs |
| 6002 | `SessionRevoked` | `SESSION_REVOKED` | execute_* |
| 6003 | `SessionExpired` | `SESSION_EXPIRED` | execute_* |
| 6004 | `InvalidAuthMode` | `INVALID_AUTH_MODE` | create_session, execute_* |
| 6005 | `IntentExpired` | `INTENT_EXPIRED` | execute_* |
| 6006 | `IntentTtlTooLong` | `INTENT_TTL_TOO_LONG` | execute_* |
| 6007 | `AmountZero` | `AMOUNT_ZERO` | execute_* |
| 6008 | `MemoTooLong` | `MEMO_TOO_LONG` | execute_* |
| 6009 | `MemoRequired` | `MEMO_REQUIRED` | execute_* |
| 6010 | `MintNotConfigured` | `MINT_NOT_CONFIGURED` | execute_*, create/update_policy |
| 6011 | `MintNotInPolicy` | `MINT_NOT_IN_POLICY` | execute_* |
| 6012 | `MintNotInSession` | `MINT_NOT_IN_SESSION` | execute_* |
| 6013 | `TokenProgramMismatch` | `TOKEN_PROGRAM_MISMATCH` | execute_payment, add_mint |
| 6014 | `WrongPaymentPath` | `WRONG_PAYMENT_PATH` | native mint via token ix or vice versa |
| 6015 | `DestinationNotAllowed` | `DESTINATION_NOT_ALLOWED` | execute_* |
| 6016 | `DestinationAtaCreationDisabled` | `DESTINATION_ATA_MISSING` | execute_payment |
| 6017 | `SelfPaymentForbidden` | `SELF_PAYMENT_FORBIDDEN` | execute_*, add_allowlist_entry |
| 6018 | `ExceedsPerTxMax` | `EXCEEDS_PER_TX_MAX` | execute_* |
| 6019 | `ExceedsShortWindow` | `EXCEEDS_SHORT_WINDOW` | execute_* |
| 6020 | `ExceedsLongWindow` | `EXCEEDS_LONG_WINDOW` | execute_* |
| 6021 | `ExceedsLifetime` | `EXCEEDS_LIFETIME` | execute_* |
| 6022 | `InsufficientVaultBalance` | `INSUFFICIENT_VAULT_BALANCE` | execute_payment_sol, withdraw (SOL) |
| 6023 | `PolicyExceedsCeiling` | `POLICY_EXCEEDS_CEILING` | create/update_policy, execute_* |
| 6024 | `InvalidWindow` | `INVALID_WINDOW` | policy/ceiling validation |
| 6025 | `InvalidLimit` | `INVALID_LIMIT` | zero maxima, override > per_tx |
| 6026 | `InvalidName` | `INVALID_NAME` | create_policy, labels |
| 6027 | `MintSlotsFull` | `MINT_SLOTS_FULL` | add_mint, create/update_policy |
| 6028 | `DuplicateMint` | `DUPLICATE_MINT` | add_mint, policy args |
| 6029 | `UnsupportedMintExtension` | `UNSUPPORTED_MINT_EXTENSION` | add_mint |
| 6030 | `GuardiansFull` | `GUARDIANS_FULL` | add_guardian |
| 6031 | `GuardianNotFound` | `GUARDIAN_NOT_FOUND` | remove_guardian |
| 6032 | `DuplicateGuardian` | `DUPLICATE_GUARDIAN` | add_guardian |
| 6033 | `PrivilegedKeyAsSession` | `PRIVILEGED_KEY_AS_SESSION` | create_session |
| 6034 | `InvalidExpiry` | `INVALID_EXPIRY` | create_session |
| 6035 | `PolicyInUse` | `POLICY_IN_USE` | close_policy |
| 6036 | `SessionStillActive` | `SESSION_STILL_ACTIVE` | close_session |
| 6037 | `TreasuryNotEmpty` | `TREASURY_NOT_EMPTY` | close_treasury, remove_mint |
| 6038 | `ReceiptNotExpired` | `RECEIPT_NOT_EXPIRED` | close_receipt |
| 6039 | `AlreadyRevoked` | `ALREADY_REVOKED` | revoke_session |
| 6040 | `MathOverflow` | `MATH_OVERFLOW` | policy crate |
| 6041 | `ReservedFieldNonZero` | `RESERVED_FIELD_NON_ZERO` | any ix receiving v1.1 fields ≠ 0 |
| — | (system: account already in use) | `DUPLICATE_INTENT` | receipt init; mapped by SDK |
| — | (Anchor: ConstraintSeeds / AccountNotInitialized on `allowlist_entry`) | `DESTINATION_NOT_ALLOWED` | mapped by SDK |

---

## 10. Budgets (enforced by CI regression tests)

| Metric | `execute_payment` (token, allowlist, no ATA creation) | `execute_payment_sol` |
|---|---|---|
| Accounts | 16 | 12 |
| Legacy tx size (2 signers, 64-byte memo) | ≈ 875 bytes | ≈ 745 bytes |
| Legacy tx size gate | ≤ 1,000 bytes | ≤ 900 bytes |
| With ALT (v0 tx) | ≈ 400 bytes | ≈ 350 bytes |
| Compute units (SPL Token) | gate ≤ 45k | gate ≤ 35k |
| Compute units (Token-2022 w/ TransferFee) | target ≤ 50k, gate ≤ 55k | — |
| + destination ATA creation | +≈ 20k CU, +≈ 0.002 SOL rent | — |

The gates above are design ceilings. The **measured** figures are deliberately not restated here: they live in `programs/ash/tests/cu-baselines.txt`, which `budget.rs` reads and the CI regression gate enforces. Two thresholds apply per §11 — the gate above, and the committed baseline at +10%. This document carried its own copy of the measured numbers until both it and the test fell ~820 CU behind the build without a failure; one file now holds them, and `scripts/cu-baseline.sh` refreshes it.

### 10.1 Why the native SOL gate is 35k, not 30k

The original design target was ≤ 25k with a 30k gate. The first LiteSVM run measured **32,002 CU**, and the gate is raised to 35k rather than the instruction being optimised, because the overage is structural rather than incidental. `execute_payment_sol` must:

- deserialize **2,078 bytes** of Borsh account data — `Treasury` (944) + `Policy` (546) + `AgentSession` (588). Borsh has no partial decode: reading `Treasury.paused` costs a full walk of `[Pubkey; 5]` and `[MintConfig; 4]`.
- `init` a 243-byte `IntentReceipt`, which is one `find_program_address` plus a System `create_account` CPI, and is the idempotency mechanism itself (ADR-004).
- self-CPI the `PaymentExecuted` event, because §8 mandates `emit_cpi!` over `emit!` so the record survives log truncation.

None of these is discretionary: §3 freezes the layouts, §8 mandates the event mechanism, and §7 idempotency requires the receipt. Getting under 30k would take zero-copy accounts, which need `repr(C)` and contradict this document's Borsh contract. The one optimisation actually available — dropping the redundant `seeds` re-derivation on `policy`, already applied and worth 1,584 CU on every payment — is included in the measured figure.

The SPL path is unaffected and remains inside its original 45k gate.

### 10.2 Measurement determinism

CU counts are only meaningful if they are reproducible. `find_program_address` searches downward from bump 255 and stops at the first off-curve address, so the number of `create_program_address` syscalls — ~1,500 CU each — depends on the *addresses involved*. Three derivations on the payment path are affected: the `IntentReceipt` PDA, the vault ATA, and the destination ATA.

With randomly generated fixtures the measurements swung by ±6,000 CU between runs, every difference a multiple of ~1,500. The test harness therefore derives every key, address, and `intent_id` from a per-test deterministic sequence, and `budget.rs` asserts reproducibility directly. A CU gate built on random fixtures measures noise, not the program.

A second, smaller source of drift is the length of Anchor's `#[program]` dispatch chain: each added instruction costs a few CU on every path, handler unchanged. The eight lifecycle instructions moved every payment by exactly +24 CU. The +10% regression band absorbs this, which is precisely why the baseline must still be re-measured when it lands — absorbed drift is invisible drift, and it spends the band that is there to catch a real regression. `scripts/cu-baseline.sh` is the re-measurement.

---

## 11. Invariants (Trident / property tests)

For every reachable state and every instruction sequence:

1. `Σ vault debits (token + SOL) == Σ IntentReceipt.amount over executed payments + Σ Withdrawn.amount`.
2. For each session and mint slot after any ix: `short_spent ≤ short_window_max`, `long_spent ≤ long_window_max`, `lifetime_spent ≤ lifetime_max`.
3. For each live policy and configured mint: `limit_leq_ceiling` holds after every owner/operator ix, **or** the next `execute_*` for that mint fails with `PolicyExceedsCeiling`.
4. `treasury.paused ⇒` no `PaymentExecuted` in the same slot range.
5. `session.revoked || now ≥ session.expires_at ⇒` no `PaymentExecuted` for that session.
6. `session.seq` increases by exactly 1 per `PaymentExecuted`; `audit_head` equals the replayed chain.
7. No two `IntentReceipt` accounts share `(session, intent_id)`; a duplicate `execute_*` leaves all balances and counters unchanged.
8. No signer outside `{owner, operator, guardians}` mutates `Treasury`, `Policy`, `AllowlistEntry`, or `AgentSession` (except program-internal counter updates in `execute_*` signed by a valid `session_key`).
9. Guardians never cause `paused` to transition `true → false`.
10. `sol_vault.lamports ≥ Rent::minimum_balance(0)` at all times.
11. `treasury.active_sessions == |{sessions: !revoked ∧ !closed}|` and `policy.active_sessions` likewise.
12. Every `reserved` byte and every v1.1 field is zero.
