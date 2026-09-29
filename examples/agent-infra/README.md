# Agent infra — our own vendors, MCPs and skills

Real counterparties for Agent Rails, so the platform is tested by agents buying things rather
than by payments to a mock address. Everything runs on devnet, locally or on the VPS.

```
        ┌──────────── agent (claude -p, Cursor, Claude Desktop) ─────────────┐
        │ skills: agent-rails-payments · vendor-checkout · oracle-pricing ·   │
        │         document-notary · compute-credits                           │
        └──┬──────────────────────┬──────────────────────┬────────────────────┘
   1 invoice │            2 pay     │                 3 redeem │
             ▼                      ▼                          ▼
  vendor-<x> MCP (no key)   agent-rails MCP (session key)   vendor-<x> MCP
             │                      │ execute_payment          │
             ▼                      ▼                          ▼
  ┌────────────────────┐   ┌──────────────────────┐   ┌────────────────────────┐
  │ vendor HTTP        │   │ agent_rails program  │   │ vendor reads the       │
  │ oracle  :4101      │   │ policy, allowlist,   │──▶│ IntentReceipt PDA it   │
  │ notary  :4102      │   │ windows → transfer + │   │ derives from the       │
  │ compute :4103      │   │ IntentReceipt        │   │ invoice, then delivers │
  └────────────────────┘   └──────────────────────┘   └────────────────────────┘
```

| Vendor | Sells | Payment shape it exercises |
|---|---|---|
| **oracle** | USD price quotes (CoinGecko, or `mock`) | many small per-call payments → window counters |
| **notary** | sha256 timestamp certificates | one payment per unique thing; free when already bought → dedupe |
| **compute** | prepaid credit packs for text jobs | few larger payments → per-tx limit, off-chain balance |

**Proof of payment is the on-chain receipt**, not anything the buyer sends. The invoice id is
the payment `reference`; the vendor recomputes the intent id (ADR-004) from
`{session, its own wallet, mint, amount, invoice id}`, derives the `IntentReceipt` PDA and
reads it. No receipt, no delivery; a receipt for a different invoice is at a different
address. Vendors hold only public keys.

**Vendor MCPs cannot pay.** Buying always crosses the `agent-rails` MCP, so every purchase is
subject to the policy — which is the thing under test.

## Pieces

| Path | What |
|---|---|
| `packages/vendors/` | the three HTTP vendors, their MCP servers, the scripted buyer (`agent-rails-vendor`) |
| `examples/skills/*/SKILL.md` | five skills — Claude Code format; paste into the dashboard's Skills page, or they load automatically in `run-agent.sh` |
| `examples/agent-infra/run-agent.sh` | runs one task headless with `claude -p`, only our MCPs + skills, no shell/file/web tools |
| `examples/agent-infra/tasks/*.md` | task prompts, including two adversarial ones |
| `deploy/vps/vendors/` | systemd units (vendors + scripted-buyer timer), Caddy block, `install.sh` |
| `docs/runbooks/agent-infra-manual-tests.md` | every manual test, in order |

## Local setup (devnet)

Prereqs: an initialised treasury (`pnpm agent-rails init …`, manifest in `.agent-rails/`),
`solana` CLI, `claude` CLI logged in.

```bash
pnpm build

# 1. Receiving wallets. Keep the keypairs: they are how you later spend what vendors earn.
mkdir -p ~/.agent-rails/vendors
for v in oracle notary compute; do
  solana-keygen new --no-bip39-passphrase -s -o ~/.agent-rails/vendors/$v-wallet.json
  # A wallet below the rent-exempt minimum cannot receive a 0.0001 SOL payment.
  solana airdrop 0.01 "$(solana-keygen pubkey ~/.agent-rails/vendors/$v-wallet.json)" --url devnet
done

# 2. Vendor env
cp examples/agent-infra/vendors.env.example examples/agent-infra/vendors.env
#    fill ORACLE_PAY_TO / NOTARY_PAY_TO / COMPUTE_PAY_TO with the pubkeys above

# 3. Operator: allowlist the vendors and give the agent a session (privileged — CLI only)
for v in oracle notary compute; do
  pnpm agent-rails dest add --label vendor-$v \
    --owner "$(solana-keygen pubkey ~/.agent-rails/vendors/$v-wallet.json)" --yes
done
pnpm agent-rails session create --label researcher --session-ttl 72 --yes

# 4. Agent env
cp examples/agent-infra/agents.env.example examples/agent-infra/agents.env
#    AGENT_RAILS_SESSION = the PDA printed above, AGENT_RAILS_SIGNER = its keypair path

# 5. Run
pnpm vendors                         # terminal 1: all three vendors
pnpm agent market-brief              # terminal 2: one agent task
pnpm vendor buy oracle --symbols SOL --session <PDA> -- --session-keypair <path>   # no model
```

## Importing into the platform

- **MCPs** — dashboard `/mcps`, add one per vendor: command `node`, args
  `["<repo>/packages/vendors/dist/cli.js", "mcp", "oracle"]`, env `ORACLE_URL`,
  `AGENT_RAILS_SESSION`. Scope it to the agent that buys. The per-agent runner-config export
  then contains the rails MCP and the vendor MCPs together.
- **Skills** — dashboard `/skills` → New: name and description from the `SKILL.md`
  frontmatter, content = the body. Enable per agent.

The dashboard chat stays read-only by design (zero tools, `--strict-mcp-config`); it will not
call these MCPs. Agents run through the exported config or `run-agent.sh`.

## VPS

`deploy/vps/vendors/install.sh` after `bootstrap.sh`; see the message it prints. Vendors are
public through the agent-rails tunnel, one hostname each (`https://vendor-oracle.ash.app.br`,
`vendor-notary`, `vendor-compute`), so a local agent can pay the VPS vendors: set
`ORACLE_URL=https://vendor-oracle.ash.app.br` etc. in `agents.env`.
