# ADR-009: Codama/Kit client, contract package, thin adapters, MCP-first Python

**Status:** Accepted

## Context

Web3 developers want a typed on-chain client on the current stack (`@solana/kit` 7.x plugin clients, Codama-generated clients); AI developers want a tool that pays from LangChain, Vercel AI SDK, OpenAI Agents, Cursor, or Claude without seeing an `Address`. Three divergent implementations of the same contract would drift.

## Options considered

- A. Anchor TS client (`@anchor-lang/core`) as the SDK foundation (legacy types, runtime IDL).
- **B. Codama-generated Kit client + hand-written Kit plugin SDK + shared contract package.**
- C. MCP only, no SDK.
- D. Per-framework SDKs with their own logic.

## Decision

Option B.

- Monorepo: pnpm workspaces + Turborepo, Changesets, ESM-only, Node 22+, strict TypeScript, `tsdown`, `vitest`, Biome.
- `@agent-rails/client`: 100% Codama-generated; CI fails on a non-empty regeneration diff.
- `@agent-rails/sdk`: Kit plugin `client.use(agentRails({ session, signer }))`; `Signer` = Kit `TransactionPartialSigner` with `KeypairSigner` and generic `RemoteSigner`; `PaymentIntent` builder; `intent_id` generation; decimals conversion; preflight; `PolicyHook`s; `AgentRailsError` with `reason_code` and `remaining`.
- `@agent-rails/contract`: zod schemas for tools, reason codes, events; JSON Schema export consumed by Python.
- Adapters (`langchain`, `ai-sdk`, `openai-agents`) call the SDK in-process and import schemas from the contract package. **`@agent-rails/adapter-vercel-ai`** (`packages/adapters/vercel-ai`) ships the Vercel AI SDK mapping; LangChain and OpenAI Agents remain planned.
- Python (`agent-rails` on PyPI) is MCP-first: wraps the official MCP Python SDK and exposes LangChain / CrewAI / pydantic-ai tool wrappers. No native signing in v1.
- `npx agent-rails init` bootstraps a devnet treasury, policy, allowlist entry, session, funds the vault, and writes the MCP config for Cursor or Claude Desktop. Target: under five minutes to the first guarded payment.
- Docs: Agent Developer, Treasury Operator, Protocol/Security tracks; `ARCHITECTURE.md` and `THREAT_MODEL.md` at the root.

## Consequences

- The MCP tool and the LangChain tool are the same zod schema and handler; drift is a type error.
- Developers on `@solana/web3.js` 1.x need a short migration doc and `fromLegacyPublicKey` helper.
- Native Python via `solders` + Codama Python renderer is deferred to v2, gated on demand.
