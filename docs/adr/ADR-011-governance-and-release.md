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

## Implementation status (2026-09-25)

The decision above is unchanged. This section records which of its seven points now have a
mechanism, because until a release has actually run, a governance ADR is a promise.

**Shipped:**

- **Changesets** (point 5): `.changeset/`, independent semver, `@agent-rails/dashboard` and
  `@agent-rails/e2e` ignored — one is an application, the other a test suite. Five packages
  carry `0.1.0`, `publishConfig.access: public`, Apache-2.0 and a `repository.directory`.
- **Release workflow** (`.github/workflows/release.yml`): runs the TypeScript gate under
  `VERIFY_STRICT=1`, then opens and maintains the version pull request. **Publishing is
  inert**: the step is generated only when `NPM_TOKEN` exists, and it does not. This is the
  deliberate order — exercise the machinery on every merge, publish later. A package version
  cannot be unpublished, and the trust phase is not yet worth one.
- **Verifiable program hash** (ADR-015's deferred row): `scripts/program-hash.sh`, one
  script used by both the developer and `.github/workflows/release-tag.yml`, so a local
  check and a release cannot disagree about what is being hashed. A tag attaches the `.so`,
  its digest, and a `build-info.json` naming the Agave, Anchor and Rust versions the digest
  depends on.
- **Devnet smoke on tags** (ADR-015's other deferred row): `scripts/devnet-smoke.sh`, run by
  the tag workflow against the funded CI key. SOL and SPL, on a real cluster.
- **Trust phases in the README**, as a table with the current row in bold, next to the
  commands that check it.

**Not shipped, and why:**

- **The hash is toolchain-pinned, not container-hermetic.** `solana-verify build` compiles
  inside an image published per Agave release, which removes the host from the equation;
  this tree is Anchor 1.1.2 on Agave 3.x, which those images do not cover. Until they do,
  the digest reproduces for anyone with the pinned toolchain and the same `Cargo.lock`, and
  the README says exactly that rather than the word "reproducible" unqualified.
- **The program id is a developer key, not the `rail…` vanity key held by custodians.**
  Point 1 is a mainnet commitment; devnet runs on the key that deployed it, and the README's
  first phase row says so in the terms a user cares about.
- Points 3, 6 and 7 — audit, `CODEOWNERS`/`GOVERNANCE.md`, incident runbook — are untouched.

**Smoke scope.** The SPL leg pays with a mock 6-decimal mint created by
`agent-rails init --mock-mint`, not with Circle's devnet USDC. Nobody but Circle can mint the
latter and its faucet is not scriptable, so a USDC leg would be a smoke that depends on a
web form. The mint is USDC-shaped, and `packages/contract/src/mints.ts` carries the real
devnet and mainnet addresses for the path that names them.
