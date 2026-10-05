# Runbook — branch protection on `main`

Implements **GOVERNANCE.md** §3 and **ADR-011** (two reviews on custody paths; ADR-008 gates on every merge).

This is repository **settings**, not code. Apply once per org/repo; adjust when CI job names change.

---

## Target state

| Rule | Setting |
|---|---|
| Require a pull request before merging | On |
| Required approvals | **2** (or **1** until a second maintainer is active — document the exception in `audits/internal/`) |
| Dismiss stale pull request approvals when new commits are pushed | On |
| Require review from Code Owners | On (`CODEOWNERS` covers `programs/`, policy crate, `idl/`, spec) |
| Require status checks to pass | On — at minimum the **`CI`** workflow jobs that run on every PR |
| Require branches to be up to date before merging | On |
| Do not allow bypassing the above settings | On for admins (recommended once team >1) |
| Restrict who can push to matching branches | Optional: only maintainers; everyone else via PR |

Nightly workflows (`e2e`, `kani`, `mutants`, `ui`) stay **out** of required checks unless you accept that `main` can be red on schedule-only jobs.

---

## Apply with GitHub CLI

From a machine with `gh auth login` and admin on `wayside-labs/ash`:

```bash
# Inspect current rules (404 = none configured)
gh api repos/wayside-labs/ash/branches/main/protection

# Example: PR required, 2 reviews, code owners, strict status checks.
# Replace context names with what GitHub lists under Settings → Branches → Required checks
# after at least one successful CI run on a PR (often "rust", "typescript", "supply-chain").
gh api \
  --method PUT \
  repos/wayside-labs/ash/branches/main/protection \
  -f required_status_checks='{"strict":true,"contexts":["rust","typescript","supply-chain"]}' \
  -f enforce_admins=true \
  -f required_pull_request_reviews='{"required_approving_review_count":2,"dismiss_stale_reviews":true,"require_code_owner_reviews":true}' \
  -f restrictions=null \
  -f required_linear_history=false \
  -f allow_force_pushes=false \
  -f allow_deletions=false
```

If only one maintainer is available temporarily, use `required_approving_review_count":1` and record the date in `audits/internal/`.

**UI equivalent:** Settings → Branches → Add rule for `main` → match the table above.

---

## Verify

1. Open a test PR touching `programs/` — CODEOWNERS should request `@0xcf02`.
2. Merge should be blocked until checks pass and reviews are satisfied.
3. Direct push to `main` should fail (lefthook `no-direct-main` is local only; server rule is authoritative).

---

## Related

- `.github/CODEOWNERS`
- `.github/workflows/ci.yml`
- `GOVERNANCE.md` §3
