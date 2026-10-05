# Runbook — dashboard manual smoke (10 steps)

**Scope:** a human walkthrough of the operator dashboard in a **production build**
(`next build && next start`), not `next dev`. Use this before recording the Colosseum demo
and once per release candidate.

**Environment:** local JSON store (`~/.ash/dashboard.json`) or the hosted Vercel
deploy with Supabase configured. Chain calls need a devnet RPC; wallet connect needs a
browser extension or the dashboard’s dev wallet flow.

**Automated overlap:** `packages/dashboard/e2e/smoke.spec.ts` covers “every sidebar route
renders” with stubs. This runbook is the manual pass with a real wallet and optional RPC.

---

## Setup (once per session)

```bash
cd <repo root>
pnpm install && pnpm build
pnpm --filter @ash/dashboard build
pnpm --filter @ash/dashboard start   # http://127.0.0.1:3000
```

Point `ASH_RPC` / dashboard settings at `https://api.devnet.solana.com` if you exercise
on-chain reads. For a read-only pass, stubs are not required — pages should still mount.

---

## Checklist

Record **PASS / FAIL** and the date in the submission notes.

| # | Step | Expected |
|---|------|----------|
| 1 | Open `/` with a wallet connected | Home loads: chat placeholder visible, workflow panel heading visible, no blank screen or React error overlay |
| 2 | Sidebar → **Workflows** (`/workflows`) | Page heading renders; canvas or empty state loads without console errors |
| 3 | Sidebar → **Treasury** (`/treasury`) | Vault balances or empty state; deposit/transfer controls present (do not move mainnet funds) |
| 4 | Sidebar → **Limits** (`/limits`) | Policy ceilings and session limits visible for the linked treasury |
| 5 | Sidebar → **Agents** (`/agents`) | Agent list or empty state; create/edit affordances render |
| 6 | Sidebar → **Settings** (`/settings`) | RPC/treasury linkage fields editable; save does not throw |
| 7 | **Metrics** (`/metrics` if linked in nav) or treasury metrics widgets | Charts/tables render or show explicit “no data” — not an infinite spinner |
| 8 | **Account** (`/account`) | Sign-in providers listed; Google button does not error on click (OAuth may redirect) |
| 9 | Toggle theme or locale if exposed in **Settings** / profile | UI updates without full reload crash |
| 10 | Hard refresh on **Treasury**, then navigate away and back | State recovers; no hydration error in the browser console |

---

## Execution log

| Date | Operator | Build (git sha) | Result | Notes |
|------|----------|-----------------|--------|-------|
| 2026-09-26 | release engineer | local @ HIG-01 | PASS (automated) | `pnpm --filter @ash/dashboard build` offline OK; `VERIFY_STRICT=1 scripts/verify.sh ui` exercises production `next build && next start` and `e2e/smoke.spec.ts` (sidebar routes). Sign this row again after a human walkthrough before recording. |

---

## Failure triage

| Symptom | Likely cause |
|---------|----------------|
| White screen on every route | Production build not run, or missing `pnpm build` of workspace packages |
| Fonts fallback to system UI only | `@fontsource/*` not installed — run `pnpm install` |
| Treasury stuck loading | RPC URL wrong or rate-limited; check network tab on `/api/solana/*` |
| OAuth redirect error | Supabase redirect URL mismatch — see `docs/runbooks/deploy-vercel.md` |
