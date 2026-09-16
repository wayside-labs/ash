# Agent Rails

A guardrail and treasury framework that lets autonomous AI agents make on-chain Solana
payments without ever holding unbounded funds.

An owner deposits into a program-owned vault and defines policy — per-transaction,
windowed and lifetime limits, destination allowlists, mint allowlists — then issues
time-boxed sessions to agents. An agent pays through a single `execute_payment`
instruction that the program refuses unless every rule holds. The agent's key authorizes
a payment; it never authorizes a limit.

> **Status: `0.x`, unaudited, devnet only.** No professional audit has been done and the
> upgrade authority is not yet renounced. ADR-011 sets out the phases to `1.0.0`. Do not
> put funds you care about behind this.

## Why it is shaped this way

**Loosening flows downhill only.** The owner sets ceilings, an operator sets policy that
must be `≤` those ceilings, and the agent sets nothing. No code path lets a lower-privileged
role raise a limit, and the agent-facing MCP/SDK surface exposes no tool that could —
`create_session`, `update_policy`, `unpause`, `withdraw` and allowlist edits are absent by
construction, asserted in `packages/mcp/src/tools/tool-surface.test.ts`.

**The program is the guarantee.** Off-chain policy hooks, the local governor and the
security presets are advisory; they decide how much the client refuses on its own. Every
one of them can be bypassed by whoever owns the process. Only the on-chain checks cannot.

**Idempotency by construction.** Every payment initializes an `IntentReceipt` PDA seeded by
`intent_id`, so a retried intent fails at account creation rather than paying twice. Intent
ids are derived from the payment being settled, never drawn at random.

**Pause is an agent kill switch, not an owner lock.** Owner withdrawal keeps working while
paused.

## Layout

```
programs/agent_rails/       Anchor program — account validation, PDA custody, CPI only
crates/agent-rails-policy/  pure policy arithmetic and audit hash chain, no Solana deps
idl/agent_rails.json        checked-in IDL, the source of truth for TypeScript codegen
packages/contract/          Zod schemas, reason codes, event types
packages/client/            Codama-generated @solana/kit client
packages/sdk/               PaymentIntent builder, preflight, signing, error mapping
packages/mcp/               stdio MCP server exposing the agent-facing payment tools
```

The split is the design: the program stays thin, and all policy arithmetic lives in a crate
with no Solana dependency, `#![forbid(unsafe_code)]`, `checked_*` arithmetic throughout, and
property tests that run millions of cases without an SVM.

## Working on it

```bash
pnpm install                # also installs the git hooks via lefthook
cargo test --workspace      # 157 tests, no validator needed
pnpm test                   # 129 tests across the four packages
pnpm typecheck
pnpm lint
```

After any change to the program's instructions or accounts:

```bash
pnpm idl:build              # needs the Solana toolchain and anchor 1.1.2
pnpm codegen                # regenerate the client — never hand-edit src/generated
pnpm codegen:check          # what CI runs
```

CI runs all of the above plus `cargo deny`, gitleaks and semgrep on every pull request.

## Where to read next

| | |
|---|---|
| `CLAUDE.md` | Commands, conventions, and the invariants to preserve when editing |
| `ARCHITECTURE.md` | The design baseline — roles, payment flow, account model, policy engine, audit chain, MCP surface, test pyramid |
| `docs/spec/accounts-and-instructions.md` | Byte-level account and instruction layouts |
| `docs/adr/` | Decisions, immutable once recorded; `README.md` there is the index |

Several directories carry their own `CLAUDE.md` with rules scoped to that subtree.

## License

Apache-2.0.
