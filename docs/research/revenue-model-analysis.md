# Agent Rails — Revenue Generation Analysis

**Date:** 2026-09-14
**Repo state:** `feature/ts-sdk` @ `95ec615` · 8 commits · 1 contributor · first commit 2026-09-08
**Inputs:** `ARCHITECTURE.md`, `docs/adr/ADR-001..011`, `docs/spec/accounts-and-instructions.md`, `LICENSE` (Apache-2.0), program source
**Scope:** analysis only. No code changed.

---

## 1. The framing that decides everything

Gate402 can take a cut because **money passes through it**. Agent Rails cannot, because money passes through a PDA *the customer owns* — and never touching it is the entire product. There is no toll booth on this road by construction.

So the question is not "where do we skim?" It is: **what is the monetizable asset when the asset is a guarantee?**

The guarantee itself is unsellable. It is Apache-2.0 (ADR-011 §4), it will be frozen and immutable at 1.0.0, and a frozen Apache-2.0 program is infinitely forkable at zero marginal cost. Anyone can deploy your program under their own id tomorrow. That is not a bug — it is what makes the trust claim credible — but it means **you will never sell the rails.**

What you *can* sell is everything required to make the guarantee **operable, observable, and provable**:

| The guarantee needs to be… | Product | Why it's defensible |
|---|---|---|
| **Watched** | Guardian-as-a-Service — a pause-only key that reacts to anomalies | The program *proves* you can't steal. No competitor can offer a security service with a provably zero blast radius |
| **Observed** | Hosted indexer + console — event ingestion, `verifyChain`, alerting, retention | Real marginal cost, real ops burden, nobody wants to run it |
| **Proved** | Compliance attestations derived from the audit hash chain | Only Agent Rails has the chain. Sold from a compliance budget, not an engineering budget |

Everything else in this document is a variation on those three, a financing mechanism, or a trap.

---

## 2. What the architecture forecloses — read this before designing any model

These are not preferences. They are decisions already made and recorded, and each one kills a class of revenue model.

| Decision | Source | Revenue models it kills |
|---|---|---|
| **Non-custodial; vault is a program-owned PDA; owner can always withdraw, even while paused** | ARCH §3, §5 | Float/interest income. Payment-processing spreads. Any "we hold it, we clip it" model. Also: you have **no leverage to enforce payment** — you can never withhold a customer's funds |
| **Zero external program dependencies** | ADR-001 | Revenue-share deals with other Solana protocols routed through the program |
| **Apache-2.0 on all code, no CLA** | ADR-011 §4 | Relicensing this repo later. Open-core *inside* this repo once outside contributions land |
| **Upgrade authority → `None` at 1.0.0** | ADR-011 §2 | **Any on-chain fee added after the freeze.** See §3 — this is the one with a deadline |
| **No hosted service, no dashboard in v1** | ARCH §1 non-goals | Nothing permanently; it sequences hosted revenue *after* v1 ships |
| **Agent surface has zero privilege-escalating tools** | ARCH §3, §10 | Upsell paths that run through the agent ("agent requests a limit increase, you charge for it") — `request_limit_increase` in v1.1 only emits an off-chain event by design |
| **Pause is a kill switch, not an owner lock; guardians cannot unpause** | ARCH §3 | A "we pause your treasury until you pay" enforcement model — structurally impossible, and good |

**One asset the architecture creates that nothing else in the market has:** every customer publishes, on-chain, in `MintLimit`, the maximum they are willing to lose — `long_window_max` and `lifetime_max` are a self-declared insured value, readable by anyone, denominated in USDC. That is a pricing metric handed to you by your own data model. §5.1 uses it.

---

## 3. The one irreversible decision: a protocol fee must be settled before the freeze

ADR-011 phases the program `0.x` → `1.0.0-beta` → `1.0.0` with upgrade authority set to `None`. **After that, no fee logic can ever be added to v1.** It would require a 2.x program id and `migrate_treasury` on every existing treasury — i.e. re-onboarding your entire installed base to take a tax. Nobody migrates for that.

So the fee question has a deadline, and it is the audit/freeze date.

