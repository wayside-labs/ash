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

Template for new ADRs: `ADR-NNN-short-title.md` with sections **Context**, **Options considered**, **Decision**, **Consequences**.
