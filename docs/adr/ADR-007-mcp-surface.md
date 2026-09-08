# ADR-007: Dual-transport MCP server with a read-mostly, non-escalating tool contract

**Status:** Accepted

## Context

MCP is the agent-facing control surface and therefore the largest prompt-injection attack surface. Most MCP users run local stdio servers; enterprises need a remote, multi-tenant server. The tool contract must be shared by both transports and by framework adapters.

## Options considered

- A. Local stdio sidecar only.
- B. Remote Streamable HTTP server only.
- **C. One server core, dual transport, pluggable `SessionResolver`.**
- D. No MCP server, framework adapters only.

## Decision

Option C: stdio in v1.0 (`EnvSessionResolver`, one session per process, config via `AGENT_RAILS_SESSION`, `AGENT_RAILS_SIGNER`, `AGENT_RAILS_RPC`), Streamable HTTP in v1.1 (`TokenSessionResolver`: API key in v1.1, OAuth 2.1 adapter later).

Tool contract (identical across transports and adapters, defined in `@agent-rails/contract`):

- Reads: `get_session`, `get_policy`, `list_allowed_destinations`, `get_balance`, `get_payment_status`, `list_payments`.
- `check_payment`: soft hooks + on-chain simulation; returns `allowed`, `reasons[]`, `remaining_after`, `intent_id`, `amount_sent`, `estimated_amount_received`. Stateless.
- `execute_payment`: same checks, sign, send, confirm; returns `signature`, `receipt`, `seq`, `audit_head`, `remaining`.
- Absent by design: `create_session`, `update_policy`, `withdraw`, `pause`/`unpause`, allowlist edits. Operator actions live in the CLI.
- Amounts are decimal strings in human units; destinations are labels or pubkeys and responses echo the resolved pair; every denial carries a `reason_code` mirroring the Anchor error code.
- Resources `agent-rails://session/{pubkey}`, `agent-rails://policy/{pubkey}`; prompt `payment-guidelines`.
- Server-side per-session concurrency cap as defense in depth.

## Consequences

- Agents move from laptop to cloud without code changes.
- A prompt-injected agent has no tool that loosens its own constraints.
- HTTP mode inherits hardening obligations (TLS, auth, rate limits) when it ships in v1.1.
- v1.1 adds `request_limit_increase(reason)`, which only emits an off-chain event.
