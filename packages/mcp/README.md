# @agent-rails/mcp

stdio MCP server exposing Agent Rails payment tools to AI agents (Cursor, Claude Desktop, etc.).

## Environment

| Variable | Required | Description |
|---|---|---|
| `AGENT_RAILS_RPC` | yes | Solana JSON-RPC URL |
| `AGENT_RAILS_SIGNER` | yes | Path to session keypair JSON (64-byte array) |
| `AGENT_RAILS_FEE_PAYER` | no | Path to fee-payer keypair JSON (defaults to session key) |

## Run locally

```bash
pnpm --filter @agent-rails/mcp build

AGENT_RAILS_RPC=https://api.devnet.solana.com \
AGENT_RAILS_SIGNER=~/.config/agent-rails/session-keypair.json \
node packages/mcp/dist/cli.js
```

## Cursor / Claude Desktop config

```json
{
  "mcpServers": {
    "agent-rails": {
      "command": "node",
      "args": ["/path/to/agent-rails/packages/mcp/dist/cli.js"],
      "env": {
        "AGENT_RAILS_RPC": "https://api.devnet.solana.com",
        "AGENT_RAILS_SIGNER": "/path/to/session-keypair.json"
      }
    }
  }
}
```

## Tools (v1)

| Tool | Kind | Description |
|---|---|---|
| `agent_rails_get_session` | read | Decode `AgentSession` — seq, expiry, per-mint spend counters |
| `agent_rails_get_policy` | read | Decode `Policy` — per-mint limits, destination mode, memo requirement |
| `agent_rails_check_payment` | read | Idempotency lookup — does an `IntentReceipt` exist for `intent_id`? |
| `agent_rails_execute_payment` | write | Build, simulate, sign, and broadcast a guarded payment; returns signature + PDAs |

Schemas live in `@agent-rails/contract` (`mcpGetSessionSchema`, `mcpGetPolicySchema`, `mcpCheckPaymentSchema`, `mcpExecutePaymentSchema`).
