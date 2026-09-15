# @agent-rails/mcp

stdio MCP server exposing Agent Rails payment tools to AI agents (Cursor, Claude Desktop, etc.).

The server binds to **one** agent session at startup and derives everything else — treasury,
policy, mints, destinations — from the chain. None of those are tool arguments, so a prompt
injection has nothing to point somewhere else. A caller chooses a destination *label*, a
human amount, a mint symbol, and a reference; trusted code resolves each of those against
on-chain state before anything is signed.

## Environment

| Variable | Required | Description |
|---|---|---|
| `AGENT_RAILS_RPC` | yes | Solana JSON-RPC URL |
| `AGENT_RAILS_SESSION` | yes | `AgentSession` PDA this process serves |
| `AGENT_RAILS_SIGNER` | yes\* | Path to session keypair JSON (64-byte array) |
| `AGENT_RAILS_REMOTE_SIGNER_URL` | yes\* | Signing service holding the session key off-process |
| `AGENT_RAILS_REMOTE_SIGNER_ADDRESS` | with URL | Public key the service signs with |
| `AGENT_RAILS_REMOTE_SIGNER_TOKEN` | no | Sent as `Authorization` to the signing service |
| `AGENT_RAILS_FEE_PAYER` | no | Fee-payer keypair JSON (defaults to the session key) |
| `AGENT_RAILS_MINT_ALIASES` | no | `USDC:EPjF…,USDT:Es9v…`. `SOL` is always known |
| `AGENT_RAILS_INTENT_TTL_SECONDS` | no | Replay window for each intent (default 90, program allows 5–3600) |
| `AGENT_RAILS_CONFIRM_TIMEOUT_MS` | no | Confirmation wait before an outcome is treated as unknown (default 60000) |
| `AGENT_RAILS_RESOLVE_ATTEMPTS` | no | Receipt polls when resolving an unknown outcome (default 8) |
| `AGENT_RAILS_RESOLVE_INTERVAL_MS` | no | Delay between those polls (default 750) |
| `AGENT_RAILS_SECURITY` | no | Guard-rail preset: `sandbox`, `balanced` (default), `strict` |
| `AGENT_RAILS_MAX_PAYMENTS_PER_MINUTE` | no | Overrides the preset's velocity cap |
| `AGENT_RAILS_MAX_CONCURRENT` | no | Overrides payments in flight at once |
| `AGENT_RAILS_SINK` | no | JSONL path for the operator's payment record |

\* Either a local keypair or a remote signer. With a remote signer the private key never
enters the process that parses tool arguments.

Startup fails, loudly and before the transport connects, if the session does not exist, the
signer is not that session's `session_key`, the session is revoked or expired, the policy is
in `Allowlist` mode with no registered destinations, or the allowlist cannot be read. A
server that cannot establish what it is for should not be able to pay anyone.

## Run locally

```bash
pnpm --filter @agent-rails/mcp build

AGENT_RAILS_RPC=https://api.devnet.solana.com \
AGENT_RAILS_SESSION=<AgentSession PDA> \
AGENT_RAILS_SIGNER=~/.config/agent-rails/session-keypair.json \
node packages/mcp/dist/cli.js
```

## Cursor / Claude Desktop config

```json
{
  "mcpServers": {
    "agent-rails": {
      "command": "node",
      "args": ["/path/to/agent-rails/packages/mcp/dist/cli.js"],
      "env": {
        "AGENT_RAILS_RPC": "https://api.devnet.solana.com",
        "AGENT_RAILS_SESSION": "<AgentSession PDA>",
        "AGENT_RAILS_SIGNER": "/path/to/session-keypair.json",
        "AGENT_RAILS_SINK": "/var/log/agent-rails/payments.jsonl"
      }
    }
  }
}
```

## Tools

| Tool | Kind | Description |
|---|---|---|
| `agent_rails_get_session` | read | The bound session: expiry, revocation, seq, per-mint spend counters |
| `agent_rails_get_policy` | read | The bound policy: limits, destination mode, memo requirement |
| `agent_rails_list_destinations` | read | Labels this session may pay |
| `agent_rails_get_payment_status` | read | Did an intent settle? Authoritative, via the receipt PDA |
| `agent_rails_check_payment` | dry run | Resolve and simulate without sending |
| `agent_rails_execute_payment` | write | Pay a labelled destination |

