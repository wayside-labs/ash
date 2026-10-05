# @ash/vendors

Three demo vendors that sell to agents over ASH — **oracle** (price quotes),
**notary** (hash timestamps), **compute** (prepaid credits) — plus one stdio MCP server per
vendor and a scripted buyer. Private package: a test counterparty, not a product.

```bash
agent-rails-vendor serve <oracle|notary|compute|all>   # HTTP, ports 4101-4103
agent-rails-vendor mcp <vendor>                        # stdio MCP (no key, cannot pay)
agent-rails-vendor buy <vendor> -- <ash pay flags>
```

Proof of payment is the `IntentReceipt` PDA the vendor derives from its own invoice
(`src/verify.ts`); see `examples/agent-infra/README.md` for the whole setup and
`docs/runbooks/agent-infra-manual-tests.md` for the manual test plan.
