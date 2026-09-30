# Architecture Decision Records

Each ADR captures one decision from the v1 design session: the context, the options considered, the decision, and its consequences. ADRs are immutable once accepted; a later ADR may supersede an earlier one.

| ADR | Title | Status |
|---|---|---|
| [001](ADR-001-native-pda-vault.md) | Native PDA vault with no external program dependencies | Accepted |
| [002](ADR-002-role-separation.md) | Owner / operator / guardian role separation, prepared for timelocks | Accepted |
| [003](ADR-003-agent-signing-model.md) | Direct session signer in v1, `PaymentIntent` payload prepared for signed-intent mode | Accepted |
| [004](ADR-004-idempotency-receipts.md) | Idempotency via per-intent receipt PDAs | Accepted |
| [005](ADR-005-policy-engine.md) | Shared policy PDAs, allowlist entry PDAs, fixed-bucket limits, off-chain soft policies | Accepted |
| [006](ADR-006-audit-hash-chain.md) | Events plus per-session hash chain for a verifiable audit log | Accepted |
| [007](ADR-007-mcp-surface.md) | Dual-transport MCP server with a read-mostly, non-escalating tool contract | Accepted |
| [008](ADR-008-test-harness.md) | Layered Rust-first test pyramid with a pure policy crate, Trident, and Kani | Accepted |
| [009](ADR-009-sdk-and-dx.md) | Codama/Kit client, contract package, thin adapters, MCP-first Python | Accepted |
| [010](ADR-010-token-surface.md) | SPL + Token-2022 with an extension gate, native SOL vault, fund lifecycle semantics | Accepted |
| [011](ADR-011-governance-and-release.md) | Staged trust: multisig upgrades → frozen program; Apache-2.0; independent versioning | Accepted |
| [012](ADR-012-intent-derivation-and-outcomes.md) | Derived intent ids and a four-valued payment outcome | Accepted |
| [013](ADR-013-progressive-security-posture.md) | Progressive security posture with a fixed set of configurable guard-rails | Accepted |
| [014](ADR-014-hybrid-funding-mode.md) | Hybrid `FundingMode`: isolated vault or native Solana allowance, owner-selected per mint | Accepted |
| [015](ADR-015-phased-ci-gates.md) | Phased CI gates, with the deferred half of ADR-008 named rather than implied | Accepted |
| [017](ADR-017-hosted-tenancy-and-client-held-secrets.md) | Hosted dashboard: account/org tenancy, Supabase identity, and client-held secrets | Accepted |
| [018](ADR-018-in-browser-wallet-generation.md) | In-browser wallet generation, shown once and never held | Accepted |
| [020](ADR-020-upgrade-authority-off-ci.md) | The upgrade authority leaves CI: a separate offline key, held by a person | Accepted |
| [021](ADR-021-operator-surfaces-cli-and-dashboard.md) | Operator surfaces: CLI and dashboard, never MCP; wave 1 session lifecycle | Accepted |
| [022](ADR-022-agent-reporting-and-review-queue.md) | Agents report to the dashboard; a person decides what they ask | Accepted |
| [025](ADR-025-cross-network-connector-desk-signed.md) | Cross-network execution through a desk-signed connector with an off-chain recipient allowlist | Proposed |

016 is reserved by issue #23 (the per-session ceiling) and lands with it. 019 is reserved by
pull request #54 (self-hosting on a VM) and lands with it. 023 and 024 are taken on stacked
branches (connectors #82, email login #85) and land with them.

Template for new ADRs: `ADR-NNN-short-title.md` with sections **Context**, **Options considered**, **Decision**, **Consequences**.
