# packages/cli

The operator-facing CLI. `init` bootstraps a treasury, ceiling, policy, allowlist entry and
session, then emits the MCP config block.

## Rules specific to this package

- **This is the operator surface, not the agent surface.** Privileged commands belong here
  precisely because they must never appear in `packages/mcp/src/tools/`. Adding a command
  that raises a limit is correct here and a bug there.
- **Funding is a shortfall against a target, never a transfer.** Every `init` must be safe to
  re-run: the chain is read to decide which steps remain, and balances are topped up to
  `--deposit` / `--fee-budget` rather than moved unconditionally.
- **Resume is driven by on-chain account existence, not by the manifest.** The manifest under
  `<out>/<cluster>.json` records addresses for convenience; it can be stale or absent, and the
  chain cannot.
- **The manifest holds no key material.** Keys are written to their own `0600` files whose
  names match the `**/*keypair*.json` pattern `.gitignore` excludes.
- `add_mint` must land before `create_policy` — `policy_leq_ceiling` rejects a limit for a
  mint with no ceiling. `buildStages` encodes that ordering; the test asserts it. A mock mint
  must be initialised before `add_mint` reads it, and `mint_to` must follow `add_mint`,
  which is what creates the vault ATA it mints into.
- **Adding a mint to a treasury that already has a policy means `update_policy`, not
  `create_policy`.** `PolicyInput` is passed whole so the ceiling check can judge it as a
  unit; the policy is rewritten with every mint, never patched per field. The comparison is
  by mint set, so re-running never widens a limit an operator has since tightened.
- **The destination's token account is opened at setup.** Keeping
  `allow_create_destination_ata` false means the payment path cannot open accounts, so the
  CLI opens the destination's ATA itself with the idempotent ATA instruction.
- Human output goes to stderr so `--json` keeps stdout a clean pipe.