**The tension, stated plainly.** An on-chain protocol fee needs a mutable global config (fee bps, fee destination) with an authority to set it. That authority is *exactly the super-owner that the freeze exists to eliminate.* You cannot ship both "Immutable. Verify with `solana program show`" and "we can change the fee." The alternatives are worse:

- **Hard-coded immutable fee + immutable destination in 1.0.0.** Honest and verifiable, but: it prices adoption at the exact moment you have none, it is trivially forked out (Apache-2.0, ~1 line), and it converts a security tool into a value-extraction tool in the README's first paragraph.
- **Fee fields reserved but inert.** The reserved byte blocks in every account (ARCH §5) let *data* land without migration, but frozen code cannot act on new data. Reserving fields buys you nothing post-freeze.

**Recommendation: no protocol fee in v1 — and write ADR-012 saying so, with this reasoning.** Immutability *is* the product. A frozen, fee-free, forkable program maximises adoption, and adoption is the only input to every model in §5. But the decision must be *made*, not defaulted into, because after the freeze it stops being a decision.

If you want to preserve optionality: the honest version is a fee on **2.x**, introduced openly as the price of the next feature generation, with 1.x remaining free and supported forever. That is a real strategy and costs nothing to keep open today.

---

## 4. The second irreversible decision: where enterprise code lives

ADR-011 chose **Apache-2.0, DCO, no CLA**. Today you are the sole contributor, so you own everything and could relicense at will. **The moment a third party's PR merges, that ends** — no CLA means no right to relicense their contribution, and this repo is Apache-2.0 forever.

That is fine, and probably correct for a security-critical program. But it means: **if there will ever be a commercial edition, it must live in a separate repository from day one**, under a separate license, importing `@agent-rails/*` as a dependency. Retrofitting is impossible.

Concretely, the split that preserves both the trust story and the business:

```
agent-rails/            Apache-2.0, forever, no exceptions
  program, policy crate, client, sdk, mcp, contract, cli, adapters, indexer core
    → this is the thing people audit, fork, and trust

agent-rails-cloud/      proprietary or BUSL-1.1, separate repo, private or source-available
  guardian service, hosted indexer + console, compliance exports,
  managed signer, SSO/RBAC, policy packs
    → this is the thing people pay for
```

Nothing proprietary should ever be in the payment path or the enforcement path. The dividing line is: *if it can refuse a payment, it is Apache-2.0.*

**Action, cheap, today:** decide this before accepting the first external PR, and note it in `GOVERNANCE.md` (already planned, not yet written).

---

## 5. Revenue options, ranked

Ranked by (fit with the architecture) × (defensibility) ÷ (effort for a solo maintainer).

### 5.1 ★ Guardian-as-a-Service — the strongest fit

**What it is.** The customer adds your pubkey to one of their five guardian slots. You run monitoring against their treasury's event stream and call `pause` when something looks wrong: spend velocity spiking toward `short_window_max`, a burst of denials, a session paying a never-before-seen destination, an agent hitting `per_tx_max` repeatedly, activity outside declared business hours.

**Why it is the strongest idea in this document.** Security services have a trust problem: to protect you, I need access, and access is risk. Agent Rails has already solved that problem *in the program*. A guardian:

- can call exactly one instruction: `pause`
- cannot unpause — only the owner clears it (ARCH §3)
- cannot withdraw, cannot configure, cannot touch a policy or a session
- can be removed by the owner at any time, unilaterally, with no cooperation from you

So the worst thing a fully compromised Agent Rails guardian service can do to a customer is **turn their agent off**. That is a sales conversation almost nobody in security gets to have, and it is *checkable on-chain in ten seconds*, not asserted in a trust-centre PDF.

**How to price it.** This is where §2's last line pays off. The customer has already written `long_window_max` and `lifetime_max` into their policy — a public, on-chain, USDC-denominated statement of the maximum they are willing to lose. Price as a percentage of protected ceiling, with a floor:

- Free tier: 1 treasury, best-effort, community alerting only, no SLA
- Paid: monthly, scaled in bands by the treasury's aggregate `long_window_max` across configured mints
- Enterprise: custom rules, private RPC, response-time SLA, dedicated guardian keys per environment

