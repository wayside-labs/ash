# Agent Rails — threat model

**Status:** internal pre-audit baseline (ADR-011 point 3).  
**Scope:** on-chain program `agent_rails`, off-chain operator surfaces (CLI, dashboard), agent surfaces (MCP, SDK).  
**Not in scope:** hosted Supabase tenancy hardening beyond ADR-017, third-party RPC providers, end-user workstation compromise.

This document names assets, actors, and trust boundaries so audits and reviews have a shared vocabulary. It is not a penetration-test report.

---

## 1. Assets

| Asset | Where it lives | Impact if lost or corrupted |
|---|---|---|
| Treasury vault balances (SOL, SPL) | Program-owned vault ATAs / `sol_vault` | Direct fund loss up to policy and ceiling |
| Owner authority | `Treasury.owner` | Withdrawal, ceiling changes, mint config, pause/unpause |
| Operator authority | `Treasury.operator` | Policy and sessions within ceilings; cannot withdraw or loosen ceilings |
| Guardian keys | `Treasury.guardians[]` | Pause only (ADR-002); cannot unpause, withdraw, or edit policy |
| Session keys | `AgentSession.session_key` | Sign `execute_payment` within an active session's policy |
| Upgrade authority | Loader `ProgramData` | Replace program logic under every treasury using this program id |
| Audit integrity | Per-session `audit_head`, events, `IntentReceipt` | Forged or dropped history breaks third-party verification |
| Operator secrets | `~/.agent-rails`, dashboard env, session key files | Forged operator actions or leaked agent keys |

---

## 2. Trust boundaries

```
Owner / Operator / Guardian  ──►  CLI, dashboard  ──►  Solana RPC  ──►  agent_rails program
Agent runtime  ──►  MCP (payment tools only)  ──►  SDK  ──►  same RPC  ──►  program
```

- **Enforcement boundary:** spend limits, allowlists, idempotency, pause, and audit updates are decided **only** in the program. MCP guard-rails and SDK prechecks are defense in depth; a bypass must still fail on-chain unless the program is wrong.
- **Privilege boundary:** MCP must not expose operator instructions (ADR-007, ADR-021). CLI and dashboard own policy, sessions, pause, withdraw.
- **Upgrade boundary:** whoever holds upgrade authority can change bytecode for all treasuries on that program id. Trust phases in `README.md` describe how that authority is staged down (ADR-011).

---

## 3. Threat actors and scenarios

### 3.1 Compromised agent (session key or MCP host)

**Goals:** drain treasury, pay attacker destinations, retry until limits exhausted.

**Controls:**

- Per-tx, windowed, and lifetime limits; destination allowlist; session expiry and revocation.
- Derived `intent_id` + `IntentReceipt` idempotency (ADR-004) — retries cannot double-pay the same reference.
- Indeterminate outcomes quiesce the MCP session until status is resolved (ADR-012).
- Agent cannot call instructions that raise limits or withdraw.

**Residual risk:** attacker spends up to the **minimum of** active policy limits and remaining window budgets before pause. That is the designed blast radius.

### 3.2 Malicious or coerced operator

**Goals:** raise effective spend without owner consent, smuggle destinations.

**Controls:**

- Operator cannot exceed owner ceilings (partial order on limits).
- Allowlist mode requires registered destinations; operator cannot set `allow_any_destination`.
- Owner can pause, revoke sessions, withdraw, remove guardians, and replace operator.

**Residual risk:** a malicious operator can spend up to ceilings and allowlisted destinations until the owner acts.

### 3.3 Malicious maintainer (upgrade authority holder)

**Goals:** ship malicious program logic, steal vault funds across treasuries.

**Controls (phased):**

- **0.x (now):** single offline upgrade key; README states unaudited devnet-only use.
- **1.0.0-beta:** Squads multisig, time lock, public notice (ADR-011).
- **1.0.0:** renounced upgrade authority after professional audit.

**Residual risk:** until renounce, upgrade authority is a super-user. Users must verify `agent-rails doctor` and program hash (`scripts/program-hash.sh`).

### 3.4 External attacker (network, RPC, indexer)

**Goals:** double-spend via confused deputy, censor events, phishing operators.

**Controls:**

- Receipt-first payment status; hash chain verification in SDK/CLI (`verifyAuditChain`).
- MCP does not treat unknown outcomes as `denied` (retry safety).
- Dashboard hosted mode: client-held signing keys (ADR-018); RPC URLs treated as secrets in dev tooling.

**Residual risk:** RPC withholding can cause operational `indeterminate` states; funds should not move twice if receipts and quiesce behave as designed. Long-retention audit requires a future indexer (ADR-006).

### 3.5 Prompt injection via MCP tools

**Goals:** trick agent into paying wrong destination or amount.

**Controls:**

- MCP binds one session at startup; destinations are labels resolved on-chain, not free-form addresses (in default posture).
- Tool surface snapshot tests; no withdraw or policy tools on MCP.

**Residual risk:** an agent can still pay any **allowed** destination up to policy limits. Human review bands (MCP security presets) are optional operator configuration.

---

## 4. Program-specific notes

| Topic | Threat | Mitigation / status |
|---|---|---|
| Native allowance (ADR-014) | Session key calls native `transferFixed` and skips policy | Delegation uses treasury PDA as `delegatee`; session key cannot sign native CPI |
| Pause scope | Incident response assumes tree-wide stop | Pause is **per treasury**; pausing parent does not pause children (`org_chart` test documents gap) |
| Layout changes | Silent breaking change for clients | `tests/layout.rs` + spec §3; CODEOWNERS on `programs/` and `idl/` |
| Token-2022 extensions | Hook / confidential transfer bypass | Rejected mints at `add_mint` gate (ADR-010) |

---

## 5. Pre-audit checklist (internal)

Use before engaging a professional auditor (ADR-011):

- [ ] This threat model reviewed against current instruction set (`docs/spec/accounts-and-instructions.md`).
- [ ] Sealevel-attacks checklist run on `programs/agent_rails` (account validation, signer checks, CPI targets).
- [ ] `scripts/verify.sh rust` green (fmt, clippy, tests, CU baselines, policy coverage).
- [ ] `scripts/verify.sh kani` green where `cargo-kani` is available.
- [ ] `scripts/verify.sh e2e` green (SDK + MCP handler paths on Surfpool).
- [ ] Surface freeze: no new instructions without ADR + spec + IDL codegen drift gate.
- [ ] Upgrade authority and trust-phase claims match `README.md` and on-chain `doctor` output.
- [ ] Findings recorded under `audits/` (see `audits/README.md`).

---

## 6. References

- `ARCHITECTURE.md` — roles, payment flow, invariants  
- `docs/adr/ADR-002-role-separation.md`, `ADR-004`, `ADR-006`, `ADR-011`, `ADR-014`, `ADR-020`  
- `docs/runbooks/guardian-watch.md`, `docs/runbooks/upgrade-authority.md`  
- `SECURITY.md` — vulnerability disclosure  
- `GOVERNANCE.md` — who approves changes to this model
