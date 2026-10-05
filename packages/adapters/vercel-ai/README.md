# @ash/adapter-vercel-ai

Thin Vercel AI SDK adapter for the agent-facing ASH tools (`AGENT_TOOL_NAMES`).
Schemas and names come from `@ash/contract`; you supply in-process handlers (delegate to
`@ash/mcp` handlers, call `@ash/sdk` directly, or use mocks for tests).

## Setup

```bash
pnpm add @ash/adapter-vercel-ai ai @ash/contract
```

```ts
import { createAshTools } from "@ash/adapter-vercel-ai";
import { generateText } from "ai";
import { openai } from "@ai-sdk/openai";

const tools = createAshTools({
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
    "ash": {
      "command": "npx",
      "args": ["-y", "@ash/mcp"],
      "env": {
        "ASH_RPC": "https://api.devnet.solana.com",
        "ASH_SESSION": "<session-pda>",
        "ASH_SIGNER": "~/.ash/session.json"
      }
    }
  }
}
```

Run `npx ash init` once to create the treasury, policy, session, and this config.

## Mock example

From the repo root (build first):

```bash
pnpm --filter @ash/adapter-vercel-ai build
node --experimental-strip-types packages/adapters/vercel-ai/examples/mock-run.ts
```

Copy `examples/ash-mcp.cursor.json` into Cursor MCP settings for the stdio server path.
