# Internal pre-audit checklist

**Date:** 2026-09-29  
**Git ref:** `cd2e6a5` (branch `feat/vps-stage1-dashboard` at time of run; merge to `main` before treating as org baseline)  
**Program id:** `4qjD6vSgYa3oBKde3KVzsH8oCcP9BKsirX1xtD5SS6BS`  
**Trust phase:** `0.x` (devnet, unaudited) per `README.md`  
**Signer:** maintainer self-review — not a third-party audit

Evidence commands run on 2026-09-29 with `VERIFY_STRICT=1` unless noted.

---

## THREAT_MODEL.md §5

| Item | Status | Evidence / notes |
|---|---|---|
| Threat model vs instruction set | **Done** | Cross-walk: 23 instructions in spec §2 match IDL; roles and MCP privilege split in `THREAT_MODEL.md` §2–3. See `sealevel-attacks-review-2026-09-29.md`. |
| Sealevel-attacks checklist | **Done (internal)** | Structured review recorded in `sealevel-attacks-review-2026-09-29.md`; not a substitute for external audit. |
| `scripts/verify.sh rust` | **Pass** | fmt, clippy, overflow-checks, `cargo test --workspace`, policy llvm-cov ≥95%. Requires `cargo build-sbf` for both `ash` and `test_pda_relay` first. |
| `scripts/verify.sh kani` | **Pass** | 13 harnesses, Kani 0.68.0 per `scripts/verify.sh`. |
| `scripts/verify.sh e2e` | **Pass** | `@ash/e2e` + `@ash/mcp test:e2e` (Surfpool). |
| Surface freeze / codegen drift | **Process** | `pnpm codegen:check` in CI `typescript` job; IDL workflow `idl matches the program`. |
| Upgrade authority vs README | **Documented** | ADR-020: offline key `F2zW3818bfDpAapLo9Z9mgfttYjkkK23JAnkpnWNcSmP` per `docs/runbooks/upgrade-authority.md`. Re-run `ash doctor --rpc https://api.devnet.solana.com` before release tags. |
| Findings under `audits/` | **Done** | This file + Sealevel review. |

---

## ADR-011 gaps (still open)

| Item | Status |
|---|---|
| Professional third-party audit | **Not started** — no report in `audits/external/` |
| Bug bounty (paid) | **Inactive** in `0.x` per `SECURITY.md` |
| `cargo-fuzz` on policy crate | **Not implemented** (ADR-008 deferred; mutants + Kani cover part of the space) |
| Squads 3-of-5 + 72 h notice | **Future** — `1.0.0-beta` |
| Two approving reviews on `main` | **Partial** — see `branch-protection-2026-09-29.md` |

---

## CI reference (required on `main`)

`rust`, `typescript`, `supply-chain`, `secrets`, `sast`, `idl matches the program` — nightly: `e2e`, `kani`, `mutants`, `ui`.

---

## Next review trigger

- Any change to `programs/ash` account layouts or instruction set  
- Before Colosseum / grant / investor diligence that claims “audited”  
- Before `1.0.0-beta` mainnet deploy
