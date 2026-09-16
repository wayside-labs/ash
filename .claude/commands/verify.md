---
description: Run the full local gate — the same checks CI runs, in the same order — before pushing.
---

Run `scripts/verify.sh` and report what failed.

That script is the single definition of the gate; `.github/workflows/ci.yml` calls it by
group (`rust`, `ts`), so passing here means CI passes for the same reasons. Do not
re-implement the list of checks here or run them individually — a second copy is how the
local gate and CI start disagreeing.

Narrow it when the change is one-sided: `scripts/verify.sh rust` or `scripts/verify.sh ts`.

It runs every check before reporting rather than stopping at the first failure, so fix the
whole list it prints rather than re-running after each fix.

Three CI jobs are deliberately outside it — cargo-deny, gitleaks and semgrep — because they
need tools a normal checkout does not have. If the change touches dependencies, run
`cargo deny check` as well.
