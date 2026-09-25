# Contributing

Apache-2.0, DCO sign-off, no CLA (ADR-011).

## Before you write code

Read `ARCHITECTURE.md` for the design baseline and check `docs/adr/` for a decision that
already settled the question. ADRs are immutable: a change of mind is a new ADR, not an edit
to an old one. A pull request that re-litigates a settled decision in code comments will be
asked for the ADR instead.

## The gate

```bash
scripts/verify.sh          # everything CI runs, in the same order
scripts/verify.sh ui       # the dashboard's Playwright suite
scripts/verify.sh e2e      # surfpool, needs a built .so
```

`VERIFY_STRICT=1` turns a loud skip into a failure, which is what CI sets. A green local run
with a missing tool is not evidence.

Changes a consumer can observe carry a changeset: `pnpm changeset`.

## Zones an agent must not touch unsupervised

An LLM writing a pull request here is expected to stay out of the following, unless the task
explicitly assigns one of them and a human reviews the diff line by line. The rule is not
about capability; it is about where a plausible-looking mistake stops being reversible.

| Zone | Why |
|---|---|
| `programs/agent_rails/` | Custody. A wrong account constraint is a stolen vault, and the failure is silent until it is not. |
| `crates/agent-rails-policy/` | Every limit the product enforces is arithmetic here. `#![forbid(unsafe_code)]` and `checked_*` are load-bearing, and the Kani proofs only prove what they were written to prove. |
| `packages/client/src/generated/` | Generated from the IDL. A hand edit survives review and dies at `pnpm codegen:check`, having wasted everyone's time. |
| `programs/agent_rails/tests/layout.rs` | The snapshot is what lets v1.1 land without migrations. Updating it to make a test pass converts a real regression into a green run. |
| `packages/sdk/src/send-payment.ts` and the payment path | The indeterminate-outcome handling is the difference between a retry and a double payment. |
| The `vault-transfer` write path in `packages/dashboard` | The only place the browser moves money. |

Everything else — the CLI, the dashboard's read paths and UI, the MCP server's tool bodies,
docs, tests — is fair game with a normal review.

## Invariants no pull request may break

These are in `CLAUDE.md` in full. The short version:

1. **Loosening flows downhill only.** Owner sets ceilings, operator sets policy ≤ ceiling,
   the agent sets nothing.
2. **The agent-facing MCP surface has no privilege-escalating tool.** `create_session`,
   `update_policy`, `unpause`, `withdraw` and allowlist edits belong to the CLI and the
   dashboard. `packages/mcp/src/tools/tool-surface.test.ts` and
   `packages/dashboard/src/lib/server/privileged-surface.test.ts` are what make that
   mechanical rather than cultural.
3. **Every payment path creates an `IntentReceipt`.** Idempotency is by construction.
4. **Pause is an agent kill switch, not an owner lock.** Withdraw keeps working while paused.
5. **Windows are fixed epoch buckets.** Not rolling; see ARCHITECTURE.md §6 for why.

## Security

Do not open a public issue for a vulnerability. Until `SECURITY.md` exists with a disclosure
process, mail the maintainers and expect an acknowledgement before you publish anything.