Anchor for the bands: Gate402's comparable tiers sit at $29 / $99 / custom. An anomaly-detection service on a treasury with a $50k/day ceiling supports a materially higher number than one on a $500/day ceiling, and the ceiling is right there in the account.

**Effort.** Moderate and *reusing work you already owe*: the event stream, `verifyChain`, and the alerting hooks are all `@agent-rails/indexer`, which is on the v1 plan anyway. The service is a rules engine plus a hot key plus a pager.

**Risks.** (a) False-positive pauses are a production outage for the customer — the SLA must be about *detection*, never about "we will not pause you wrongly"; give customers a dry-run mode that alerts without pausing, and make dry-run the default. (b) A pause-happy guardian is a DoS vector; rate-limit yourself. (c) You are holding a hot key with a real (if bounded) capability — treat it with the same discipline the docs demand of customers.

**Horizon extension.** Once you have loss-prevention data across many treasuries, "guardian + underwriting" becomes conceivable — but insurance is regulated, capital-intensive, and years out. Note it; do not build toward it now.

### 5.2 ★ Hosted indexer + console

**What it is.** `@agent-rails/indexer` is specified as pluggable `EventSource` (polling, Yellowstone) → `Sink` (SQLite, Postgres) with `verifyChain`. Ship that Apache-2.0 so anyone can self-host, and sell the hosted one: managed ingestion, history retention beyond what gPA can answer, `list_payments` / `get_payment_status` backing for MCP, a read-only console, alerting, CSV/JSON export.

**Why it fits.** Three reasons. (1) Real marginal cost — Yellowstone/Geyser access and retention are genuinely expensive, which makes a price defensible rather than rent-seeking. (2) Zero custody risk: it reads public chain data. (3) The MCP contract already degrades gracefully without it — `list_payments` "degrades to unavailable" (ARCH §10) — so the free path stays honest and the paid path is a real upgrade rather than a hostage situation.

**Why it is second, not first.** It is closer to a commodity. Helius, Triton and friends sell indexing; your differentiation is only that yours understands `AgentRailsEvent` and can run `verifyChain`. Real, but thinner than §5.1's.

**Sequencing note:** build the indexer core *once*, Apache-2.0, and let it serve §5.1, §5.2 and §5.3. It is the shared substrate under all three products.

### 5.3 ★ Compliance & assurance exports

**What it is.** Turn `audit_head` into an artifact a finance or audit function will pay for: a periodic, signed, independently verifiable statement that *every payment this agent made in Q3 was inside the stated policy, and here is the hash chain proving none were omitted.*

**Why only you can sell it.** The per-session chain (`seq`, `audit_head = sha256(DOMAIN ‖ prev_head ‖ seq ‖ intent_id ‖ mint ‖ destination_owner ‖ amount ‖ slot)`, ADR-006) makes *omission* detectable, not just alteration. A competitor with off-chain logs can prove records weren't edited; they cannot prove none were deleted. That distinction is the whole value of an audit artifact, and it is a direct consequence of a design decision already shipped.

**What to sell.** Scheduled attestation reports; retention past on-chain practicality; a third-party verifier tool (Apache-2.0 — give the verifier away, it *increases* the value of the attestation); destination-screening evidence (§5.4) attached to each period; export formats an auditor recognises.

**Buyer.** Not the developer. Finance, risk, or compliance — a different budget, a much higher willingness to pay, and a renewal driven by the audit calendar rather than by engineering enthusiasm.

**Prerequisite.** This only sells to companies large enough to have an audit function, which means it is gated on enterprise adoption. Design for it now (the chain already supports it); sell it in year two.

### 5.4 Policy packs & destination screening — subscription content

**What it is.** The SDK's `PolicyHook` interface (ARCH §6) is an extension point with nothing shipped in it. Fill it with *maintained data*, which is the only kind of software that legitimately recurs:

- Sanctioned / high-risk destination address lists, updated continuously
- Known-scam and drainer address feeds
- Mint risk classification (honeypots, freeze-authority live, extension surprises)
- Curated Cedar/OPA rule packs for common shapes: business-hours-only, per-vendor budgets, invoice-matched payments

**Why it works.** The hook interface is free and open; the *feed* is a subscription. That is the ClamAV/VirusTotal, Snyk, and Semgrep-registry pattern, and it survives forking — a fork gets the code, not the updates.

