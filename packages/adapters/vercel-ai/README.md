# @agent-rails/adapter-vercel-ai

Thin Vercel AI SDK adapter for the agent-facing Agent Rails tools (`AGENT_TOOL_NAMES`).
Schemas and names come from `@agent-rails/contract`; you supply in-process handlers (delegate to
`@agent-rails/mcp` handlers, call `@agent-rails/sdk` directly, or use mocks for tests).

## Setup

```bash
pnpm add @agent-rails/adapter-vercel-ai ai @agent-rails/contract
```

```ts
import { createAgentRailsTools } from "@agent-rails/adapter-vercel-ai";
import { generateText } from "ai";
import { openai } from "@ai-sdk/openai";

const tools = createAgentRailsTools({
  getSession: async () => ({ /* ... */ }),
  getPolicy: async () => ({ /* ... */ }),
  listDestinations: async () => ({ destinations: [] }),
  getPaymentStatus: async ({ intent_id }) => ({ intent_id, status: "settled" }),
  checkPayment: async (input) => ({ wouldAccept: true, input }),
  executePayment: async (input) => ({ outcome: "settled", input }),
});

const { text } = await generateText({
  model: openai("gpt-4o-mini"),
  tools,
  prompt: "Dry-run paying acme-hosting 1.00 USDC for invoice inv-9.",
});
```

## Cursor (MCP)

For Cursor/Claude Desktop, prefer the stdio MCP server (no adapter needed):

```json
{
  "mcpServers": {
    "agent-rails": {
      "command": "npx",
      "args": ["-y", "@agent-rails/mcp"],
      "env": {
        "AGENT_RAILS_RPC": "https://api.devnet.solana.com",
        "AGENT_RAILS_SESSION": "<session-pda>",
        "AGENT_RAILS_SIGNER": "~/.agent-rails/session.json"
      }
    }
  }
}
```

Run `npx agent-rails init` once to create the treasury, policy, session, and this config.

## Mock example

From the repo root (build first):

```bash
pnpm --filter @agent-rails/adapter-vercel-ai build
node --experimental-strip-types packages/adapters/vercel-ai/examples/mock-run.ts
```

Copy `examples/agent-rails-mcp.cursor.json` into Cursor MCP settings for the stdio server path.
