# ADR-014: Hybrid `FundingMode` — isolated vault or native Solana allowance

## Context

Every payment in v1 settles from a program-owned vault (ADR-001): the owner deposits into
a Treasury-PDA-controlled ATA (or `sol_vault` for SOL), and `execute_payment` moves funds
out of it once every policy check passes. That model requires the owner to pre-fund the
vault before any agent can spend — capital sits escrowed and idle until spent.

The Solana Foundation shipped a native, audited, open-source program —
**Subscriptions & Allowances** (`De1egAFMkMWZSN5rYXRj9CAdheBamobVNubTsi9avR44`,
`github.com/solana-foundation/subscriptions`) — that lets a wallet delegate a capped,
optionally time-boxed spending authority over its own ATA to a third party, without
moving funds anywhere. This is a second, credible custody model for the same problem
Agent Rails already solves at the policy layer: bounding what an agent can spend.

The two models are not competing designs. `IsolatedVault` suits an owner who wants funds
fully segregated and is comfortable pre-funding. `NativeAllowance` suits an owner who
wants zero idle escrow and is comfortable keeping funds in their own wallet under a
program-enforced cap. Agent Rails' policy engine — limits, windows, allowlists,
idempotency, audit chain — has no dependency on either; it decides *whether* a payment is
allowed, not *where the money currently sits*.

## Options considered

1. **Vault-only (status quo).** Simplest, but forces every owner to escrow capital
   up front and forfeits the capital-efficiency story the native program now enables.
2. **Replace the vault with the native allowance entirely.** Loses the fully-segregated
   custody option some owners will specifically want (e.g. institutional treasuries that
   will not delegate authority over their own operating wallet under any circumstances),
   and would be a breaking change to every account already using `IsolatedVault`.
3. **Hybrid, selected per mint via a `FundingMode` enum on `MintConfig`, owner-only.**
   Both models available side by side; an owner picks per mint at `add_mint`/
   `enable_native_allowance` time. Chosen.
4. **Let the agent or operator choose `FundingMode` per payment.** Rejected outright:
   custody model is a strictly stronger decision than spending policy — an operator who
   could route a payment through a *different* custody model than the owner intended
   would be a privilege escalation, violating the "loosening flows downhill only"
   invariant that governs every other role boundary in this program.

## Decision

Add `FundingMode` (`IsolatedVault | NativeAllowance`) to `MintConfig`, encoded in one byte
reclaimed from its existing `_pad[6]` block — `MintConfig` stays 112 bytes, no account
migration. Default is `IsolatedVault`; an owner opts a configured mint into
`NativeAllowance` via the new owner-only `enable_native_allowance` instruction, which:

1. CPIs the native program's `initSubscriptionAuthority` for `(owner, mint)` (idempotent).
2. CPIs `createFixedDelegation` with **`delegatee` set to the Treasury PDA** — never the
   agent's session key.

`execute_payment`'s check sequence (policy, limits, allowlist, idempotency, audit chain)
runs completely unchanged for both modes; only the final transfer step branches on
`mint_config.funding_mode`, reusing the same `intent.amount` the policy engine already
approved. For `NativeAllowance`, that step CPIs the native program's `transferFixed`,
`invoke_signed` with the Treasury PDA's own seeds.

**The `delegatee = Treasury PDA` choice is the load-bearing security property of this
design.** The native program's `transferFixed` requires `delegatee` to sign. If the
delegatee were the agent's session key instead, the agent could call the native program's
`transferFixed` directly — a public instruction on a separate program — and skip every
check `execute_payment` performs entirely. Making the Treasury PDA the delegatee means
only Agent Rails' own program can produce that signature, and it only does so after
`payment::prepare` has already evaluated the payment against the full policy.

Nonce for the native `FixedDelegation` PDA is fixed at `0`: Agent Rails only ever
maintains one active native allowance per `(treasury, mint)`, so there is nothing to
disambiguate concurrently and no need to grow `MintConfig` to store one.

## Consequences

- `MintConfig` byte layout changes (offset 66 onward); `docs/spec/accounts-and-instructions.md`
  and `tests/layout.rs` are updated in the same change so the spec, the program, and the
  Borsh round-trip test cannot drift.
- `execute_payment` gains five `Option`al accounts, populated only when
  `funding_mode == NativeAllowance`, to avoid taxing the CU/tx-size budget of the (default,
  and likely still more common) `IsolatedVault` path.
- No `disable_native_allowance` in v1: reverting a mint to `IsolatedVault` means
  `remove_mint` + `add_mint`. A dedicated revert instruction is deferred until there is a
  concrete need to preserve a mint's policy/session history across the switch.
