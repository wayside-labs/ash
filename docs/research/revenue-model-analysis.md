# ASH — Revenue Generation Analysis

**Date:** 2026-09-17 · regenerated against the current tree; supersedes the 2026-09-14 version of this file
**Repo state:** `main` @ `17c36aa` · 81 commits · 1 contributor · first commit 2026-09-08 · 23 instructions · 15 ADRs · CI live · unaudited, undeployed, no users
**Inputs:** `ARCHITECTURE.md`, `docs/adr/ADR-001..015`, `docs/spec/accounts-and-instructions.md`, `.github/workflows/`, `packages/cli/`, `programs/ash/tests/org_chart.rs`, `LICENSE` (Apache-2.0), program source. Market anchors cited inline in §6; competitive findings from `docs/research/colosseum-copilot-competitive-landscape.md`.
**Scope:** analysis only. No code changed.

---

## 0. What changed since 2026-09-14, and what it moves

Three days, 73 commits. This is not a cosmetic refresh — four of the changes move the analysis, and one of them creates a revenue line that did not exist in the previous version.

| Change | Source | What it moves |
|---|---|---|
| **CI exists and enforces most of ADR-008** — coverage (policy ≥95%, SDK ≥85%), Kani proofs, `cargo-mutants` with zero tolerated survivors, Surfpool E2E, cargo-deny, gitleaks, semgrep | ADR-015, `.github/workflows/` | §5.8. The previous version called green CI "the cheapest credibility you can buy" and noted there was none. It is bought. The grant application is materially stronger than it was |
| **`FundingMode::NativeAllowance`** — an owner can keep funds in their own wallet under a program-enforced delegation instead of pre-funding a vault | ADR-014 | §1 and §2. There is now a settlement path where *no money is ever escrowed anywhere*, and ASH composes with the Solana Foundation's own program rather than only with SPL Token |
| **Derived intent ids and a mandatory `reference`** on every payment | ADR-012 | New §5.3. Every payment now carries the caller's name for what it settles. That is a general ledger falling out of an anti-double-pay decision |
| **The org chart works today with no new instruction** — a treasury can pay another treasury's vault, so departments, per-agent budgets and per-level audit chains are an account layout, not a feature | `tests/org_chart.rs` (passing; currently untracked) | New §5.3, and a stated limitation in §5.1 — pause does **not** cascade |
| **Security postures: three presets, field overrides, six unreachable guarantees** | ADR-013 | §5.6. The `PolicyHook` extension point now has a declared, serializable, Zod-validated shape to ship data into |
| **`ash init` shipped** — empty wallet to a guarded payment in one command | `packages/cli/`, PR #15 | §5.10. The top of the funnel is real rather than planned |
| **Solana shipped a native, audited Subscriptions & Allowances program** | competitive landscape research | §1. "Cap what a delegate can spend" is now a free, native, Squads/Swig-integrated primitive. It is no longer a thing anyone would pay for, from anyone |

**One correction to carry forward.** The previous version recommended recording the no-protocol-fee decision as "ADR-012". ADR-012 through ADR-015 were written for other things in the interim, and **the fee decision was never recorded at all**. It is now ADR-016, it is still unwritten, and §3 still argues it is the one decision with a hard deadline.

**What did not change, and is now the whole story:** no `packages/indexer`, no devnet deployment, no `GOVERNANCE.md` / `SECURITY.md` / `THREAT_MODEL.md`, no audit, no users, and not one revenue-relevant decision recorded. Every paid product below sits behind the indexer; the indexer and the audit sit behind money; the money is §5.8.

---

## 1. The framing that decides everything

The previous version's framing was: money passes through a PDA the customer owns, we never touch it, so there is no toll booth by construction. That is still true, and ADR-014 has made it *more* true — under `NativeAllowance` the funds never move into an ASH account at all. They stay in the owner's own ATA and the program draws against a delegation whose delegatee is the Treasury PDA. There is now a supported configuration in which ASH never holds a lamport for a microsecond.

What changed underneath the framing is the competitive floor. Solana shipped **Subscriptions & Allowances** — native, on mainnet, audited by Cantina/Spearbit, integration-tested with Squads and Swig. It implements "a delegate may draw up to a cap, optionally time-boxed, revocably" and it is free. ADR-014 takes the correct posture toward it: *compose, do not compete*. But the commercial consequence has to be stated plainly:

> **Capping agent spend is now a commodity. It was the feature; it can never be the product.**

So the question is sharper than it was. Not "what is the monetizable asset when the asset is a guarantee?" but: **what remains monetizable once the primitive underneath the guarantee is free, audited and native?**

The answer is the layer the native program does not have and shows no sign of growing: **multiple simultaneous limits under separated roles, with a tamper-evident chain that proves nothing was omitted.** A delegation contract caps a number. ASH is the governance and accounting layer over the top — and governance and accounting are things organizations buy, whereas a spend cap is something they configure.

