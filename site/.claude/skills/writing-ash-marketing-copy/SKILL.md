---
name: writing-ash-marketing-copy
description: Use when writing or revising any marketing copy for Ash — the site, a deck, a one-pager, an email — aimed at operators running agents, finance/compliance buyers, venture builders or funds evaluating Ash itself.
---

# Writing Ash marketing copy

## Overview

Senior B2B/institutional copywriting for Ash: confident and specific enough to be memorable,
never hungry. It blends the confirmed public core of André Diamand's **Sexy Canvas** (emotional
triggers, used sparingly) with plain technical-credibility copywriting, under one hard rule: read
like a serious long-term operator a fund would back, not like a pitch trying too hard to be liked.

## The frame: sell the yes, not the loss

Nobody hires a product to decide how much they can lose. What Ash sells is the permission to
say **yes** to an agent handling real money — autonomy for the agent, authority for the owner.
Risk is the *motive* (it goes below the promise, as the reason), never the promise itself.
The founder rejected "Your agent pays. You decide how much it can lose." on 2026-09-30 for
exactly this reason; the agent-rails briefing's category line ("how much they can lose") is
internal positioning, not site copy.

- **Headline (founder's choice, 2026-10-02):** "Unleash your agents on Solana. Full autonomy, on
  your terms." / "Solte seus agentes na Solana. Autonomia total, nos seus termos." **Tagline:**
  "Turn prompts into payments." / "Transforme prompts em pagamentos." The founder retired "Give
  your agents a budget. Never the keys." that day: a headline that opens with freedom and then
  pulls the brake reads as a leash. Lead with what the agent can now do; safety is implied by
  design, stated in the mechanism below, never shouted.
- **Category (eyebrow):** "Spend authority for AI agents" — the phrase the repo's own templates use.
- **Who it is for, in order:** (1) people building agents on Solana (MCP, Vercel AI SDK) whose
  agent should pay and who today choose between a funded key in an env file and a human approving
  each payment; (2) small web3 teams and DAOs paying bounties, refunds and micro-grants by hand;
  (3) DeFi desks running agents — a mandate that is **not built** (the program does not trade).
  Not enterprise finance or compliance today.
- **Spine — every piece is organized around these three, each carrying its differentiators:**
  1. *Agents that pay* — the agent pays on its own, seven agent tools and none withdraws or raises
     a limit, a retry is refused while its receipt exists (at least an hour), plugs into MCP /
     Vercel AI SDK / SOL + SPL.
  2. *Rules that hold* — no policy exceeds the owner's ceiling and no agent changes its own
     policy, several limits + allowlists at once per agent session and per token, a pause key
     for the whole vault, owner always withdraws alone, rules on-chain not on our servers.
  3. *A record on-chain* — a hash chain whose head lives on-chain, 13 Kani proofs over the policy
     core, decision records. Not "proof anyone can check": that waits for an indexer and a
     verifier a visitor can run.

A sentence that leads with loss, fear or "worst case" belongs in the problem section or nowhere.

## What the code does not let us say (checked 2026-10-01, agent-rails at 2bbe70d)

- "One budget per vault" — limits live in each agent session; there is no vault-wide total.
- "The guardian pauses an agent" — pause stops the whole vault; one agent is stopped by revoking
  its session (owner or operator).
- "Never pays twice", "anyone can verify" — both depend on receipts anyone can close after about
  an hour.
- "Open protocol", a GitHub link, a demo command — the repository is private. "Apache-2.0
  licensed" is true.
- "Zero fees, never a toll" — say "no protocol fee today".
- "The layer above x402" — there is no x402 integration.
- Swaps or trading — the program pays destinations; it does not trade.
- A test count, market forecasts for 2030, other companies' revenue as our market size.
- On native allowances: we use them (ADR-014, the vault is the delegate). Never "instead of".

## The tone contract

The founder's own framing: **sexy, not a puta; mulher pra casar** — magnetic through substance,
never through neediness. In practice:

| Instead of | Do this |
|---|---|
| Superlatives ("revolutionary," "game-changing," "the best") | A real number, or say nothing |
| Exclamation points, urgency, countdowns, "limited spots" | A plain declarative sentence |
| Vague confidence ("trusted by leading teams") | A named, checkable fact ("13 Kani proofs," a program address) |
| Apologizing for being early (0.x, devnet) | Stating it flat, once, in `warning` not `deny` |
| Chasing every reader with the same pitch | One register per door — see Audiences |
| A claim no one asked to verify | A claim with a link, a command, or a reason code next to it |

Confidence reads as *withheld* intensity: the copy could say more and doesn't. If a sentence would
embarrass the founder read aloud to the person who built the on-chain program, cut it.

## Audiences — one voice, four doors

1. **Operators running agents today** — speak in mechanisms: roles, checks, reason codes. They
   convert on precision.
2. **Finance / risk / compliance** — speak in controls and audit language: attestation, retention,
   "nothing omitted." They convert on liability reduction, not excitement.
3. **Capital allocators (the Mandate line, not yet shipped)** — speak in envelopes and floors, never
   in returns. Never imply a yield or a trading edge.
4. **Venture builders and funds evaluating Ash itself** — this is new territory for the site
   (2026-09-29): they read the same product copy as everyone else, but they're also silently
   scoring the *company* — is this team rigorous, is the category real, is this a founder who
   overclaims? Never write a separate "for investors" section; let the same restraint that works on
   operators do the work here. The tell they're trained to catch is hype-to-substance ratio — keep
   it near zero.

## The Sexy Canvas layer (confirmed subset, not the full course)

Public sources describe ~13 of Diamand's emotional triggers, split shadow/light. Treat this as a
palette to draw one note from per section, not a checklist to fill:

**Shadow (use edge-of-frame, never centered):** ganância, ira, vaidade/soberba, luxúria, gula,
preguiça, inveja. On this brand: `ganância` becomes "what it costs you *not* to have proof" (the
opportunity-cost framing already in the objection table), `vaidade` becomes precision as status
("we say the compute-unit number, not just 'fast'"). **Banned outright here:** ira directed at a
reader or competitor (contempt reads as insecure), luxúria/gula in any literal sense.

**Light:** diversão, liberdade, pertencimento, curiosidade, amor, segurança, recompensa. These carry
most of the brand: `segurança` (the actual product), `curiosidade` (the hero scene inviting a drag,
a reason code the reader hasn't seen before), `pertencimento` (the corporate-card analogy — everyone
knows this shape from a real card), `recompensa` (proof over promises — the reward is verifiability
itself, never a bonus or a discount).

**Unverified — do not invent:** the remaining ~1–4 triggers various sources gesture at without
naming. If a real Sexy Canvas source turns up later, extend this table; don't backfill with a guess.

## Craft rules

- Active voice, present tense, second person for the reader, third person for the product.
- A number beats an adjective. A reason code, an address, a command beats a claim.
- One idea per sentence. Cut the sentence that only restates the one before it.
- Machine strings (`EXCEEDS_PER_TX_MAX`, `agent_rails_execute_payment`) appear verbatim in code
  font, never paraphrased.
- No filler ("cutting-edge," "seamless," "powerful," "unlock"). If it could appear on any SaaS
  homepage unchanged, it's filler.
- The devnet/unaudited status is stated once, early, flatly — hiding it reads as more dishonest
  to this audience than the status itself.
- Never a price, never "non-custodial," never a promise of audit or a return (standing rules,
  `CLAUDE.md`).

## Before rewriting anything, reread

- `docs/design-system.md` (this repo) — voice foundations already agreed.
- The agent-rails repo's `docs/strategy/briefing-negocio.md` — the category phrase, the four roles,
  the honest objection ("why not native Allowances"), what's explicitly not promised.
- `src/content/copy.en.ts` / `copy.pt.ts` (this repo) — current copy; the English file is source,
  Portuguese is a full translation, kept in parity by `pnpm test`.
- Anything in `algumacoisa-agentica`'s product docs only for backstory/vision facts a
  venture-builder reader might probe — never invent a traction number; the reference agent's
  numbers are explicitly `TODO(refresh)` until verified on-chain.

## Common mistakes

- Writing a punchier version of a claim instead of finding the real number that would make it true.
- Adding a trigger from the table because it's clever, not because the section needs it — most
  sentences need zero.
- Softening the devnet/unaudited line to sound more finished. It's a caveat, not a confession;
  state it and move on.
- A separate "Investors" page or section. There isn't one — see Audiences §4.
