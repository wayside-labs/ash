# Sealevel-oriented review — `programs/agent_rails`

**Date:** 2026-09-29  
**Scope:** `programs/agent_rails` handlers and account validation (not dashboard tenancy)  
**Method:** Maintainer walkthrough against common Solana program failure modes, cross-checked with LiteSVM integration tests and `programs/agent_rails/tests/error_codes.rs`.

**Not** a penetration test or formal audit.

---

## Summary

| Area | Assessment |
|---|---|
| Signer / authority | Role checks enforced per instruction; agent path uses `session_key` signer; owner/operator/guardian splits tested in `admin`, `operator`, `lifecycle`. |
| PDA derivation | Treasury, policy, session, receipt, vault PDAs re-derived in handlers; wrong seeds fail in tests. |
| CPI targets | Token / Token-2022 / ATA / System only (ADR-001); native allowance CPIs fixed program id in `native_allowance.rs`. |
| Arithmetic | Policy math in `agent-rails-policy` with `checked_*`; program uses policy crate results. |
| Idempotency | `IntentReceipt` init-on-`intent_id`; double-pay covered in tests and MCP/SDK e2e. |
| Unchecked accounts | `destination_owner` intentionally unchecked for org-chart payments; destination still gated by allowlist mode and ATA/vault wiring in handler. |

---

## Checklist (selected items)

| Risk | Mitigation in tree | Test / note |
|---|---|---|
| Missing signer on privileged ix | `Signer<'info>` on owner/operator/session as required | `admin.rs`, `operator.rs` |
| Session pays after revoke/expiry | Session liveness checks in `execute_payment` | `lifecycle.rs`, `payments.rs` |
| Policy above ceiling | `policy_within_ceiling` in policy crate | `operator.rs`, proptest/Kani |
| Reentrancy / duplicate receipt | Receipt PDA unique per `intent_id` | `payments.rs`, e2e indeterminate |
| Fake mint / vault substitution | Mint config, vault ATA seeds validated | `treasury.rs`, `layout.rs` |
| Token-2022 extension bypass | Extension gate at `add_mint` | integration tests with hook mints |
| Pause bypass for agents | `execute_payment` blocked; withdraw not | ADR-002, `lifecycle.rs` |
| Upgrade authority in CI | ADR-020 runbook; not in repo secrets | `upgrade-authority.md` |
| Layout drift | `tests/layout.rs` snapshot | CI fails on unintended byte moves |

---

## Residual risks (documented, not closed)

1. **Per-treasury pause** — pausing parent does not pause child treasuries (`org_chart.rs` negative test).  
2. **0.x upgrade key** — maintainer can replace program bytecode until trust phase advances.  
3. **MCP off-chain guard-rails** — optional; on-chain policy remains floor (`THREAT_MODEL.md` §3.5).  
4. **No `cargo-fuzz`** — ADR-008 item still open.

---

## References

- [Sealevel attacks wiki](https://github.com/coral-xyz/sealevel-attacks) (categories used as prompt)  
- `docs/spec/accounts-and-instructions.md`  
- `THREAT_MODEL.md`
