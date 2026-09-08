# ADR-011: Staged trust: multisig upgrades → frozen program; Apache-2.0; independent versioning

**Status:** Accepted

## Context

The program upgrade authority is a super-owner over every treasury. Users will verify it on-chain. The README must be able to describe the trust model honestly at every phase.

## Options considered

- A. Maintainer-held upgrade key, MIT, audit later.
- **B. Staged trust: multisig with public notice → frozen v1 after audit → new versions on new program ids.**
- C. Immutable from first mainnet deploy (pre-audit bugs become permanent).
- D. On-chain DAO governance of upgrades (governance theater at this scale).

## Decision

Option B.

1. **Program id**: one keypair for devnet and mainnet, `rail…` vanity prefix, generated offline, held by the multisig custodians; only the pubkey in the repo. Devnet is the canary (≥1 week soak per release).
2. **Phases**: `0.x` devnet-only ("unaudited"); `1.0.0-beta` mainnet with a Squads 3-of-5 (≥1 external security signer), Squads time lock, ≥72 h public notice, TVL guidance; `1.0.0` post-audit with upgrade authority set to `None`; `2.x` on a new program id with `migrate_treasury` tooling. `agent-rails doctor` reports the on-chain authority state.
3. **Audit**: internal pre-audit (`THREAT_MODEL.md`, Sealevel-attacks checklist, static analysis, fuzz/Kani suite, surface freeze); one professional audit (budget roughly $30–80k; pursue Solana Foundation / Superteam grants); optional competitive review; reports under `audits/`; bug bounty in `SECURITY.md`, scaled to TVL.
4. **License**: Apache-2.0 for all code; DCO sign-off, no CLA.
5. **Versioning**: `PROGRAM_VERSION: u8`; `version: u8` in every account; IDL on-chain via Program Metadata and as a release asset; independent semver per package via Changesets; `@agent-rails/contract` as compatibility anchor; compatibility matrix in docs.
6. **Repo governance**: `CODEOWNERS` with two reviews for `programs/` and `crates/agent-rails-policy/`; signed commits; branch protection with ADR-008 gates; `GOVERNANCE.md`; ADRs in `docs/adr/`.
7. **Incident response**: runbook covering guardian pause, disclosure timeline, and an emergency notice-shortening rule requiring all five signers.

## Consequences

- Trust claims are checkable on-chain at every phase.
- Post-freeze bugs are fixed only by migration to a new program id; v1 tooling is maintained long-term.
- Operating a multisig and a notice policy is ongoing discipline for maintainers.
