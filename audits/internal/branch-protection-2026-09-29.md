# Branch protection snapshot — `main`

**Date:** 2026-09-29  
**Repo:** `wayside-labs/ash` (private)

---

## Before this pass

| Setting | Value |
|---|---|
| Required checks | `rust`, `typescript`, `supply-chain`, `secrets`, `sast`, `idl matches the program` |
| Required approvals | **1** |
| Require CODEOWNERS review | **false** |
| Enforce for admins | **false** |
| Stale review dismissal | **true** |
| Conversation resolution | **true** |

---

## Change applied 2026-09-29

- **`require_code_owner_reviews` → true** so paths in `.github/CODEOWNERS` (`programs/`, policy crate, `idl/`, spec, security docs) request owner review on PRs.

**Unchanged intentionally:**

- **`required_approving_review_count` = 1** — single active maintainer; ADR-011 target of **2** applies when a second reviewer is onboarded (see `docs/runbooks/github-branch-protection.md`).
- **`enforce_admins` = false** — avoids blocking emergency maintainer operations until a second admin exists.

---

## How to verify

```bash
gh api repos/wayside-labs/ash/branches/main/protection \
  --jq '.required_pull_request_reviews'
```

Open a PR touching `programs/ash/src/lib.rs` — expect CODEOWNERS request for `@0xcf02`.

---

## Runbook

Full procedure and CLI to bump to 2 reviews: `docs/runbooks/github-branch-protection.md`.
