# ADR-021: Operator surfaces — CLI and dashboard, never MCP

**Status:** Accepted

## Context

ADR-007 drew a line between the agent-facing MCP tool contract and everything an operator
does: *"Absent by design: `create_session`, `update_policy`, `withdraw`, … Operator actions
live in the CLI."* That was correct about MCP. It was never meant to forbid a second human
operator surface.

`packages/dashboard` was built as a local read-mostly UI and grew: real RPC reads, owner
deposit/withdraw in the browser, hosted tenancy (ADR-017), and in-browser wallet generation
(ADR-018). Meanwhile `packages/cli/CLAUDE.md` and
`packages/dashboard/src/lib/server/privileged-surface.test.ts` still describe the dashboard
as the operator surface's *read half plus withdraw*, with every other privileged instruction
belonging to the CLI alone.

That framing no longer matches the product direction. The dashboard is the chat-first surface
for people who do not want a terminal. The CLI is the scriptable, automatable surface for the
same roles. Both are operator surfaces; MCP is not.

Three constraints still hold:

**MCP must not escalate.** A prompt-injected agent cannot call `create_session`,
`update_policy`, or `withdraw` through any transport. ADR-007's tool contract is unchanged.

**Loosening flows downhill only.** Owner ceilings, operator policy, agent sessions — the same
program invariants apply whether the human uses a browser or a terminal.

**Session keys are client-held.** ADR-017 and ADR-018 forbid persisting private key material
on the server. A dashboard that creates a session must generate the session keypair in the
browser, have the operator sign `create_session`, and hand the key to the user (download +
MCP snippet) — the same outcome as `agent-rails session create`, not custody in Postgres.

## Options considered

**A. CLI only for privileged writes.** Smallest change; leaves the dashboard unable to close
the agent lifecycle without a terminal. Acceptable for power users, hostile to the Colosseum
demo and to the hosted product pitch.

**B. Dashboard read + import only.** Sync on-chain `AgentSession` accounts into the store
without ever submitting `create_session` from the browser. Honest but still forces a terminal
step for every new agent; the UI continues to lie by omission when users click "Novo agente".

**C. Two operator surfaces with a shared contract; MCP unchanged.** CLI and dashboard may both
reach privileged instructions the program allows for the connected wallet's role. MCP never
may. Privileged builders are allowlisted per package (`privileged-surface.test.ts` in the
dashboard; the MCP package has its own tool-surface gate). Implementation rolls out in waves;
wave 1 is session lifecycle only.

**D. Dashboard does everything, deprecate CLI.** Wrong trade. CI, smoke scripts, and operators
who want reproducible automation need a non-browser surface. The CLI is not legacy.

## Decision

Option C.

**The privilege split is MCP versus operator surfaces, not CLI versus dashboard.** Read ADR-007
line 25 as: operator actions live in the CLI and the dashboard, never in MCP.

**Wave 1 (before dashboard PRs merge for Colosseum):**

1. **Import/sync** — when a workflow has `treasuryAddress`, on-chain sessions appear in agent
   cards; the store may link or materialize rows with `sessionAddress` and `walletAddress`
   (public keys only). Name matching is a fallback, not the primary link.
2. **`create_session` in the dashboard** — operator or owner connects a wallet; the browser
   generates the session keypair; the server builds an unsigned transaction; the wallet signs;
   confirm via the existing `/api/solana/confirm` pattern used for vault transfer.
3. **Key delivery** — after confirmation, offer download of the session keypair file and a
   copyable MCP config snippet. The private key never enters `dashboard.json`, Supabase, or
   server logs.
4. **Guards** — no treasury on the workflow → block with CLI hint; wallet not operator/owner →
   block; session key must not be owner/operator/guardian (same checks as CLI).

**Explicitly deferred past 2026-10-10 (wave 2+):** full `init` bootstrap wizard, policy editor,
allowlist editor, pause/unpause, ceiling and guardian management. For demos, `pnpm agent-rails
init` once in the terminal and daily operation in the dashboard is acceptable if narrated.

**CLI remains.** It is the automation API of the same product: CI, runbooks, operators who
prefer scripts. Dashboard and CLI should share transaction builders (`packages/sdk` or
`packages/cli/src/tx/*` imported by the dashboard server routes), not duplicate policy
arithmetic.

**Mechanical enforcement:** `privileged-surface.test.ts` moves from a single allowed
`withdraw` to an explicit allowlist that includes session create (wave 1) and grows only with
a deliberate edit and an ADR or amendment when a new operator action ships in the dashboard.

## Consequences

- ADR-007's MCP tool list is unchanged. Agents still cannot loosen their own constraints.
- The dashboard becomes a first-class operator surface, not an exception to a CLI-only rule.
- Wave 1 implementation must land before merging dashboard UX PRs that imply agents are
  on-chain when created in the UI.
- Session key loss is operator error, same as deleting a CLI keypair file; the UI must say so.
- Bootstrap-from-zero in the browser waits for wave 2; until then the handoff and README keep
  pointing at `agent-rails init` for treasury creation.
- Future operator actions (policy set, revoke session, allowlist) follow the same pattern:
  allowlist in `privileged-surface.test.ts`, role gate on-chain, no MCP exposure.
