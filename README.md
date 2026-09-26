# Agent Rails

A guardrail and treasury framework that lets autonomous AI agents make on-chain Solana
payments without ever holding unbounded funds.

An owner deposits into a program-owned vault and defines policy — per-transaction,
windowed and lifetime limits, destination allowlists, mint allowlists — then issues
time-boxed sessions to agents. An agent pays through a single `execute_payment`
instruction that the program refuses unless every rule holds. The agent's key authorizes
a payment; it never authorizes a limit.

> **Status: `0.x`, unaudited, devnet only.** No professional audit has been done and the
> upgrade authority is not yet renounced. Do not put funds you care about behind this.

## Trust phases

Every claim below is one you can check on-chain, which is the point of writing them down
(ADR-011). The row in bold is where the project is today.

| Phase | Upgrade authority | Networks | What it means for you |
|---|---|---|---|
| **`0.x` — now** | **a single developer key** | **devnet only** | **Whoever holds that key can replace the program under your vault. Unaudited. Treat any balance as spendable by the maintainer.** |
| `1.0.0-beta` | Squads 3-of-5, ≥1 external security signer, time lock, ≥72 h public notice | mainnet, with TVL guidance | No single person can ship an upgrade, and you get notice before one lands. |
| `1.0.0` | `None` — renounced | mainnet | The program cannot be changed by anyone, including us. Post-audit. |
| `2.x` | new program id | mainnet | Migration is opt-in, with `migrate_treasury` tooling; the `1.0.0` program keeps running. |

```
$ agent-rails doctor --rpc https://api.devnet.solana.com
✔ Upgrade authority   <the key currently set on the deployed program>
```

That line is read out of the loader's `ProgramData` account, so the first column above is
verifiable rather than promised — and if it ever prints the wallet you are running the
command with, it says so.

The rule that key follows is ADR-020: it is held by a person, offline, and it is **never** the
`DEVNET_KEYPAIR` secret CI uses to pay for the release smoke. A repository secret that can also
replace the program puts two powers several orders of magnitude apart behind one credential.
Run the command above to see which key is actually set — that is the point of printing it
rather than writing it down here. It is still a single key either way, which is what the `0.x`
row is admitting.

### Verifying what is deployed

Every release tag carries the SBF artifact, its SHA-256 and the toolchain that produced it:

```bash
scripts/program-hash.sh build      # hash what this tree builds
scripts/program-hash.sh onchain    # hash what devnet is running
scripts/program-hash.sh compare    # and say whether they agree
```

The digest is toolchain-pinned, not container-hermetic: it reproduces for anyone on the
same commit with the pinned Agave and Rust versions, and it is not yet a
`solana-verify` image build. ADR-011 records why and what would change that.

### Installing

Nothing is on npm yet. The packages are versioned and ready to publish, and the release
workflow runs on every merge with publishing switched off — deliberately, until the trust
phase above is worth a package that cannot be unpublished. Until then:

```bash
git clone https://github.com/wayside-labs/agent-rails && cd agent-rails
pnpm install && pnpm build
pnpm agent-rails init --rpc https://api.devnet.solana.com
```

### Devnet demo

`scripts/demo.sh` reproduces the three proofs from the Colosseum pitch on public devnet and
prints a Markdown report with explorer links:

1. **Prompt injection** — six MCP agent tools, no `withdraw`.
2. **Indeterminate retry** — `pay --confirm-timeout 0` times out confirmation, the SDK reports
   `indeterminate`, a retry on the same reference is refused on-chain (no double-spend).
3. **Operator lowers the ceiling** — `policy set` tightens the daily limit, the next payment
   is denied with a stable reason code.

```bash
pnpm build
scripts/demo.sh --wallet ~/.config/solana/id.json
```

The wallet needs roughly 0.05 SOL on devnet (rent and deposits are not recoverable without
`close treasury`). The script fails with a clear message if the balance is too low. Keys
written under `--out` are session and fee-payer keypairs for a throwaway treasury — keep them
`0600` and delete the directory when you are done.

### Reference agent (devnet traction)

An **in-house** agent pays a registered devnet destination on a loop until **2026-10-12** so
pitch metrics are on-chain verifiable. This is manufactured traction under our own policy —
say that explicitly in the video.

| | |
|---|---|
| Treasury | [`BTE45zKpHiWMTwaPmShaUBq2cnA6XUc8KhgxnufSnz3w`](https://explorer.solana.com/address/BTE45zKpHiWMTwaPmShaUBq2cnA6XUc8KhgxnufSnz3w?cluster=devnet) |
| Program | [`4qjD6vSgYa3oBKde3KVzsH8oCcP9BKsirX1xtD5SS6BS`](https://explorer.solana.com/address/4qjD6vSgYa3oBKde3KVzsH8oCcP9BKsirX1xtD5SS6BS?cluster=devnet) |
| Policy (`dashboard-demo`) | [`H4HU1sPoevCGqHeFQiyW5Q8NVmQgAb1DyZgP2LSzwMPE`](https://explorer.solana.com/address/H4HU1sPoevCGqHeFQiyW5Q8NVmQgAb1DyZgP2LSzwMPE?cluster=devnet) |
| Destination `demo` | [`3tvQknH6RHfnssAGgC64z7KkejwrQ3USftxosmoimX4z`](https://explorer.solana.com/address/3tvQknH6RHfnssAGgC64z7KkejwrQ3USftxosmoimX4z?cluster=devnet) |

```bash
# loop running via scripts/reference-agent.sh loop (or cron) — see docs/runbooks/reference-agent.md
scripts/reference-agent.sh metrics   # audit export --verify + sink counts
```

Deck target (update before recording): **2,100 payments settled, 31 denied by policy, 0
double-spends** — refresh with `agent-rails audit export --verify` and the sink JSONL at
`~/.agent-rails/reference-agent/payments.jsonl`.

Full setup: [`docs/runbooks/reference-agent.md`](docs/runbooks/reference-agent.md).

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
| `docs/runbooks/reference-agent.md` | In-house devnet agent — MCP, cron, metrics until 12/10 |

Several directories carry their own `CLAUDE.md` with rules scoped to that subtree.

## License

Apache-2.0.
