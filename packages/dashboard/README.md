# @agent-rails/dashboard

Web dashboard for Agent Rails — chat-first UI to manage workflows, agents, treasuries, and limits.

## Stack

- Next.js 15 (App Router) · React 19 · TypeScript strict
- Tailwind CSS v4 + Radix UI (shadcn-style components)
- Zustand (client preferences) + TanStack Query (server state)
- Injected wallet connect: Phantom, Solflare, Backpack
- Local Claude Code CLI (subscription) or `@anthropic-ai/sdk` (API key) for the chat

## Run locally

```bash
pnpm install
pnpm build --filter @agent-rails/sdk       # dashboard imports the built SDK
pnpm dashboard                             # dev server on :3000
```

Production: `pnpm dashboard:build && pnpm --filter @agent-rails/dashboard start`.

## Where data lives

Everything you create in the UI is stored server-side in a single JSON document:

```
~/.agent-rails/dashboard.json        # override with AGENT_RAILS_HOME
```

Written atomically (temp file + rename) with mode `600`. API keys are kept in that
file and **never** returned to the browser — `/api/state` only ever emits a mask.
First run seeds demo rows flagged `demo: true`; Settings → Dados → *Restaurar
padrões* resets to that seed.

## On-chain reads

The dashboard reads the chain server-side through `@agent-rails/sdk`:

| Endpoint | What it reads |
|---|---|
| `POST /api/solana/balances` | `getBalance` for every real address the UI knows |
| `GET /api/solana/treasury` | Treasury + its Policies and AgentSessions (memcmp on the treasury field), plus mint decimals |
| `POST /api/solana/rpc-health` | `getVersion` + `getSlot` against the selected RPC |

A custom RPC is user input that reaches a server-side fetch, so it is restricted
to `https` on a public host — private ranges fall back to the cluster default.

To see real numbers, give a workflow a treasury. On devnet or testnet, **Create on-chain
vault** on `/treasury` runs the same stages as `agent-rails init` with your wallet signing
each one (ADR-021 wave 2A):

| Endpoint | What it does |
|---|---|
| `POST /api/solana/bootstrap/plan` | Addresses, the stages still missing on-chain, deposit shortfall, a cost estimate |
| `POST /api/solana/bootstrap/build-step` | The next missing stage as an unsigned transaction; `{ done: true }` when none is left |
| `GET /api/solana/bootstrap/vendors` | The VPS demo vendors' catalogs, for the first-destination preset |

The stages come from `@agent-rails/cli/bootstrap`, not from a copy. The browser holds the
throwaway `create_key` and the optional first session key; each signature is confirmed
through `/api/solana/confirm`, as with vault transfer and session create. The CLI remains the
path for mainnet and for scripts, and an existing treasury address can still be pasted into
a workflow:

```bash
pnpm agent-rails init --rpc https://api.devnet.solana.com --yes
```

Rows without a treasury address show `—` rather than borrowing a number.

### Metrics payment history (Phase B)

`/metrics` §5 replays `PaymentExecuted` events from transaction logs via
`GET /api/metrics/history` — a signature walk on each session PDA, not an
indexer. Public RPCs retain logs for days (not months), so the ledger is always
**best-effort and windowed**: the completeness banner names the oldest slot the
walk reached, and headline payment counts from on-chain `seq` may exceed the rows
shown. CSV/JSON export uses the same `paymentRecordSchema` columns as the MCP/CLI
sink (`GET /api/metrics/history/export`).

## Chat

`GET /api/chat/providers` reports what this machine can run the chat on.
`POST /api/chat` streams text and names the path it took in `x-agent-rails-mode`.

| Provider | Needs | Cost |
|---|---|---|
| `claude-cli` | Claude Code installed and logged in | your Claude subscription |
| `anthropic-api` | an Anthropic key in *My APIs* or `ANTHROPIC_API_KEY` | per token |
| `demo` | nothing | fixed replies |

The CLI wins by default: it needs no key and adds no per-token cost. Pick a
specific model in the chat footer to override.

If you previously saw **Demo** while Claude Code was installed, an old persisted
choice may be stuck — open the chat footer and switch the model to Sonnet (or any
non-demo option); the UI now auto-promotes when a real provider is detected.

### Using a subscription instead of an API key

`claude-cli` spawns the locally installed Claude Code in headless mode
(`claude -p --output-format stream-json`). It does **not** read the stored OAuth
token: that token is scoped to `user:sessions:claude_code`, so lifting it and
calling the API directly would be both a terms violation and technically wrong.
The CLI is the licensed client, so the dashboard drives the client.

