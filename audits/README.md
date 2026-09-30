# Audits

Storage for **security review artifacts** (ADR-011). Nothing in this directory implies a completed professional audit unless a dated report says so.

---

## Layout

```
audits/
├── README.md                 # this file
├── internal/                 # pre-audit checklists, self-review notes (no secrets)
│   └── .gitkeep
└── external/                 # third-party reports when published
    └── .gitkeep
```

| Path | Contents |
|---|---|
| `internal/` | Sealevel checklist results, threat-model walkthrough notes, CI evidence pointers |
| `external/` | PDF or markdown reports from paid audits; include program id, commit or tag, date |

Do **not** commit exploit payloads, live key material, or customer data.

---

## Publishing an external report

Each report should name:

1. Auditor and date  
2. Program id and exact git tag / commit hash  
3. Scope (instructions, crates, off-chain surfaces in scope)  
4. Severity summary and remediation status  
5. Link to on-chain program hash at time of review (`scripts/program-hash.sh onchain`)

After publication, update `README.md` trust language only if findings and trust phase warrant it.

---

## Current status

| Review | Status |
|---|---|
| Internal pre-audit (`THREAT_MODEL.md` checklist) | **Recorded 2026-09-29** — `internal/2026-09-29-pre-audit-checklist.md` (self-review on branch ref noted there) |
| Sealevel-oriented internal review | **Recorded 2026-09-29** — `internal/sealevel-attacks-review-2026-09-29.md` |
| Branch protection / CODEOWNERS | **Partial** — `internal/branch-protection-2026-09-29.md`; 1 review until second maintainer |
| Professional audit | **Not performed** |
| Competitive / second opinion | **Not performed** |

---

## Related

- `THREAT_MODEL.md`  
- `SECURITY.md`  
- `GOVERNANCE.md`  
- `docs/adr/ADR-011-governance-and-release.md`
