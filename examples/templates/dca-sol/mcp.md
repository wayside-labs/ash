# Why there is no agent MCP config here

This template has no model in the loop, so it ships no `ash-mcp` config. The cron
pays through `ash pay` with the same session key an MCP server would use, and the same
policy applies to both.

Do not add a full `ash` MCP server to a chat assistant "so it can report on the DCA".
`ASH_TOOLS=readonly` removes `ash_execute_payment` from what the model can call,
but the process still loads the session key (`check_payment` simulates a signed transaction),
so the assistant's host holds a key that can pay. For reporting, prefer operator surfaces:

```bash
examples/templates/dca-sol/scripts/dca-cron.sh status
pnpm ash audit export --out ~/.ash/dca --session <SESSION_PDA>
```

or the dashboard's `/metrics` page for the treasury, which reads receipts without a session key.

The environment the cron runs with, for comparison with the other templates' MCP blocks:

| Variable | Value |
|---|---|
| `ASH_RPC` | `https://api.devnet.solana.com` |
| `TREASURY` / `POLICY_NAME` | from `init` |
| `SESSION` / `SESSION_KEYPAIR` | from `session create --label dca` |
| `FEE_PAYER_KEYPAIR` | `~/.ash/dca/fee-payer-keypair.json` |
| `MINT` / `DESTINATION` / `AMOUNT` / `CADENCE` | the schedule |
