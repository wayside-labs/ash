# @agent-rails/dashboard

Web dashboard for Agent Rails — chat-first UI to manage workflows, agents, treasuries, and limits.

## Stack

- Next.js 15 (App Router)
- React 19 + TypeScript
- Tailwind CSS v4 + Radix UI (shadcn-style components)
- Zustand (global state) + TanStack Query
- Phantom wallet connect (Wallet Standard)

## Run locally

```bash
# From repo root — install deps first (needs network)
pnpm install

# Build workspace packages the dashboard depends on
pnpm build --filter @agent-rails/sdk

# Start dev server
pnpm --filter @agent-rails/dashboard dev
```

Open http://localhost:3000

## Pages

| Route | Description |
|---|---|
| `/` | Home — chat + workflow preview |
| `/workflows` | Netflix-style workflow rows |
| `/agents` | All agents by workflow |
| `/wallets` | Treasury, agent, and owner wallets |
| `/treasury` | Cofres per workflow |
| `/limits` | Spending limits with progress bars |
| `/mcps` | MCP server management |
| `/rag` | Knowledge base documents |
| `/skills` | Agent skills (global / workflow / agent) |
| `/apis` | LLM API keys |
| `/integrations` | dApp connections + Solana/Agent Rails mode |
| `/harness` | Agent runtime environments |
| `/account` | Login (Google demo) + security |
| `/profile` | User profile + main wallet |
| `/settings` | Network, RPC, preferences |

## Environment

Copy `.env.example` to `.env.local` and add API keys when ready:

```bash
cp packages/dashboard/.env.example packages/dashboard/.env.local
```

Chat works in **demo mode** without API keys — it responds with contextual setup suggestions.
