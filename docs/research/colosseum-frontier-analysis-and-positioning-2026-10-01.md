# Frontier comparison, rhetoric and brand positioning (Colosseum Copilot)

**Date:** 2026-10-01 · **Target:** Crypto World's Fair, submissions due 2026-10-13 06:59 UTC
**Method:** Colosseum Copilot (all 144 Frontier projects whose main category is `agent-control-plane`, all 28 Frontier winners, 16 honorable mentions, category/label analytics, archive search), Colosseum blog posts, Solana Foundation pages, repo ADRs.
**Not a submission text.** Judges read submission fields as the team's own words; use this as input, not copy.

## 0. Correction that frames everything

Agent Rails does not compete with Solana's Subscriptions & Allowances program, it uses it. ADR-014 (`FundingMode::NativeAllowance`) makes the **Treasury PDA** the delegatee, and `tests/native_allowance.rs` runs against the real deployed binary, including `session_key_cannot_pull_via_the_native_program_directly`.

The [Chainstack agent-budget tutorial](https://docs.chainstack.com/docs/solana-agent-allowances-x402) does the opposite: the delegatee is the agent's own wallet and the agent signs `transferFixed`. That gives the native cap but lets the agent skip any policy placed in front of it. ADR-014 names this as the load-bearing property. It is the strongest "Insight" (a judging criterion) the project has.

## 1. Frontier in numbers (Colosseum Copilot data; Frontier started 2026-04-06)

| | Count |
|---|---|
| Frontier projects | 2,858 |
| Winners / honorable mentions | 28 / 16 (44 awarded, about 1.5%) |
| Main category `agent-control-plane` ("Agent wallets, spend limits & trust") | 144 (5.0%), third-largest bucket |
| Winners with that main category | 0 |
| Awards touching the bucket | 1 honorable mention: [riven](https://colosseum.com/projects/explore/riven) |

- Zero wins is **not strong evidence on its own**: at the overall win rate, 144 projects would yield about 1.4 winners, and zero happens about 24% of the time by chance.
- The self-chosen label "AI Platforms / Agents" was the largest (493 projects) but won 2 of 28 slots (about 0.4%). Consumer Apps went 8 of 438, FinTech 3 of 86, RWA 3 of 98.
- The two agent-label winners were not spend caps: [Clawpump](https://colosseum.com/projects/explore/clawpump) (claims $65M volume, about $650K revenue; team claims, unverified) and [Flovia](https://colosseum.com/projects/explore/flovia) (analytics for API providers taking agent payments).
- Across all hackathons, awarded projects touching the bucket: Mercantill (4th, Stablecoins, $10k, Cypherpunk), Latinum (1st, AI, $25k, Breakout), Sudont (Frontier winner, main category `onchain-security`), riven (Frontier honorable mention, not a win).

## 2. Cluster vs winners

| | 144 control-plane projects | 28 winners |
|---|---|---|
| Solo teams | 73% | 29% |
| Teams of 3+ | 9% | 29% |
| At least one hackathon update posted | 18% | 46% |
| Numeric traction claim | about 15 of 144 | n/a |

Correlation, not proof. Genuine traction in the cluster is rare: [Kyvern](https://colosseum.com/projects/explore/kyvern) (reference agent on devnet 20+ days, 1,591 merchants paid, 3,700+ attacks refused), a project claiming five design partners, [Enclz](https://colosseum.com/projects/explore/enclz) still seeking design partners and an audit.

## 3. Feature scan of the 144 (keyword matches on Copilot repo summaries; indicative only)

| Mentioned | Share |
|---|---|
| On-chain policy / limits | 49% |
| Allowlist | 37% |
| Pause / kill switch | 38% |
| x402 | 38% |
| MCP | 29% |
| Audit trail / log | 35% |
| Replay / idempotency | 27% |
| Owner/operator/guardian-style roles | 5% |
| Formal verification / fuzzing | 3 projects |
| Solana's native Subscriptions & Allowances | 0 |

- Only 7 projects mention audit + idempotency + MCP together; the single one that also hits roles is an EVM tool. The combination is rare but built from common parts.
- Formal verification is not exclusive: [AgentTrust](https://colosseum.com/projects/explore/agenttrust) claims six Kani invariants, three Anchor programs and an MCP server. The edge is breadth (policy crate, mutation testing, CU gates, layout snapshots, tests against the real native binary).
- Zero native-primitive use is partly timing: Frontier started in April, Solana announced Allowances on [2 June 2026](https://solana.com/news/subscriptions-and-allowances). Crypto World's Fair is the first hackathon where this integration was possible.

## 4. Language already taken in this cluster

- [Bottie](https://colosseum.com/projects/explore/bottie): "Agents with limits."
- Kyvern: "Agents shouldn't hold keys. They should have budgets."
- [AgentVault](https://colosseum.com/projects/explore/agentvault-2): "how do you stop an agent from over-paying", positioned against what x402, MPP and AP2 "forgot to build". Close to the internal line "everyone solves how agents pay, nobody solves how much they can lose".
- [AgentWallet](https://colosseum.com/projects/explore/agentwallet): "Brex/Ramp-style spend controls", close to the corporate-card metaphor.
- A Frontier project named [Agent Guardrails](https://colosseum.com/projects/explore/agent-guardrails) contains "Rails" inside its name.

## 5. Vocabulary map (Copilot summaries, directional)

| Word family | Cluster | Winners |
|---|---|---|
| limit, budget, cap, spend | 68% | 11% |
| guardrail, firewall, guard, safe, secure | 37% | 4% |
| Names a human buyer | 6% | 29% |
| layer / protocol / infrastructure / framework / platform | 85% | 86% |

Winners used the same abstract nouns but named a person, a job and a number: StableCorp ("remote founders earning in stablecoins"), Flovia ("API providers on x402 / MPP"), Zoneless ("drop-in replacement for Stripe Connect… ~$0.002 per payout vs $2+").

## 6. Brand positioning

1. **Category:** avoid "wallet", "firewall", "guardrails". Test aloud: agent treasury controls, or spend control for organizations running many agents. Pick one noun and keep it.
2. **Promise:** verifiability. The pt-BR rhetoric file already has it ("você não precisa confiar em nós"). No cluster project makes it the headline.
3. **Ecosystem stance:** the control layer on top of Solana's own primitives (Allowances, x402). Do **not** claim Payment Channels support; the repo does not have it. The Foundation's [Payment Channels](https://solana.com/payment-channels) shipped in September.
4. **Positioning sentence to adapt:** *For [named buyer] running [situation], Agent Rails is [category] that [one provable benefit]. Unlike [wallet-with-a-cap / off-chain gateway / the native cap alone], [your insight].*
5. **Name:** 25% of cluster names contain "agent" (36 of 144) vs 0 of 28 winners (correlation only). Do not rename 12 days out. Lean into "payment rails", always write the full name beside one proof-phrase, and never use "guardrails" in your own copy.

## 7. 3-minute pitch video, beat by beat

Colosseum's [guidance](https://blog.colosseum.com/how-to-win-a-colosseum-hackathon/) asks for team, product, why you built it, market, initial usage and a demo, and says a clear narrative beats polish ([workshop notes](https://blog.colosseum.com/perfecting-your-hackathon-submission/)).

| Beat | Job | Move |
|---|---|---|
| 0:00–0:20 | Stake | Open with a scene or a loss, not a definition |
| 0:20–0:50 | Insight | The delegatee point: the official agent-budget pattern lets the agent bypass your policy |
| 0:50–1:40 | Proof | A refusal and the retry that does not double-pay, tx visible. Refusal is the hero moment |
| 1:40–2:10 | Buyer and market | One named buyer and the cost of the problem |
| 2:10–2:40 | Momentum and honesty | What exists, what is devnet, any real feedback or design-partner contact |
| 2:40–3:00 | Vision and close | One sentence of direction; restate the proof promise |

- The separate 2–3 minute technical demo is for the "how": Kani, mutation testing, CU gates, ADR-014, tests against the real native binary.
- Time-to-value: winners sell speed ("migrate in minutes"). `agent-rails init` supports a wall-clock demo from install to a capped agent that refuses a payment.
- Devices: contrast pairs ("the agent signs payments, never limits"), threes, one number.

## 8. Words to drop and own

- **Drop:** guardrails, firewall, limits, budget, vault, trust layer, autonomous.
- **Own:** refuses, can't, ceiling, verify, treasury, fleet, proof.
- Cut "we/our" and buzzwords. Colosseum's own mistakes list includes "relying on buzzwords" and "vague or overly technical descriptions".

## 9. Three hard questions (acknowledge, claim, evidence; 20 seconds each)

- **"Why not the native primitive?"** We use it. The cap alone lets the agent bypass any policy in front of it; here is the test that shows we don't.
- **"Why not the other 140 teams?"** Do not name or knock anyone. Point to what only you can show on screen.
- **"Who pays?"** One buyer, one pricing line.

## 10. Pre-record checklist

- First line is a stake, not a definition.
- A refused transaction is on screen before 1:00.
- One named buyer appears.
- "Guardrails", "firewall", "limits" are absent from your own copy.
- Nothing unshipped (indexer, adapters, Payment Channels support) is claimed.
- Team size, update cadence and any customer contact are visible; solo teams were 73% of the cluster.

## 11. Judging criteria and timing (official)

[Colosseum FAQ](https://colosseum.com/hackathon#h-faq-12): founder-market fit, insight, product and execution, market size, founder communication, viability, traction. After the deadline: multiple evaluation rounds, a shortlist to a judging panel, a 15-minute Zoom interview for a smaller group, winners roughly a month after the deadline. Deadline per Copilot: 2026-10-13 06:59 UTC (03:59 in Brasília).

## Limits

- Copilot covers Colosseum submissions only; rivals shipped elsewhere are invisible.
- Feature and vocabulary counts are keyword scans of model-written summaries, not code review.
- Live products and post-Frontier outcomes were not checked. A web check on Mercantill returned nothing, so its current status is unknown.
- No Crypto World's Fair entries are in the corpus yet, so how this field is judged is not visible.
- Team size and customer contact for Agent Rails were not provided and affect how the pitch should lead.
