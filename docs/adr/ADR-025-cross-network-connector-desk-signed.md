# ADR-025: Cross-network execution through a desk-signed connector with an off-chain recipient allowlist

**Status:** Proposed

## Context

Agents asked to act beyond Solana — pay into another network, bridge, lend, enter a yield
vault — had no route. SODAX offers all four through one intent system: a signer locks the input
on its network, a relayer carries the intent to the Sonic hub, independent solvers fill on the
destination network. Solana is a spoke with its own audited programs; integration is TypeScript.

Three facts constrain how Agent Rails can take part:

- The intent's `srcAddress` is whoever signs the Solana deposit, and cancel and refund rights
  follow it (the hub wallet is derived from `(chain, srcAddress)`).
- SODAX publishes no Solana instruction layout; only its SDK builds those transactions.
- The on-chain destination allowlist (ADR-005) knows Solana accounts. An intent can deliver to
  any of 22 networks, and to a different address than the one that paid.

## Options considered

- **A. The vault PDA signs the intent by CPI into SODAX's Solana programs.** Keeps custody in
  the vault until the last moment, but reverses ADR-001 (no external program dependencies),
  binds the program to an undocumented, upgradeable interface, and needs the program to sign
  every cancel. Rejected.
- **B. A connector that signs with a desk key it holds.** Simple for agents, but it puts a
  spending key inside an agent-facing MCP server — the capability ADR-007 keeps out of the agent
  surface. Rejected.
- **C. A keyless connector that builds unsigned transactions for a desk wallet the treasury has
  already paid through `execute_payment`, and refuses recipients the operator has not listed.**
  The pattern the Jupiter connector already follows, plus a recipient check the chain cannot do.

## Decision

C. `agent-rails-integrations mcp sodax` quotes, builds unsigned transactions (swap, bridge,
money-market action, vault deposit/withdraw, cancel), hands already-broadcast transactions to the
SODAX backend or relay, and reads status. It holds no key and has no path to the vault.

Every build that can deliver value to a recipient checks `(dstChainKey, dstAddress)` against
`SODAX_ALLOWED_DESTINATIONS`, an operator-set environment variable. The list fails closed: empty
permits only returning funds to the signing desk on its own chain. It is connector configuration,
never a tool argument, so agents cannot widen it.

## Consequences

- `execute_payment` and its `IntentReceipt` remain the only way value leaves the vault; the
  idempotency and privilege invariants are untouched.
- The recipient check is an off-chain soft policy (ADR-005's tier): it binds the connector, not a
  desk key used some other way. Guarding the desk key itself stays the operator's job.
- Funds at the desk, and SODAX intents in flight, are outside the vault's accounting. The audit
  chain records the payment to the desk, not what the desk did with it.
- SODAX is mainnet-only. The Surfpool E2E cannot exercise a fill; the connector is covered by
  unit tests against a fake SDK and by manual, person-run mainnet smoke with small amounts.
- The connector depends on `@sodax/sdk`, which pulls `@solana/web3.js` 1.x, Anchor 0.30 and
  other chains' clients. They are isolated in `packages/integrations` and loaded only when the
  `sodax` connector starts.