**Caveat that must be in the docs.** Soft policies are explicitly *not the guarantee* (ARCH §6). A screening subscription must never be marketed as if it were enforcement, and must adopt the four-state result (`match / possible / no_match / **unavailable**`) so a feed outage cannot read as "allowed". This is the same point as §9.4 of the Gate402 comparison.

### 5.5 Managed signer / relayer

**What it is.** Two related services the architecture already anticipates:

- **RemoteSigner-as-a-service.** ARCH §9 ships a generic `RemoteSigner` (HTTP signing endpoint) in v1. Hosting one — HSM-backed session keys, key rotation, per-environment separation, audit logs of signature requests — is a product.
- **Relayer** (v1.1). In signed-intent mode the agent signs the intent off-chain and a relayer submits `[Ed25519Program.verify, execute_payment]`. `fee_payer` is already a separate account from `session_key` specifically so sponsorship works (ARCH §9). Charge for gas sponsorship plus margin, metered per transaction.

**Assessment.** Legitimate but crowded. Turnkey, Privy, Dfns and Fireblocks already sell managed signing, and ARCH §9 deliberately made any Kit-compatible signer work "without glue" — which is right for users and means you are competing on their turf with none of their compliance apparatus. The relayer is the better half: it is small, it is metered, it has an obvious unit cost, and nobody else will bother building one that understands `PaymentIntent`.

**Recommendation:** skip managed signing; ship the relayer when v1.1 lands, priced as gas + margin.

### 5.6 Grants and ecosystem funding — the correct *first* move

ADR-011 already budgets the professional audit at **$30–80k** and names "Solana Foundation / Superteam grants" as the funding path. This is not a footnote; for a six-day-old solo project it is the highest-expected-value action in this entire document.

Why it dominates right now:
- **Non-dilutive**, and requires no customers, no product-market fit, and no hosted infrastructure.
- It funds the audit, and **the audit is the precondition for every other model here** — nobody routes real treasury through an unaudited program, so §5.1–§5.5 are all gated on it.
- The work is already grant-shaped: a public good, Apache-2.0, on Solana, with an unusually rigorous test and governance story (ADR-008, ADR-011) that grant committees reward and most applicants cannot show.
- Superteam Brazil is a natural fit and appears in Gate402's own assets, suggesting the local ecosystem is active and reachable.

**What makes the application strong, in order:** a working devnet deployment; the ADR set (this is your differentiator — almost no grant applicant has eleven accepted ADRs); the test pyramid; a named audit firm and quote; and a clear statement that the program will be frozen and fee-free. Green CI would help; you currently have none (see the Gate402 comparison §5.4) and that is the cheapest credibility you can buy.

### 5.7 Enterprise: deployment, integration, support

Retainers for integration, custom adapters, policy design review, private Slack, response SLAs. High margin, immediate cash, no infrastructure.

**The honest problem:** it does not scale past your own hours, and at one contributor every hour sold is an hour not spent shipping v1 — which delays §5.1–§5.5 and the grant. Treat consulting as **opportunistic, capped, and strategic**: take engagements that produce a reference customer or a reusable adapter, decline the rest. A "design partner" arrangement — discounted or free integration in exchange for a public case study and detailed feedback — is usually worth more than the fee at this stage.

### 5.8 Distribution plays that are not directly revenue

Worth naming because they are the *input* to everything above:

- **The x402 adapter** (Gate402 comparison §9.8). Making Agent Rails the policy layer under the x402 ecosystem is a distribution move, not a revenue move — but every treasury it brings is a §5.1 and §5.2 prospect.
- **`npx agent-rails init`.** Already ADR'd (ADR-009): bootstraps devnet treasury, policy, allowlist, session, funds the vault, writes the MCP config, "under five minutes to the first guarded payment." Time-to-first-payment is the top of every funnel here. *(Note: this supersedes §9.2 of the Gate402 comparison — the scaffolder is already planned, not a gap.)*
- **Framework adapters** (LangChain, AI SDK, OpenAI Agents) and the PyPI package. Listed in each framework's tool directory, these are free distribution.

### 5.9 Strategic / acquisition