Nothing here loosens a constraint. `create_session`, `update_policy`, allowlist edits,
`pause`/`unpause` and `withdraw` are absent by design and asserted absent in CI
(`src/tools/tool-surface.test.ts`); operator actions live in the CLI.

## Payment arguments

```jsonc
{
  "destination_ref": "acme-hosting",   // a label from list_destinations
  "amount": "12.50",                   // human units; scaled by the mint's on-chain decimals
  "mint_ref": "USDC",                  // symbol, or an address configured on the treasury
  "reference": "INV-2026-0041",        // what this settles; makes the payment idempotent
  "memo": "optional"
}
```

`reference` is load-bearing. The `intent_id` is derived from the session, destination, mint,
amount and reference, so retrying the same payment produces the same `IntentReceipt` PDA and
the program refuses it. Paying the same vendor the same amount for a different invoice means
a different reference, and is a different payment.

## Outcomes

Every response carries `outcome`, `intent_id` and `receipt` — denials included.

| Outcome | Meaning | What to do |
|---|---|---|
| `settled` | The transfer is on-chain | Nothing |
| `denied` | A rule refused it; nothing moved | Read `reason_code`; change something if appropriate |
| `indeterminate` | Broadcast, unconfirmed | Call `agent_rails_get_payment_status`. **Do not retry** |

After an indeterminate outcome the session is quiesced: further payments are refused with
`SESSION_QUIESCED` until the receipt is observed. This is deliberate. A slow RPC node is
otherwise enough to make an agent pay twice.

## Guard-rails

The program is the floor: pause, session liveness, the ceiling, the allowlist, the limits,
and the receipt. Nothing below can move it. What is configurable is how much this server
refuses *before* the chain is asked — so a relaxed preset does not grant permission, it
moves a refusal from here to the validator, or gives it up in favour of the floor underneath.

```
AGENT_RAILS_SECURITY=sandbox    # prototyping: raw addresses, no bands, logs returned
AGENT_RAILS_SECURITY=balanced   # default: labels only, hooks fail closed, memo over 100
AGENT_RAILS_SECURITY=strict     # every band escalates; over 1000 waits for a person
```

Anything richer than a preset is a config object, because hooks and value bands do not
survive being flattened into environment strings:

```ts
import { createMcpServer } from "@agent-rails/mcp";

createMcpServer({
  runtime,
  signers,
  bound,
  security: {
    preset: "strict",
    posture: {
      value: {
        bands: [
          { above: "100", require: ["memo", "dry-run-first"] },
          { mint: "USDC", above: "5000", require: ["human-review"] },
        ],
      },
    },
    hooks: [
      {
        name: "open-invoice",
        timeoutMs: 1_500,
        evaluate: async ({ reference }) =>
          (await invoices.isOpen(reference))
            ? { allow: true }
            : { allow: false, message: `No open invoice for ${reference}.` },
      },
    ],
  },
});
```

| Knob | Effect | If it fails | What still catches the mistake |
|---|---|---|---|
| `destinations.policy` | `labels-only` refuses raw addresses here; `open` leaves them to the chain | Denies | The program refuses an unregistered payee under an `Allowlist` policy |
| `destinations.nearMissDistance` | A label this close to a registered one is refused as impersonation | Denies | Nothing: an exact miss is already a denial, this only changes the reason code |
| `value.bands` | `memo`, `dry-run-first`, `hooks`, `human-review` above an amount | Denies, or `review_required` | `per_tx_max` and the window limits |
| `hooks.onUnavailable` | `deny` (default) or `allow` on hook timeout | As configured | Hooks are additive restrictions; losing one falls back to the on-chain limits |
| `velocity.*` | Rate and concurrency | Denies | The program evaluates each payment against committed counters |
| `outcomes.quiesceOnIndeterminate` | Stop paying after an unresolved outcome | Denies | The derived `intent_id`: a retry hits the same receipt and is refused on-chain |
| `disclosure.includeSimulationLogs` | Return program logs to the caller | n/a | Nothing — leave it off outside local development |

The server prints its posture and any incoherence with the chain to stderr at startup, so
`destinations.policy: "open"` against an allowlisted policy says so once instead of
producing denials nobody can explain.

Six properties are not configurable at all, because nothing underneath would catch the
mistake — derived intent ids, strict tool arguments, startup binding, integer amount
conversion, server-authored expiry, and never reporting an unknown outcome as a denial.
They are listed in `IMMUTABLE_GUARANTEES` in `@agent-rails/contract`.

Schemas live in `@agent-rails/contract`.