This only works when the dashboard runs on the same machine as the CLI. A
deployed instance will not see it and falls back to the API key or demo mode.

### Why the subprocess is safe

The endpoint turns chat input into a process, so the process gets nothing:

- `permissions.deny: ["*"]` — deny-by-default, verified to leave the model with
  zero tools. A denylist of tool names was rejected on purpose: the built-in
  roster changes between CLI releases, so a name list rots into a hole on the
  next upgrade.
- `--strict-mcp-config` with no config — drops every MCP server the user has,
  including the Agent Rails payment tools, which must never be reachable from a
  chat box. Verified with a canary `.mcp.json` that was not loaded.
- cwd is an empty sandbox directory, so no `CLAUDE.md` or repo file is in scope.
- the model id comes from a fixed map, never from request text.

Because the model has no tools, it cannot go and fetch anything — it is handed a
read-only snapshot of the dashboard and the on-chain accounts instead
(`src/lib/server/llm/context.ts`). API keys are never part of that snapshot.
This is what makes the chat read-only *by construction*: there is no code path
from the chat box to a write. Anything that moves money is a human action in the
UI, signed by the owner (ARCHITECTURE.md, ADR set).

### OpenAI

Not wired. The equivalent path is the Codex CLI, which can also authenticate
with a ChatGPT subscription; it is not installed here, so no adapter shipped
rather than one that was never run. The seam is
`src/lib/server/llm/providers.ts`.

## Pages

| Route | Description |
|---|---|
| `/` | Chat + workflow rows |
| `/workflows` | Workflow rows with horizontal agent scroll, edit/remove |
| `/agents` | All agents by workflow, pause/edit/remove |
| `/wallets` | Treasury, agent and owner addresses with live SOL balances |
| `/treasury` | Cofres per workflow; opens the on-chain policy/session view |
| `/limits` | Spending limits with progress bars |
| `/mcps` | MCP servers (persisted toggles) |
| `/skills` | Agent skills (global / workflow / agent) |
| `/apis` | LLM API keys, stored server-side |
| `/account` | Connected wallet identity |
| `/profile` | Profile fields |
| `/settings` | Network, RPC, preferences, export/reset |

## Design system

Tokens live in `src/app/globals.css`. Three decisions worth knowing before editing:

- **Four surface levels** (`background` → `card` → `elevated` → `muted`) plus a
  `.surface-raised` utility that draws a 1px top highlight. Depth comes from
  stepped surfaces, never from drop shadows (overlays excepted).
- **Status is a reserved scale** (`good` / `warning` / `serious` / `critical`) and
  never doubles as a series or accent colour. Every status ships with an icon and
  a word, so meaning never travels as hue alone. Solana green is both the brand
  and `good` — one meaning, so the hue is not spent twice.
- **Data provenance rides ink level, not hue** (`moneyTone` in `src/lib/utils.ts`):
  a chain-read figure is the brightest thing in its row, a demo figure is dimmer,
  an unprovisioned one is dimmest. That keeps hue free for status.

Every colour was checked for WCAG contrast against `--color-card`: marks clear
3:1, text clears 4.5:1.

Numbers and addresses use JetBrains Mono via the `.num` utility; `.num-col` adds
`tabular-nums` and is for **columns** only — tabular figures make a large
standalone value look loose.

`src/components/viz/ceiling-meter.tsx` is the signature component: it draws the
owner ceiling, the operator policy and the agent's spend as one nested bar, which
is the protocol's "loosening only flows downhill" rule made visible. It degrades
to a plain two-band meter for rows with no on-chain treasury rather than implying
a ceiling that was never set.

The app is dark-only — `<html className="dark">` is hardcoded and there is no
light palette yet.

## Deferred

The rest of ADR-021 wave 2: allowlist editor, policy editor, pause/unpause, session
revoke, ceiling and guardian management (2B/2C), plus SPL mints and mainnet in the bootstrap
wizard — use `pnpm agent-rails init --mint` / `init` against mainnet for those. Treasury
bootstrap (wave 2A), deposit/withdraw and session create already run in the browser.

RAG, Harness and Integrations were removed outright rather than shipped as
labels: none had backend infrastructure behind it, and a nav entry reads as a
promise. Their state collections (`rag`, `integrations`) stay in the schema so an
existing `dashboard.json` still parses, but nothing seeds or renders them.

## Environment

```bash
cp packages/dashboard/.env.example packages/dashboard/.env.local
```