Worth stating plainly because it changes what you optimise for: the most probable large outcome for a non-custodial agent-spend-control primitive is **acquisition by an adjacent player** — Squads, Turnkey, Privy, Dfns, a wallet, or a treasury-management platform. Every one of them has customers asking "how do I let an AI agent spend without handing it the keys" and none has a clean answer.

What raises that value is *not* revenue: it is adoption, an audit, a frozen program, and clean Apache-2.0 provenance with no license ambiguity. Which is the same list as everything else in this document. Optimise for the product; the option comes free.

---

## 6. What does not work, and why

| Idea | Why not |
|---|---|
| **Protocol fee on `execute_payment` (v1)** | Irreconcilable with the frozen-immutable claim; forkable in one line; taxes adoption you don't have. See §3 |
| **Taking custody / earning float** | Destroys the single differentiating claim. Not a tradeoff — a category error |
| **Token** | No sink. There is no fee to distribute, no staking role a guardian key doesn't already fill better, and no governance decision left once the program is frozen. It would add a regulated liability and a permanent distraction to a security product whose entire pitch is "verify it yourself." If capital is needed, §5.6 first, equity second |
| **Gating the MCP tools or the SDK** | The agent surface is the adoption surface. Gating it kills the funnel to every model in §5 |
| **Charging for the audit chain verifier** | Give `verifyChain` away. An attestation nobody can independently verify is worth less, not more — the free verifier is what makes §5.3 sellable |
| **Withholding funds for non-payment** | Structurally impossible (owner withdrawal always works, even while paused) and would be a betrayal of the design if it weren't |
| **Open-core inside this repo** | Apache-2.0 + no CLA. See §4 — it must be a separate repo, decided before the first external PR |
| **A hosted dashboard in v1** | Explicit non-goal (ARCH §1). Correct — it delays the audit, and the audit gates all revenue |

---

## 7. Sequencing for a solo maintainer

Six days in, one contributor, program complete, SDK/MCP mid-build, no CI, no audit, no users. The binding constraint is your time, and the ordering is not negotiable:

**Phase 0 — now → v1 (no revenue, all leverage).**
Finish SDK + MCP. Land CI. Write `THREAT_MODEL.md`, `SECURITY.md`, `GOVERNANCE.md` (all planned, none written — and all three are grant and audit prerequisites). Deploy to devnet. Decide and record **ADR-012: no protocol fee in v1** (§3) and the **enterprise-repo split** (§4) — both are cheap now and impossible later.

**Phase 1 — grant + audit (§5.6).**
Apply with the devnet deployment, the ADR set, green CI and an audit quote. This funds the freeze. Nothing else can start in earnest until the program is audited, because nobody puts a real treasury behind unaudited code.

**Phase 2 — first paid product (§5.1 + §5.2).**
Ship `@agent-rails/indexer` Apache-2.0, then build the hosted indexer and Guardian-as-a-Service on top of it in the separate repo. One shared substrate, two products. Guardian is the differentiated one; the indexer is the one that makes it possible.

**Phase 3 — expand (§5.4, §5.5, §5.3).**
Policy/screening feeds once there are enough treasuries to justify maintaining a list. The relayer with v1.1's signed-intent mode. Compliance exports when the first customer with an audit function appears — and they will ask for it before you offer it.

Throughout: take consulting only where it creates a reference customer or a reusable adapter (§5.7).

---

## 8. Open questions only you can answer

These change the recommendations materially, and I have assumed answers where I had to:

1. **Is this a company or a public good?** I have assumed "public good that funds itself, with an option on a company." If it is a venture-backed company, §3's fee answer is worth re-litigating *before* the freeze — and the answer is still probably no, but it deserves an argument rather than a default.
2. **Will you accept outside contributions?** If yes, §4 becomes urgent — the enterprise-repo split must be decided before the first merge.
3. **Who is the first user you actually want?** A solo dev wiring Claude to a devnet wallet and a fintech giving an agent a $50k/day mandate need different products, different docs, and different prices. §5.1's pricing assumes the latter exists; §5.8's funnel assumes the former is how you find them.
4. **How much of your time is sellable?** §5.7 is the fastest cash and the slowest strategy. The right cap is a number, not a vibe.