Which yields four sellable properties, not three:

| The guarantee needs to be… | Product | Why it is defensible |
|---|---|---|
| **Watched** | Guardian-as-a-Service — a pause-only key reacting to anomalies | The program *proves* you cannot steal. No competitor can offer a security service with a provably zero blast radius |
| **Observed** | Hosted indexer + console — ingestion, `verifyChain`, retention, alerting | Real marginal cost, real ops burden, nobody wants to run it |
| **Accounted** | Agent-org controllership — cost per agent, per role, per department, traced to a task id | *New.* The mandatory `reference` (ADR-012) and the treasury tree make this fall out of the payment path at zero additional program cost |
| **Proved** | Compliance attestations derived from the audit hash chain | Only ASH has the chain. Sold from a compliance budget, not an engineering budget |

Everything else below is a variation on those four, a financing mechanism, or a trap.

---

## 2. What the architecture forecloses — read this before designing any model

These are decisions already recorded. Each kills a class of revenue model. Three rows are new since the last version.

| Decision | Source | Revenue models it kills |
|---|---|---|
| **Non-custodial; vault is a program-owned PDA; owner can always withdraw, even while paused** | ARCH §3, §5 | Float/interest income. Payment spreads. Any "we hold it, we clip it" model. Also: **no leverage to enforce payment** — you can never withhold a customer's funds |
| **`NativeAllowance` — funds may never enter an ASH account at all** *(new)* | ADR-014 | The last residue of a float story. It also means a protocol fee would have to be levied on two settlement paths, the second of which is someone else's program |
| **Zero external program dependencies — now conditional** *(amended)* | ADR-001, amended by ADR-014 | Revenue-share deals routed through the program are still dead on the default path. ADR-014 is the one precedent for composing with another program, and it took a load-bearing security argument (`delegatee` = Treasury PDA) to earn it. It is not a template for partnerships |
| **Apache-2.0 on all code, no CLA** | ADR-011 §4 | Relicensing this repo. Open-core *inside* this repo once an outside contribution lands |
| **Upgrade authority → `None` at 1.0.0** | ADR-011 §2 | **Any on-chain fee added after the freeze.** See §3 — this is the one with a deadline |
| **Agent surface has zero privilege-escalating tools; postures are chosen by whoever starts the server, never by the agent** | ARCH §3, §10; ADR-013 §9 | Upsell paths running through the agent. `request_limit_increase` in v1.1 emits an off-chain event by design |
| **Pause is a kill switch, not an owner lock; guardians cannot unpause** | ARCH §3 | "We pause your treasury until you pay" — structurally impossible, and good |
| **Derived intent ids; a retry addresses the same receipt** *(new)* | ADR-012 | Reconciliation-as-a-product. There are no duplicate payments to reconcile. Sell the ledger (§5.3), not the cleanup |
| **Six properties are unreachable from any preset (`IMMUTABLE_GUARANTEES`)** *(new)* | ADR-013 §2 | A paid "strict mode". The dangerous knobs are not knobs; the safe ones are free. Security cannot be an edition |
| **No hosted service or dashboard in v1** | ARCH §1 non-goals | Nothing permanently; it sequences hosted revenue *after* v1 |

**Two assets the architecture creates that nothing else in the market has.**

1. **A pricing metric handed over by the data model.** Every customer publishes on-chain, in `MintLimit`, the maximum they are willing to lose — `long_window_max` and `lifetime_max`, denominated, readable by anyone. Under `NativeAllowance` there is a second, harder number beside it: the native delegation's own cap against a *live operating wallet*. §6 prices on the first and sells on the second.
2. **A general ledger nobody had to build.** `reference` is required and has no default (ADR-012 §2), it is inside the `intent_id` preimage, and `seq`/`audit_head` order it per session. Spend by agent (session), by role (policy), by department (treasury), by mint, each line traceable to an external task id — and non-omission is provable. That is §5.3, and it did not exist three days ago.

---

## 3. The one irreversible decision: a protocol fee must be settled before the freeze

Unchanged in substance, changed in urgency and in numbering.

ADR-011 phases the program `0.x` → `1.0.0-beta` → `1.0.0` with upgrade authority `None`. **After that, no fee logic can ever be added to v1.** It would need a 2.x program id and `migrate_treasury` on every existing treasury — re-onboarding the entire installed base to take a tax. Nobody migrates for that.

**The tension, stated plainly.** An on-chain fee needs a mutable global config (fee bps, fee destination) with an authority to set it. That authority is *exactly the super-owner the freeze exists to eliminate*. You cannot ship both "Immutable. Verify with `solana program show`" and "we can change the fee." The alternatives are worse:

