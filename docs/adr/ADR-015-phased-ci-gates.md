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
| CU regression >10% over the committed baseline | `programs/agent_rails/tests/cu-baselines.txt`, asserted by `tests/budget.rs` inside that run; refreshed with `scripts/cu-baseline.sh` |
| coverage: policy crate ≥95% lines | `cargo llvm-cov --fail-under-lines 95`, in `scripts/verify.sh rust` |
| coverage: SDK ≥85% lines/statements/functions, ≥70% branches | thresholds in `packages/sdk/vitest.config.ts`, run by `scripts/verify.sh ts` |
| `overflow-checks = true` still set | `scripts/verify.sh rust` |
| Biome, tsc, vitest, `pnpm audit` | `scripts/verify.sh ts` |
| generated client matches the committed IDL | `pnpm codegen:check`, same script |
| cargo-deny — advisories, licenses, bans, sources | `supply-chain` job |
| secret scanning over history | `secrets` job (gitleaks CLI) |
| SAST | `sast` job (semgrep `p/typescript`, `p/rust`) |
| Kani proofs: no overflow, monotone rollover, the `≤` partial order, audit preimage injective in `seq` | `crates/agent-rails-policy/src/proofs.rs`, run by `scripts/verify.sh kani` |
| `cargo-mutants`: no surviving mutant in the policy crate | `.cargo/mutants.toml`, run by `scripts/verify.sh mutants` |
| SHA-pinned Actions, `permissions: contents: read` | throughout |

`.github/workflows/idl.yml`, path-filtered to the program and its dependencies: rebuilds
the IDL from the program and fails if the committed one differs. ADR-008 asked for an "IDL
diff comment"; a failing gate was chosen over a comment, because a comment is advisory.

`.github/workflows/mutants.yml`, nightly and manually dispatchable, path-filtered on pull
requests to the gate's own files. 127 mutants, ~4m10s.

`.github/workflows/kani.yml`, path-filtered to the policy crate, plus nightly and manual
triggers. Thirteen harnesses; 1m14s per run on the runner, 38s of it solver. It is not a
required status check —
ADR-008 scoped Kani as non-blocking, and idl.yml already records why a path-filtered job
must never be required.

Two gates are enforced that ADR-008 did not list — `pnpm audit` and the `overflow-checks`
assertion — because the invariants they protect had no mechanism otherwise.

### Deferred, with the reason

| Gate | Why not yet | What lands it |
|---|---|---|
| **Trident stateful fuzzing** | Blocked upstream, not unwritten. Every published Trident — 0.12.0 and the 0.13.0-rc line alike — requires `solana-sdk ^2.3`, and this tree is Anchor 1.1.2 on solana 3.x. Cargo resolves the pair, then produces three incompatible majors of `solana-pubkey` (2.4.0 / 3.0.0 / 4.3.0) and of `solana-instruction` (2.3.3 / 3.5.1 / 4.0.0). A harness cannot hand its generated pubkeys to an instruction that expects a different `Pubkey` of the same name. | A Trident release that supports Anchor 1.x / solana 3.x. Nothing in this repository unblocks it. |
| **Verifiable build hash** | Belongs with the release process (ADR-011), which has not run yet. | A release workflow producing and publishing the hash. |
| **Surfpool E2E** | The secret it was waiting on exists: `DEVNET_KEYPAIR`, set and funded on devnet 2026-09-17. Nothing external blocks it now — there is simply no suite. No Surfpool tests, no mainnet-forked USDC fixture, no nightly workflow. | An E2E suite against mainnet-forked USDC, plus a nightly workflow that consumes `DEVNET_KEYPAIR`. |
| **devnet smoke on release tags** | Release-tag scoped in ADR-008, and there is no release workflow to hang it on — the same missing artifact the verifiable build hash row names. No tag has been pushed. | The ADR-011 release workflow, with a smoke job on the tag. |

`DEVNET_KEYPAIR` is a repository Actions secret holding a devnet keypair, funded on
2026-09-17. Recorded here so the next reader does not generate a second one, and so the
balance can be checked without it:
`5eznzq18xdeVaagEkyo7DYb8v12mAWmYcz6AdWTnH8JQ`. A nightly job that spends will drain it, and
topping it up is manual — the public faucet rate-limits by IP and refused six consecutive
requests from the machine that created the key. Worth knowing before a red nightly is
diagnosed as a test failure.

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

