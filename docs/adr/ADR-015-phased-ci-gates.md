# ADR-015: Phased CI gates, with the deferred half of ADR-008 named rather than implied

**Status:** Accepted

## Context

ADR-008 specified the test pyramid and the gates that enforce it. Its per-PR list is:
fmt, clippy `-D warnings`, cargo-deny, cargo-audit, verifiable build hash, CU regression
(>10% fails), account layout snapshot, IDL diff comment, a short Trident run with a
committed corpus, tsc, Biome, vitest, coverage thresholds (policy crate ≥95%, SDK core
≥85%), CodeQL, semgrep, SHA-pinned Actions with minimal permissions. Nightly: long Trident,
Kani, Surfpool E2E, `cargo-mutants`.

For most of the project's life that list described nothing. There was no CI at all — no
`.github/` directory — and the cost was not hypothetical: a client test asserting 22
instruction discriminators sat red on `main` across two merges after ADR-014 added the
23rd, and 144 TypeScript type errors accumulated behind a `tsc` that no script ever ran.
Among them was a missing import that crashed the MCP server on startup for any
`AGENT_RAILS_SECURITY` value other than the default, making two of ADR-013's three
postures unreachable in the shipped build.

CI now exists and enforces most of that list. The remainder needs new tooling, new
baselines, or a GitHub plan this repository does not have. The hazard is leaving ADR-008
as the only record: a reader takes it for the current state, sees "coverage ≥95%" and
"Trident on every PR", and concludes the arithmetic is covered in ways it is not. An
aspirational gate that reads as an active one is worse than an absent gate, because it is
trusted.

ADRs are immutable, so ADR-008 cannot be annotated. This ADR records the split.

## Options considered

- A. Implement the full ADR-008 list before merging any CI. Correct in the end state, and it
  keeps the repository with zero gates for however long Trident harnesses, a CU baseline and
  coverage calibration take — while the failures above keep landing.
- B. Ship what runs today and leave ADR-008 as the description of CI. Fastest, and it leaves
  the document that a reviewer or auditor reads overstating what is enforced.
- C. Ship what runs today, and turn on the remaining gates immediately with thresholds loose
  enough to pass. Every gate present, none of them meaningful, and a team trained to read
  green as noise.
- **D. Ship what runs today, and name the deferred gates here with the reason each is
  deferred and what would land it.**

## Decision

Option D.

### Enforced today

`.github/workflows/ci.yml`, on every push to `main` and every pull request:

| Gate | Where |
|---|---|
| fmt, clippy `-D warnings`, `cargo test --workspace` | `scripts/verify.sh rust` |
| account layout snapshot | `programs/agent_rails/tests/layout.rs`, inside that run |
| `overflow-checks = true` still set | `scripts/verify.sh rust` |
| Biome, tsc, vitest, `pnpm audit` | `scripts/verify.sh ts` |
| generated client matches the committed IDL | `pnpm codegen:check`, same script |
| cargo-deny — advisories, licenses, bans, sources | `supply-chain` job |
| secret scanning over history | `secrets` job (gitleaks CLI) |
| SAST | `sast` job (semgrep `p/typescript`, `p/rust`) |
| SHA-pinned Actions, `permissions: contents: read` | throughout |

`.github/workflows/idl.yml`, path-filtered to the program and its dependencies: rebuilds
the IDL from the program and fails if the committed one differs. ADR-008 asked for an "IDL
diff comment"; a failing gate was chosen over a comment, because a comment is advisory.

Two gates are enforced that ADR-008 did not list — `pnpm audit` and the `overflow-checks`
assertion — because the invariants they protect had no mechanism otherwise.

### Deferred, with the reason

| Gate | Why not yet | What lands it |
|---|---|---|
| **Trident stateful fuzzing** | No harness and no corpus exist. Writing them is a project, not a CI step. | A harness under `programs/agent_rails/`, a committed corpus, then a short run per PR and a long one nightly. |
| **Kani bounded model checking** | Same: no proofs written. ADR-008 already scoped it as nightly and non-blocking. | Proofs for no-overflow, monotone rollover, the `≤` partial order, and hash injectivity in `seq`. |
| **Coverage thresholds (policy ≥95%, SDK ≥85%)** | No coverage tooling is configured on either side, so the numbers are unknown. Turning on a threshold before measuring picks it arbitrarily. | `cargo-llvm-cov` and vitest v8 coverage, measured first, then gated at the ADR-008 numbers. |
| **CU regression >10%** | `tests/budget.rs` measures cost but no baseline is committed, so there is nothing to regress against. | A committed budget file and a comparison step. Until then a moving number in `budget.rs` is something a human reads. |
| **`cargo-mutants`** | Nightly in ADR-008; needs a runtime budget decided against metered minutes. | A nightly workflow once the suite above is in place. |
| **Verifiable build hash** | Belongs with the release process (ADR-011), which has not run yet. | A release workflow producing and publishing the hash. |
| **Surfpool E2E, devnet smoke** | Nightly and release-tag scoped in ADR-008; needs a funded devnet keypair held as a secret. | A nightly workflow plus the secret. |

### Two gates that will not be implemented as written

- **CodeQL.** It requires GitHub Advanced Security, which is not available on a private
  repository under this account. semgrep covers SAST in its place. If this repository
  becomes public, CodeQL becomes free and should be added — it analyses TypeScript more
  deeply than the semgrep rule sets in use.
- **cargo-audit.** It queries the same RustSec database cargo-deny already reads under
  `[advisories]`. Running both reports each advisory twice, which trains readers to skim
  both. The gate is kept; the second tool is not.

### Scoping that differs from ADR-008

`deny.toml` sets `unmaintained = "workspace"` rather than flagging the whole tree. Five
transitive Solana dependencies are unmaintained (`ansi_term`, `bincode`, `derivative`,
`libsecp256k1`, `paste`) and nothing in this repository can act on them. Vulnerabilities
still deny everywhere. A gate that can only be satisfied by ignoring it is not a gate.

`multiple-versions` is a warning rather than a denial, for the same reason: duplicate majors
are routine mid-migration in this tree. They are still worth seeing — a duplicated
`@solana/program-client-core` on the TypeScript side is what made the generated client
untypeable until it was found.

## Consequences

- ADR-008 remains the statement of intent for the test pyramid. This ADR is the statement of
  what is enforced. A reader who needs to know whether something is checked reads this one.
- The deferred table is a work list. Each row names its blocker, so none of them is
  rediscovered from scratch.
- Anything landing a deferred gate should say so in its commit, and this table should shrink
  rather than be maintained as prose alongside a diverging reality. When it empties, a
  further ADR can record that ADR-008 is fully met.
- Three files already cite this ADR for the gaps they describe:
  `crates/agent-rails-policy/CLAUDE.md` (fuzz and Kani),
  `programs/agent_rails/tests/CLAUDE.md` (CU baseline), and the
  `policy-invariants` skill.
- The choice to name gaps rather than approximate them costs a reader one more document and
  buys the property that a green build means what it says.