- **Hard-coded immutable fee and destination in 1.0.0.** Honest and verifiable, but it prices adoption at the moment you have none, it is removable in one line of a fork (Apache-2.0), and it turns a security tool into a value-extraction tool in the README's first paragraph. Against a *free native primitive* (§1), it is also simply uncompetitive.
- **Fee fields reserved but inert.** Reserved bytes let data land without migration — ADR-014 just proved it, reclaiming a byte from `MintConfig._pad[6]` with no account migration. But frozen *code* cannot act on new data. Reserving buys nothing post-freeze.
- **A fee on the `NativeAllowance` path only.** Worse than either: the transfer is a CPI into a program you do not control, on funds that never enter your accounts, and the fee would be trivially avoided by choosing the other funding mode.

**Recommendation: no protocol fee in v1 — and record it as ADR-016, with this reasoning.** Immutability *is* the product; adoption is the only input to every model in §5; and the primitive below you is free. A frozen, fee-free, forkable program is the correct answer.

Two things have changed about the deadline since the last version, and they point in opposite directions:

- **It is further away than it looked.** ADR-015 defers the verifiable build hash and the devnet smoke test to a release workflow that does not exist, no tag has been pushed, and the program is not deployed on devnet — deploying needs **7.10 SOL** for programdata against the **5 SOL** the CI key holds. The freeze is several milestones out.
- **Which is exactly why it should be written now.** The decision costs an hour today and is unavailable forever after the freeze. The previous version recommended it on 2026-09-14; three days and four ADRs later it is still not recorded, and the ADR number it was going to take is gone. That is the failure mode this row exists to prevent.

If you want to preserve optionality: the honest version is a fee on **2.x**, introduced openly as the price of the next feature generation, with 1.x free and supported forever. That is a real strategy and costs nothing to keep open today.

---

## 4. The second irreversible decision: where enterprise code lives — now coupled to going public

ADR-011 chose **Apache-2.0, DCO, no CLA**. You are still the sole contributor across all 81 commits, so you still own everything and could relicense at will. **The moment a third party's PR merges, that ends** — no CLA means no right to relicense their contribution, and this repo is Apache-2.0 forever.

So: **if there will ever be a commercial edition, it must live in a separate repository from day one**, under a separate license, importing `@ash/*` as a dependency. Retrofitting is impossible.

```
ash/            Apache-2.0, forever, no exceptions
  program, policy crate, client, sdk, mcp, contract, cli, adapters, indexer core
    → the thing people audit, fork, and trust

ash-cloud/      proprietary or BUSL-1.1, separate repo, private or source-available
  guardian service, hosted indexer + console, controllership, compliance exports,
  managed signer, SSO/RBAC, policy packs
    → the thing people pay for
```

Nothing proprietary belongs in the payment path or the enforcement path. The dividing line: *if it can refuse a payment, it is Apache-2.0.*

**What is new: this decision now has a trigger date, and the trigger is a decision you are already being pushed toward.** ADR-015 records that CodeQL is unavailable because the repository is private, and that it becomes free if the repository goes public. Several other things want the same thing — grant reviewers reading the ADR set (§5.8), auditors, and the whole "verify it yourself" pitch. Going public is probably right. **Going public is also what invites the first external PR.** The two decisions are the same decision, taken in the wrong order if taken carelessly.

**Action, cheap, today:** record the split before flipping the repository to public, and note it in `GOVERNANCE.md` — still planned, still unwritten, and a prerequisite for both the grant and the audit alongside `SECURITY.md` and `THREAT_MODEL.md`.

---

## 5. Revenue options, ranked

Ranked by (fit with the architecture) × (defensibility) ÷ (effort for a solo maintainer). Ten lines; two are new since the last version.

### 5.1 ★★★ Guardian-as-a-Service — still the strongest fit

**What it is.** The customer adds your pubkey to one of their five guardian slots. You monitor their event stream and call `pause` when something looks wrong: spend velocity climbing toward `short_window_max`, a burst of denials, a session paying a never-before-seen destination, an agent hitting `per_tx_max` repeatedly, activity outside declared business hours.

**Why it is the strongest idea here.** Security services have a trust problem: to protect you I need access, and access is risk. The program already solved it. A guardian can call exactly one instruction, cannot unpause, cannot withdraw, cannot configure, cannot touch a policy or a session, and can be removed by the owner unilaterally with no cooperation from you. **The worst a fully compromised ASH guardian can do is turn the customer's agent off** — and that is checkable on-chain in ten seconds rather than asserted in a trust-centre PDF.

**What `NativeAllowance` changes.** It raises the value. Under `IsolatedVault` the blast radius is what the owner chose to escrow; under `NativeAllowance` the delegation is against the owner's **live operating wallet**, bounded by the native program's cap and by ASH' policy. The owner who picked capital efficiency bought a larger surface to watch, and watching it is what you sell.

