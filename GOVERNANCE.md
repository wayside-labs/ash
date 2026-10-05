# Governance

How ASH is maintained, released, and upgraded. Normative decisions live in **`docs/adr/`** (immutable once accepted). This file describes process; ADRs describe decisions.

---

## 1. Roles

| Role | Responsibility |
|---|---|
| **Maintainers** | Merge policy, cut releases, hold or custody upgrade authority per trust phase, respond to security reports |
| **Contributors** | Propose changes via pull request; DCO sign-off (Apache-2.0, ADR-011) |
| **Users** | Verify on-chain trust state (`ash doctor`, program hash); choose trust phase before depositing |

There is no on-chain DAO for this repository (ADR-011 option D rejected).

---

## 2. Architecture decisions (ADRs)

1. Check `docs/adr/README.md` before revisiting a settled design question.  
2. New significant decisions: add `docs/adr/ADR-NNN-short-title.md` with Context, Options, Decision, Consequences.  
3. Do not rewrite accepted ADRs; supersede with a later ADR.  
4. Byte-level contract changes require `docs/spec/accounts-and-instructions.md`, IDL regen (`pnpm idl:build`, `pnpm codegen`), and `tests/layout.rs` updates when layouts move.

---

## 3. Code review and ownership

`CODEOWNERS` requires maintainer review for:

- `programs/ash/` — custody and account constraints  
- `crates/ash-policy/` — limit arithmetic and audit hash  
- `idl/` and `docs/spec/` — client and indexer compatibility  

**ADR-011 target:** two approving reviews for program and policy changes. Enable via GitHub branch protection on `main` (required reviewers + `CODEOWNERS`). Procedure: `docs/runbooks/github-branch-protection.md`. Snapshot: `audits/internal/branch-protection-2026-09-29.md`.

Agent-assisted contributions: see `CONTRIBUTING.md` no-go zones. High-risk paths (`send-payment.ts`, `vault-transfer`, generated client) need human review even when an agent authored the diff.

---

## 4. Release and versioning

| Artifact | Versioning |
|---|---|
| On-chain program | `PROGRAM_VERSION` / account `version` field; one program id per major line (ADR-011) |
| TypeScript packages | Independent semver via Changesets; `@ash/contract` is the compatibility anchor |
| Dashboard | Versioned in repo; excluded from npm publish (`changeset` ignore) |

**Release workflow:** `.github/workflows/release.yml` runs the TypeScript gate; npm publish waits on trust phase and `NPM_TOKEN` (see ADR-011 implementation notes).

**Tagged releases:** `.github/workflows/release-tag.yml` attaches SBF artifact, SHA-256, toolchain metadata, and runs `devnet-smoke.sh`.

---

## 5. Trust phases and upgrade authority

Public table: `README.md` § Trust phases.

| Phase | Upgrade authority | User expectation |
|---|---|---|
| 0.x | Maintainer offline key | Unaudited; devnet only |
| 1.0.0-beta | Squads 3-of-5, ≥1 external security signer, time lock, ≥72 h notice | Small TVL; upgrades visible before execution |
| 1.0.0 | Renounced (`None`) | Immutable program; migration only via new id |

Operational runbook: `docs/runbooks/upgrade-authority.md` (ADR-020: authority never in CI secrets).

### Emergency upgrade notice

For **1.0.0-beta** only: shortening the public notice below 72 hours requires **all five** multisig signers and a published incident summary (ADR-011 point 7). Rationale and timeline go in a GitHub discussion or security advisory.

---

## 6. Incident response (summary)

1. **Contain:** owner or guardian `pause` affected treasuries; owner `withdraw` if needed. Pause does not cascade to child treasuries — pause each treasury that must stop (see `THREAT_MODEL.md`).  
2. **Assess:** classify impact (funds at risk, audit break, privilege escalation).  
3. **Communicate:** security advisory channel per `SECURITY.md`; devnet operators via README and release notes.  
4. **Remediate:** patch, tag, `program-hash.sh compare`, smoke tests; for mainnet-beta+, follow multisig and notice policy.  
5. **Post-incident:** update `THREAT_MODEL.md` or add ADR if the model changed.

Guardian automation: `docs/runbooks/guardian-watch.md`.

---

## 7. Audits

Reports and internal findings: `audits/README.md`. No professional third-party audit is claimed until a report is published there.

Pre-audit gate: `THREAT_MODEL.md` §5 checklist.

---

## 8. Strategy and product docs

Business-facing Portuguese material is indexed in `docs/strategy/README.md`. It does not override ADRs or this file.

---

## 9. Changing this document

Process tweaks that do not change a settled ADR decision may be edited here with a normal PR. Changes that contradict an ADR require a new ADR first.
