# Colosseum form — pre-hackathon development (copy/paste)

Use this in the Colosseum **pre-existing work** field. The hackathon judging window is
**2026-09-14 through 2026-10-12**; undeclared prior work is a disqualification risk.

## Summary (short)

Before 14 September 2026 we had **8 commits** on `main` establishing the on-chain program
(22 instructions, LiteSVM integration tests), the `ash-policy` crate, the checked-in
IDL, and the first TypeScript workspace (Codama client, SDK payment builders, MCP stdio server
with `execute_payment`). Everything after 14 September is hackathon-window work: dashboard,
operator CLI beyond `init`, audit export, adapters, alert webhooks, demo scripts, and docs.

## Detailed declaration (long)

**Repositories:** `wayside-labs/ash` (monorepo).

**Pre-window commits (8, all before 2026-09-14 UTC):**

1. `a85c1a7` — Policy arithmetic crate, Anchor account layouts, LiteSVM harness.
2. `14f4d53` — Anchor program surface (22 instructions), emergency controls, 150 integration tests.
3. `3b6e527` — TypeScript workspace scaffolding and IDL extraction tooling.
4. `c348d51` — Turborepo layout, Codama-generated client from committed IDL.
5. `cebd9c8` — SDK payment builders and simulation preflight.
6. `d581155` — MCP stdio server with `execute_payment` and JSON schemas.
7. `7875e96` — MCP read tools: `get_session`, `get_policy`, `check_payment`.
8. `95ec615` — SDK `executePayment` signing and broadcast path.

**What was not built before the window:** hosted dashboard tenancy, Supabase auth, operator
CLI commands (`pay`, `policy set`, `pause`, `audit export`, …), Vercel AI adapter, alert
webhooks, `scripts/demo.sh`, reference-agent traction loop, Playwright UI suite, and Colosseum
demo polish.

**License:** Apache-2.0. **Networks:** devnet only for the submission; mainnet is post-trust-phase.

**Team confirmation:** every member registered on Colosseum with Brazil as location; Earn
submission links the Colosseum project URL (see `docs/strategy/colosseum-plano-execucao.md`).