**A limitation to state before selling, not after.** Pause is scoped to one treasury. `org_chart.rs` asserts this deliberately as a negative result: **pausing a parent treasury does not pause its children.** A guardian contract over an org tree therefore needs a key in every treasury it is expected to stop, and the incident runbook has to say so. Cascading pause is the one hierarchy feature worth adding (v1.1 candidate; see `agent-orgs-and-defi-mandates.md` §2.4) and, until it exists, multi-treasury coverage is a real scope item — which is also a legitimate reason for the multi-treasury tier to cost more.

**Effort.** Moderate, and it reuses work already owed: the event stream, `verifyChain` and alerting are all `@ash/indexer`, on the v1 plan anyway. The service is a rules engine plus a hot key plus a pager.

**Risks.** (a) A false-positive pause is a production outage for the customer — the SLA must be about *detection*, never about "we will not pause you wrongly"; ship dry-run mode and make it the default. (b) A pause-happy guardian is a DoS vector; rate-limit yourself. (c) You hold a hot key with a real, if bounded, capability — apply the discipline the docs demand of customers.

Pricing in §6.2.

### 5.2 ★★★ Hosted indexer + console — now the critical path

**What it is.** `@ash/indexer` is specified as pluggable `EventSource` (polling, Yellowstone) → `Sink` (SQLite, Postgres) with `verifyChain`. Ship it Apache-2.0 so anyone can self-host; sell the hosted one: managed ingestion, retention beyond what gPA can answer, `list_payments` / `get_payment_status` backing for MCP, a read-only console, alerting, CSV/JSON export.

**Why it fits.** Real marginal cost (Yellowstone/Geyser and retention are genuinely expensive, which makes a price defensible rather than rent-seeking); zero custody risk (it reads public chain data); and the MCP contract degrades honestly without it — `list_payments` is documented as degrading to "unavailable" and is *not yet implemented* (ARCH §10), so the free path stays truthful and the paid path is a real upgrade rather than a hostage situation.

**Why it is second in value and first in order.** It is closer to a commodity — Helius and Triton sell indexing; the differentiation is understanding `AshEvent` and running `verifyChain`. But **nothing else in this document ships without it**: §5.1 needs its event stream, §5.3 needs its aggregation, §5.4 needs its retention. It is one build under three products, `packages/indexer` does not exist yet, and that makes it the single highest-leverage engineering item in the repository.

### 5.3 ★★★ Agent-org controllership — the line that did not exist three days ago

**What it is.** FinOps for organizations of agents: cost per agent, per role, per department; every payment traced to an external task id; consolidated across a treasury tree; exportable to whatever the finance function already uses.

**Why it is suddenly available.** Two decisions that were made for other reasons collided:

- **ADR-012 made `reference` mandatory with no default.** It is the caller's name for what is being settled — an invoice number, a document hash, a task id — and it is inside the `intent_id` preimage, so it cannot be omitted or faked after the fact without changing which receipt the payment addresses.
- **`org_chart.rs` (passing) proved the hierarchy needs no new instruction.** `destination_owner` is an `UncheckedAccount` the program never reads, and a treasury's vault is the plain ATA of its own PDA — so allowlisting a child treasury's PDA makes a payment land in that child's vault, where it is spent under the child's own ceiling, policy, counters and audit chain. The org chart is an account layout.

Together: **every dimension a controller would ask for is already being written on-chain by the payment path.** Session is the agent, policy is the role, treasury is the department, `reference` is the cost object, and `seq`/`audit_head` make the ledger non-omittable. The indexer aggregates; the program generated the data for free.

**Why it sells.** It is bought by the same person who buys §5.4 — finance, not engineering — but it is bought *earlier*, because cost allocation is a monthly need and an audit is an annual one. It is also the one line here that gets more valuable as the customer runs more agents, which is the direction the market is going.

**Honest gaps.** Nothing on-chain knows a treasury is a child of another (no `parent` link — cheap, fits in reserved bytes), ceilings do not propagate, and pause does not cascade. Today consolidation is an indexer join over a convention, which is fine for a product and should not be sold as an on-chain guarantee.

Pricing in §6.4.

### 5.4 ★★ Compliance and assurance exports

**What it is.** Turn `audit_head` into an artifact a finance or audit function will pay for: a periodic, signed, independently verifiable statement that *every payment this agent made in Q3 was inside the stated policy, and here is the hash chain proving none were omitted.*

**Why only you can sell it.** The per-session chain (`seq`, `audit_head = sha256(DOMAIN ‖ prev_head ‖ seq ‖ intent_id ‖ mint ‖ destination_owner ‖ amount ‖ slot)`, ADR-006) makes *omission* detectable, not just alteration. A competitor with off-chain logs can prove records were not edited; they cannot prove none were deleted. That distinction is the entire value of an audit artifact.