Kani runs per pull request when the policy crate changes, not only nightly. ADR-008 put it
nightly on the assumption that model checking is slow; measured, a whole run is 1m14s, which
is less than the `rust` job already spends. Nightly is kept as well, because a
Kani release can change what its solver discharges without the crate changing — but a proof
that only ever fails at 05:00 names the wrong commit.

`cargo-mutants` stays nightly, where Kani did not, and the reason is measured rather than
deferential: the run is ~4m10s of rebuild-and-test across 127 mutants, against 38s of solver
for Kani. Kani earned a place on the critical path; this does not. It is also scoped to the
policy crate alone — the Anchor program's tests drive an SVM, so `cargo test --workspace`
takes 93s against the policy crate's 1s, and a single mutant would cost what the whole
policy run costs. Mutation testing is affordable exactly where the code is pure, which is
the property ADR-008 split the crate out for in the first place.

ADR-008's ordering put `cargo-mutants` after Trident ("a nightly workflow once the suite
above is in place"). That dependency was assumed, not real: mutation testing runs against
whatever tests exist, and the policy crate's suite was enough. With Trident blocked upstream
indefinitely, waiting would have deferred this gate forever for no reason.

`.cargo/mutants.toml` excludes `src/proofs.rs`, which is `cfg(kani)` and therefore never
compiled by `cargo test`. Mutating it yields 51 mutants — 29% of the total — that no test
run can kill, all reported as survivors. That exclusion is the difference between a gate and
a permanent red.

One harness is bounded more tightly than the rest, and `proofs.rs` says so at the point it
happens: proving `(new_start - start) % window == 0` over a *symbolic* window does not
terminate — measured past 10 minutes against ~3 seconds for the property stated as the
overflow guards' contract instead. Both catch the same regression. The comment records the
trade so the next reader does not spend the ten minutes rediscovering it.

## Consequences

- ADR-008 remains the statement of intent for the test pyramid. This ADR is the statement of
  what is enforced. A reader who needs to know whether something is checked reads this one.
- The deferred table is a work list. Each row names its blocker, so none of them is
  rediscovered from scratch.
- Anything landing a deferred gate should say so in its commit, and this table should shrink
  rather than be maintained as prose alongside a diverging reality. When it empties, a
  further ADR can record that ADR-008 is fully met.
- Three files already cite this ADR for the gaps they describe:
  `crates/agent-rails-policy/CLAUDE.md` (fuzz, and Kani until it landed),
  `programs/agent_rails/tests/CLAUDE.md` (CU baseline), and the
  `policy-invariants` skill.
- Writing the Kani proofs found that three of them pass a `limit_leq_ceiling` whose window
  comparison is reversed — `<=` for `>=` is still a partial order, just the wrong one, so
  reflexivity, antisymmetry and transitivity all survive it. ADR-008's four properties are
  necessary and not sufficient: the direction of the order is only visible in what the
  windows do, which is why `proofs.rs` carries two harnesses ADR-008 did not name. A gate
  accepted on the strength of its passing would have shipped that hole.
- `cargo-mutants` found nine surviving mutants on its first run against a crate measuring
  99.2% line coverage, seven of them in the ceiling partial order. `cargo test` contained
  nothing that failed when `limit_leq_ceiling` was replaced with `-> true`: proptest
  generates limits that fit their ceiling by construction, `rejections.rs` covers the
  validators, and the order itself was asserted by nothing that could tell a conjunction
  from a disjunction. The Kani harnesses do prove it, which is exactly why the hole was
  invisible — the crate was covered, just not by anything `cargo test` runs. All nine are
  killed by `tests/ceiling_order.rs`, written for that purpose. Coverage says a line ran;
  mutation testing says an assertion depended on it.
- The gate is "no surviving mutant", with no tolerated count. `#[mutants::skip]` at the site
  is the escape hatch for genuinely untestable code, chosen over a numeric allowance because
  a reviewer sees the attribute in the diff and would never see a threshold drift upward.
- The choice to name gaps rather than approximate them costs a reader one more document and
  buys the property that a green build means what it says.