- New external dependency surface: correctness of the `NativeAllowance` path now also
  depends on the native program's own limits and failure modes (delegation exhaustion,
  expiry, revocation) — which `execute_payment` does not query in advance, only discovers
  via a failed CPI. This is acceptable because the whole transaction reverts on that
  failure, the same as any other failed transfer; it is not a policy-engine gap, only a
  UX one (Agent Rails cannot pre-empt the failure with a specific reason code without an
  extra read of the native program's own accounts, deferred to a follow-up).
- Owner = a Squads or Realms PDA (already supported, ADR-002) as `delegator` on
  `enable_native_allowance` is expected to work — a Squads transaction can sign
  `createFixedDelegation` like any other owner action — but is called out as unverified
  by this ADR and should be confirmed against a LiteSVM test before it is advertised as
  supported.
- The `NativeAllowance` path derives three native-program PDAs with `find_program_address`
  rather than caller-supplied bumps, unlike every PDA this program owns itself. Measured
  cost: **66,987 CU** (`execute_payment_native_allowance_cu_cost_is_reported_and_sane`,
  `tests/budget.rs`) vs. **40,753 CU** for the equivalent `IsolatedVault` payment — about
  64% more, still far under both Solana's per-instruction default and the 1.4M CU/tx
  ceiling, but no committed baseline/spec-gate exists for this path yet. Caching bumps
  (mirroring how `execute_payment` already handles `sol_vault`) would close most of the
  gap if it ever needs one.

## Verification status (post-merge)

`tests/native_allowance.rs` CPIs into the **actual deployed native program**
(`programs/agent_rails/tests/fixtures/subscriptions_devnet.so`, dumped live from devnet —
see the file's header comment for the redump command), not a rebuild-from-source stub or a
mock. This closes the byte-packing risk called out in the original CPI design write-up:
the instruction bytes `native_allowance.rs` builds are exercised against the real binary on
every `cargo test`, not just checked against the published IDL.

Confirmed empirically, against that real binary:
- `enable_native_allowance` creates a working `FixedDelegation` and `SubscriptionAuthority`,
  and is owner-only (`enable_native_allowance_is_owner_only`).
- `execute_payment` in `NativeAllowance` mode moves funds from the owner's wallet, not the
  vault, with receipt/audit-chain bookkeeping identical to the vault path
  (`execute_payment_pulls_from_the_owners_wallet_and_leaves_the_vault_untouched`).
- A transfer above the native delegation's own cap fails
  (`a_payment_above_the_native_delegation_cap_is_rejected_by_the_native_program`).
- **The core security property holds against the real program, not just our own code**:
  `session_key_cannot_pull_via_the_native_program_directly` builds the exact `transferFixed`
  instruction bytes with the session key forged into the `delegatee` slot, submits it
  directly to the native program (never touching `agent_rails::execute_payment`), and the
  real binary rejects it. This was the single largest unverified risk in the original
  design and is now closed.

Still open: the "true" live devnet dry-run — an actual signed transaction submitted over
RPC — which the LiteSVM-against-the-real-binary tests substantially de-risk but do not
fully replace (LiteSVM's SVM implementation could in principle still diverge from a live
cluster's).

**Squads/Realms-as-owner: verified, with a scope caveat.** `tests/pda_owner.rs` proves the
mechanism, not Squads' or Realms' actual business logic. A ~60-line, test-only program
(`programs/test_pda_relay`, never deployed anywhere but LiteSVM) does nothing but
`invoke_signed` on behalf of its own PDA — exactly what a Squads vault-execute or a Realms
governance-execute instruction does when signing on a multisig's/DAO's behalf — and forward
an arbitrary inner instruction unmodified. Through that relay, a program-derived `owner`
(no keypair, ever) successfully:
- calls `add_mint` (owner-gated, unrelated to `NativeAllowance` — proves the pattern holds
  for the *general* owner-gated surface, not just this feature)
- calls `enable_native_allowance` and gets a real `FixedDelegation` created against the
  real native program
- then participates in a normal operator-signed policy/session and a real
  `NativeAllowance` payment, exercising no owner/PDA-specific code path at all once setup
  is done

What this does *not* verify: Squads' or Realms' own multisig/proposal/voting correctness,
their specific vault-PDA seed scheme, or any interaction between their program and Agent
Rails beyond "a program can sign on a PDA's behalf via CPI." Those would require deploying
the real Squads V4 or Realms program and are a reasonable follow-up before advertising
either as supported, but are lower priority than they might appear: the mechanism this ADR
actually depends on — Anchor's `Signer<'info>` and `has_one = owner` accepting a
CPI-forwarded PDA signature — is now confirmed, not assumed.
