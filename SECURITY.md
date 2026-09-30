# Security policy

Agent Rails holds **custody logic** on Solana. Treat vulnerability reports as sensitive until fixed and disclosed.

This policy implements ADR-011 (audit and bug bounty) at the **0.x** trust phase. Bounty amounts scale with deployment phase and TVL; details below are placeholders until mainnet-beta.

---

## Supported versions

| Phase | Networks | Program upgrades | Security fixes |
|---|---|---|---|
| **0.x (current)** | devnet only | Single offline upgrade authority | Best effort on `main`; tags carry `.so` + hash |
| 1.0.0-beta | mainnet (limited TVL) | Squads 3-of-5 + time lock + notice | Same; notice may be shortened only per `GOVERNANCE.md` |
| 1.0.0+ | mainnet | Frozen program id | Critical fixes via new program id + migration (v2 model) |

Do not deploy funds you cannot lose on **0.x**. The README trust table is authoritative.

---

## Reporting a vulnerability

**Preferred:** [GitHub private vulnerability reporting](https://github.com/wayside-labs/agent-rails/security/advisories/new) for `wayside-labs/agent-rails`.

**Alternative:** email the maintainers listed in the repository commit history (do not open a public issue for exploit details).

Include:

- Description and impact (funds at risk, privilege escalation, audit break)  
- Affected component (`programs/agent_rails`, `crates/agent-rails-policy`, MCP, SDK, dashboard)  
- Reproduction steps or proof-of-concept  
- Suggested fix, if any  

### What we commit to

| Step | Target |
|---|---|
| Acknowledgement | 3 business days |
| Severity assessment | 10 business days |
| Fix or mitigation plan | Depends on severity; critical custody issues prioritized |
| Coordinated disclosure | Agreed with reporter; default 90 days max |

We may ask for a short extension for complex on-chain fixes. We credit reporters in the advisory unless they prefer anonymity.

---

## Out of scope

- Attacks requiring compromise of the reporter's own keys or RPC endpoints  
- Social engineering of individual operators  
- Denial of service against public RPC without impact on on-chain safety properties  
- Issues in third-party dependencies without a demonstrated impact on Agent Rails custody  
- Hosted dashboard deployments you do not operate (report to that operator; our scope is the open-source tree)

---

## Bug bounty (staged)

No paid bounty is active in **0.x**. Before **1.0.0-beta** on mainnet, this section will be updated with:

- Scope (program id, commit or release tag)  
- Severity rubric (critical / high / medium)  
- Maximum payout tied to on-chain TVL guidance from ADR-011  
- Safe harbor for good-faith research on devnet and announced testnets  

Professional audit reports belong in `audits/`; they are not bounty submissions.

---

## Secure development

Contributors: read `CONTRIBUTING.md` (agent no-go zones), `THREAT_MODEL.md`, and `GOVERNANCE.md`. Custody changes require review per `CODEOWNERS`.

Operators: run `agent-rails doctor`, verify program hash (`scripts/program-hash.sh compare`), keep upgrade authority off CI (ADR-020), and use guardian pause for incident response (`docs/runbooks/guardian-watch.md`).

---

## License

Code is Apache-2.0. Security reports and audit artifacts may carry their own terms when published under `audits/`.