**What is newly sellable alongside it.** The engineering record is now itself evidence: Kani proofs of the four ADR-008 properties plus two the ADR did not name, a mutation-testing gate with zero tolerated survivors, measured coverage (99.2% policy, 89.4% SDK), a byte-layout snapshot test, and `IMMUTABLE_GUARANTEES` naming the six properties no configuration can reach. An auditor asking "how do you know the limit arithmetic is right" now has a document-shaped answer. That is worth assembling into the attestation package rather than leaving in CI logs.

**What to sell.** Scheduled attestation reports; retention past on-chain practicality; a third-party verifier tool (Apache-2.0 — give the verifier away, it *increases* the attestation's value); destination-screening evidence (§5.6) attached to each period; formats an auditor recognises.

**Buyer.** Not the developer. Finance, risk or compliance — a different budget, a much higher willingness to pay, and renewal driven by the audit calendar rather than engineering enthusiasm.

**Prerequisite.** It only sells to companies large enough to have an audit function. Design for it now; sell it in year two.

### 5.5 ★★ Verifiable agent track record — note it, do not build it

A session's chain is a timestamped record of what an agent was allowed to spend and what it actually spent, and it is third-party verifiable without trusting the publisher. That is raw material for **agent reputation** — for marketplaces, for anyone allocating capital to agent strategies, and as a discovery layer.

It is a two-sided market and depends entirely on prior adoption, so it is a note, not a plan. Worth one sentence in a pitch and zero engineering hours in 2026.

### 5.6 ★★ Policy packs and destination screening — subscription content

**What it is.** The SDK's `PolicyHook` interface is an extension point with nothing shipped in it. Fill it with *maintained data*, which is the only kind of software that legitimately recurs: sanctioned and high-risk destination lists; known drainer feeds; mint risk classification (honeypots, live freeze authority, extension surprises); curated rule packs for common shapes — business-hours-only, per-vendor budgets, invoice-matched payments.

**Why it works better than it did.** ADR-013 gave the posture a declared shape: presets plus field-level overrides, serialized in `@ash/contract`, validated by the same Zod schema that documents it, parsed at construction so a typo is a startup failure. A subscription now ships *a posture fragment and a feed*, into a slot that exists, with a snapshot test around it — rather than into an interface that had no shipped implementation.

**Why it survives forking.** The interface is free and open; the feed is a subscription. That is the ClamAV/Snyk/Semgrep-registry pattern: a fork gets the code, not the updates.

**Caveat that must be in the docs.** Soft policies are explicitly *not the guarantee* (ARCH §6, README). The four-state result (`match / possible / no_match / **unavailable**`) is mandatory so a feed outage can never read as "allowed" — and ADR-013 already names the corresponding knob, `hooks.onUnavailable`, with the on-chain limits as its backstop. Market it as defense in depth, never as enforcement.

### 5.7 ★ Relayer — and skip managed signing

- **Relayer (v1.1).** In signed-intent mode the agent signs the intent off-chain and a relayer submits `[Ed25519Program.verify, execute_payment]`. `fee_payer` is already a separate account from `session_key` precisely so sponsorship works. Charge gas plus margin, metered per transaction. Small, obvious unit cost, and nobody else will build one that understands `PaymentIntent`.
- **Managed signing: skip it.** Turnkey, Privy, Dfns and Fireblocks already sell it, and ARCH §9 deliberately makes any Kit-compatible signer work without glue — which is right for users and means competing on their turf without their compliance apparatus.

### 5.8 ★★★ Grants — still the correct *first* move, and the application is materially stronger

ADR-011 budgets the professional audit at **$30–80k** and names Solana Foundation / Superteam grants as the funding path. For a solo project this remains the highest-expected-value action in the document, and the reasons are unchanged: non-dilutive; needs no customers, no product-market fit and no hosted infrastructure; **it funds the audit, and the audit gates every other line here** — nobody routes real treasury through an unaudited program.

**What is stronger than three days ago:**

| Then (2026-09-14) | Now |
|---|---|
| No CI at all | Five workflows; coverage, Kani, mutants, E2E, supply chain, secrets, SAST — all gating |
| 11 ADRs | 15, including one that names its own deferred gates rather than overstating them (ADR-015) |
| CLI `init` planned | Shipped: empty wallet → guarded payment in one command |
| Composition with the native Foundation program: not a story | ADR-014, verified against the real devnet binary, including the attack that proves the delegatee choice is load-bearing |

That last row is worth its own sentence in an application. The Foundation shipped Subscriptions & Allowances in this window; **ASH is now a governance layer that composes with it and proves the composition is safe against the real deployed binary.** That is a far better grant narrative than "an alternative to a thing the Foundation just shipped."

**The one cheap blocker.** There is still no devnet deployment, and ADR-015 measured why: **7.10 SOL** of programdata rent against **5 SOL** in the CI key, and the public faucet rate-limits. That is roughly 2–3 SOL plus buffer standing between the repository and the single strongest artifact an application can show. Fix it this week.

**What makes the application strong, in order:** a working devnet deployment; the ADR set (almost no applicant has fifteen accepted ADRs); the test pyramid with its gaps *named*; green CI; a named audit firm and quote; and a clear statement that the program will be frozen and fee-free (§3).

### 5.9 ★ Enterprise: deployment, integration, support

Retainers for integration, custom adapters, policy design review, private Slack, response SLAs. High margin, immediate cash, no infrastructure.

**The honest problem:** it does not scale past your own hours, and at one contributor every hour sold delays the indexer (§5.2), which delays everything. Treat consulting as **opportunistic, capped and strategic**: take engagements that produce a reference customer or a reusable adapter, decline the rest. A design-partner arrangement — discounted or free integration in exchange for a public case study and detailed feedback — is usually worth more than the fee at this stage.

### 5.10 Distribution plays that are not directly revenue

- **`ash init` — now shipped, and the funnel's top.** Five instructions in the only order that works, plus funding, the session keypair on disk and the `mcpServers` block printed for `claude_desktop_config.json`. Time-to-first-payment is the top of every funnel here and it is now measurable rather than aspirational. Instrument it.
- **The x402 adapter.** x402 processed roughly 75M transactions and $24M in a recent 30-day window, mostly sub-$1, under a Linux Foundation umbrella whose members include Google, Visa, AWS, Circle and Anthropic. Making ASH the policy layer under that ecosystem is distribution, not revenue — but every treasury it brings is a §5.1, §5.2 and §5.3 prospect.
- **Framework adapters** (LangChain, AI SDK, OpenAI Agents) and the PyPI package, listed in each framework's tool directory. Still unbuilt; still free distribution.

### 5.11 Strategic / acquisition

The most probable large outcome for a non-custodial agent-spend-control primitive is **acquisition by an adjacent player** — Squads, Turnkey, Privy, Dfns, a wallet, or a treasury platform. Each has customers asking "how do I let an agent spend without handing it the keys" and none has a clean answer. What raises that value is *not* revenue: adoption, an audit, a frozen program, and clean Apache-2.0 provenance. Same list as everything else. Optimise the product; the option comes free.

---

## 6. Pricing — anchors and ladders

> Nothing here is sellable before the audit. These numbers decide the *shape* of the charge and the order of magnitude, not next week's price page.

### 6.1 Market anchors

| Product | Public price | Source |
|---|---|---|
| **Squads** | $0 Basic (one-off 0.1 SOL) · **$49/mo Pro** · Enterprise on request | docs.squads.so |
| **Helius** (Solana RPC + indexing) | $0 · **$49** · **$499** · **$999**/mo; data add-ons $500–$4,500/mo | helius.dev/pricing |
| **Privy** (wallet infra) | Free · **$299** · **$499**/mo · Enterprise | privy.io/pricing |
| **Turnkey** (signing) | **$0.10/signature** PAYG · **$99/mo** Pro at $0.05 · Enterprise at $0.0015 | openfort comparison |
| **Gate402 / Metera** (adjacent) | $0 · $29 · $99/mo · custom | prior research |
| **Chainalysis** (compliance) | **€120k–€250k/yr** for a mid-size CASP; implementation $5k–$25k | finconduit |
| **Hypernative** (security monitoring) | No public price — enterprise. $40M Series B, 200+ customers | hypernative.io |

**What the anchors say:** Solana developer infrastructure lives at **$49–$999/mo**; real security and compliance live at **five to six figures a year**; per-operation billing is accepted at **cents**.

### 6.2 Guardian-as-a-Service

Charge on **aggregate protected ceiling** — the summed `long_window_max` across configured mints. The customer already published that number on-chain; it is their own statement of the maximum they accept losing.

| Plan | Price | Protected ceiling | Includes |
|---|---|---|---|
| **Watch** | **$0** | 1 treasury, any ceiling | Dry-run only (alerts, never pauses), webhook alerts, no SLA |
| **Guard** | **$149/mo** | up to **$10k/day** | Armed pause, standard rules, 15-min *detection* SLA, one guardian key |
| **Guard Pro** | **$599/mo** | up to **$100k/day** | Custom rules, 5-min detection SLA, key per environment, incident runbook |
| **Guard Scale** | **$1,999/mo** | up to **$1M/day** | 1-min SLA, private RPC, on-call, quarterly policy review |
| **Enterprise** | on request | above $1M/day | Multi-entity, contract, dedicated support |

$599/mo against a $100k/day declared ceiling is $7,188/yr against a self-declared maximum single-day loss of $100k — about 7% of one day's exposure, for a year. Against Hypernative (enterprise, five figures) this is the accessible option; against Helius Business ($499) it sits in the same "serious production infrastructure" band. **Never put "we will not pause you wrongly" in an SLA.** The SLA is detection; dry-run is the default. Multi-treasury coverage is a real scope increase (§5.1 — pause does not cascade) and should price accordingly.

### 6.3 Hosted indexer + console

| Plan | Price | Includes |
|---|---|---|
| **Free** | **$0** | 1 treasury, 7-day retention, on-demand `verifyChain`, read-only console |
| **Team** | **$149/mo** | 5 treasuries, 90 days, alerts, CSV/JSON export, `list_payments` in MCP |
| **Business** | **$599/mo** | Unlimited treasuries, 12 months, webhooks, SSO, multiple users |
| **Enterprise** | on request (reference **$1,500–$4,000/mo**) | Multi-year retention, dedicated Postgres, VPC, ingestion SLA |

**Cost base to verify before publishing:** one Helius Business ($499) or Professional ($999) plan plus a data add-on serves *several* customers. At $149 for Team, gross margin closes around five paying customers. Validate with real numbers before committing to a price.

### 6.4 Agent-org controllership

Charge per **active agent session** — the unit the customer understands and the one that grows with delivered value.

| Plan | Price | Includes |
|---|---|---|
| **Free** | **$0** | up to 3 active sessions, basic monthly report |
| **Team** | **$9/agent/mo** (min $49) | Cost per agent/role/department, `reference` tracing, export |
| **Business** | **$599/mo** | Unlimited agents, multi-treasury consolidation, cost centres, accounting export, API |
| **Enterprise** | on request | Multiple entities, ERP integration, custom fields |

$9/agent is a familiar SaaS seat price to whoever approves the budget. Fifty agents lands at $450/mo, which is where Business at $599 starts to make sense on its own — the ladder climbs itself.

### 6.5 The bundle, which is the actual product

| **Treasury Assurance** | **$999/mo** |
|---|---|
| Guard Pro (to $100k/day) + Indexer Business + unlimited controllership | ~30% off the three bought separately ($1,797) |

One price, one contract, one buyer. Lead with it; the individual plans exist for people who want one piece.

### 6.6 Compliance attestations, relayer, feeds, services

| Item | Price |
|---|---|
| Quarterly attestation, 1 treasury | **$2,500/quarter** or **$8,000/yr** |
| Multi-entity, auditor-specified format, due-diligence support | **$25,000–$60,000/yr** |
| Attestation onboarding | **$5,000–$15,000** one-off |
| Relayer | **$0.002 per sponsored transaction**, $49/mo floor (Turnkey charges $0.05–$0.10 per signature — an order of magnitude above, and a good sales line) |
| Screening feed, Basic (sanctions + drainers, daily) | **$199/mo** |
| Screening feed, Pro (+ mint risk, rule packs, history, update SLA) | **$499/mo** |
| Design partner (integration + public case study) | **$5,000–$15,000**, or free for the case study, feedback and reference |
| Integration retainer | **$3,000–$8,000/mo**, capped hours |
| Policy design review | **$2,500** per engagement |

Chainalysis at €120k–250k/yr is the ceiling of the compliance budget; a narrow, specific artifact is 5–20% of that. The verifier stays free and open-source — that is what makes the attestation credible.

### 6.7 Reality check

At **Treasury Assurance, $999/mo**:

| Customers | MRR | ARR | Meaning |
|---|---|---|---|
| 5 | $5,000 | $60,000 | Pays the infrastructure and a little more |
| 10 | $10,000 | $120,000 | Supports one person full time |
| 25 | $25,000 | $300,000 | Supports a small team |
| 50 | $50,000 | $600,000 | The investor conversation changes tone |

**The question is not which price to charge. It is whether ten reachable companies exist today that run agents with enough money to justify $999/mo.** Nobody has verified that. See §9.

---

## 7. What does not work, and why

| Idea | Why not |
|---|---|
| **Protocol fee on `execute_payment` (v1)** | Irreconcilable with the frozen-immutable claim; removable in one line of a fork; taxes adoption you do not have; and now uncompetitive against a free native primitive. See §3 |
| **Competing with Subscriptions & Allowances on "capping spend"** | It is native, free, audited by Cantina/Spearbit and already integrated with Squads and Swig. Compose with it (ADR-014 does); compete on roles, multi-limits, allowlists and the audit chain, which it does not have |
| **Taking custody / earning float** | Destroys the single differentiating claim. Not a tradeoff — a category error. Under `NativeAllowance` there is not even a balance to earn it on |
| **Token** | No sink. No fee to distribute, no staking role a guardian key does not fill better, no governance decision left after the freeze. It adds a regulated liability to a product whose pitch is "verify it yourself." If capital is needed: §5.8 first, equity second |
| **Gating the MCP tools or the SDK** | The agent surface is the adoption surface. Gating it kills the funnel to every model in §5 |
| **Selling a "strict mode"** | ADR-013's admission test put the dangerous properties in `IMMUTABLE_GUARANTEES`, unreachable from any preset. Security is not an edition; the presets are free |
| **Charging for the audit-chain verifier** | Give `verifyChain` away. An attestation nobody can independently verify is worth less, not more |
| **Withholding funds for non-payment** | Structurally impossible — owner withdrawal always works, even while paused — and would be a betrayal of the design if it were not |
| **Open-core inside this repo** | Apache-2.0 + no CLA. See §4 — separate repo, decided before the first external PR and before going public |
| **Building DeFi execution** (lending, perps, LP) | A different program with a different threat model, three years behind the incumbents, and it abandons the one claim that is defensible. Govern *allocation*, not operation — see `agent-orgs-and-defi-mandates.md` §3.3 |
| **A hosted dashboard in v1** | Explicit non-goal (ARCH §1). Correct — it delays the audit, and the audit gates all revenue |

---

## 8. Sequencing for a solo maintainer

Nine days in, one contributor, program complete at 23 instructions, CI green, CLI shipped, no indexer, no deployment, no audit, no users. The binding constraint is still your time.

**Phase 0 — now → v1 (no revenue, all leverage).** Shorter than it was; the CI and CLI rows are done.
1. **Deploy to devnet.** ~2–3 SOL plus buffer over the CI key's 5. Cheapest credibility left, and a grant prerequisite.
2. **Build `@ash/indexer`, Apache-2.0.** One substrate under §5.1, §5.2 and §5.3. Highest-leverage code in the repo.
3. **Write `GOVERNANCE.md`, `SECURITY.md`, `THREAT_MODEL.md`.** All three are grant and audit prerequisites; all three are still unwritten.
4. **Record ADR-016: no protocol fee in v1** (§3), and the **enterprise-repo split** (§4) — before the repository goes public.
5. Commit `org_chart.rs`. It is a passing test that demonstrates the org chart and it is currently untracked.

**Phase 1 — grant + audit (§5.8).** Apply with the devnet deployment, fifteen ADRs, green CI with named gaps, the ADR-014 composition story, and an audit quote. This funds the freeze. Nothing else starts in earnest until the program is audited.

**Phase 2 — first paid products (§5.1 + §5.2 + §5.3).** Hosted indexer, Guardian-as-a-Service and controllership on top of the same substrate, in the separate repo. Guardian is the differentiated one; controllership is the one bought most often; the indexer makes both possible.

**Phase 3 — expand (§5.6, §5.7, §5.4).** Screening feeds once there are enough treasuries to justify maintaining a list. The relayer with v1.1's signed-intent mode. Compliance exports when the first customer with an audit function appears — they will ask before you offer.

Throughout: take consulting only where it creates a reference customer or a reusable adapter (§5.9).

---

## 9. Open questions only you can answer

1. **Does the buyer exist?** This is now the most important question in the document and it is unanswered. The hackathon-corpus sweep found no project attacking uncontrolled agent spend directly (the nearest, Blockpal Smart Delegation, has no audit chain and no role separation), and the adjacent market is all *agent-to-agent payment* rather than *owner-side spend governance*. Either this is early or the pain is smaller than it looks. **Five customer conversations answer it and nothing else does** — and they should happen before anything in §6 is published.
2. **Why not just compose Solana Allowances + Squads?** Free, native, audited, already integrated. The defensible answer exists — no session with simultaneous per-tx *and* window *and* lifetime limits, no destination-plus-mint allowlist, no per-session audit chain, no guardian kill switch separate from the owner, no non-escalating MCP surface — but it has to be in the README's first screen, because it is the first question every evaluator will ask.
3. **Public or private repository?** It unlocks CodeQL, it strengthens the grant, it fits the "verify it yourself" pitch — and it starts the clock on §4. Decide both together.
4. **Company or public good?** I have assumed "public good that funds itself, with an option on a company." If it is venture-backed, §3's fee answer deserves an argument rather than a default — the answer is still probably no.
5. **Who is the first user you actually want?** A solo dev wiring Claude to a devnet wallet and a fintech giving an agent a $50k/day mandate need different products, docs and prices. §6 assumes the latter exists; §5.10 assumes the former is how you find them.
6. **How much of your time is sellable?** §5.9 is the fastest cash and the slowest strategy. The right cap is a number, not a vibe.
