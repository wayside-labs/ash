# Alert webhooks (F8 / P1-03)

Generic HTTPS webhooks for operator alerts. Payload shapes live in
`@agent-rails/contract/alerts` (`schema_version: 1`).

## Events

| `kind` | When | Emitter |
| --- | --- | --- |
| `payment_denied` | MCP refuses **`execute_payment`** (`reason_code` + `source`) | MCP when `AGENT_RAILS_ALERT_WEBHOOK_URL` is set |
| `headroom_low` | Rolled **policy window** spend leaves less than 20% headroom (≥80% of `short_window_max` / `long_window_max` consumed) | `pnpm alert-watch` poll loop |

`check_payment` dry-runs do **not** emit webhooks — only failed `execute_payment` paths do.

Slack incoming webhooks accept a raw JSON POST body; the payload is Agent Rails shaped (not
`{ "text": "..." }` alone). Point Settings → **Alert webhook URL** at your receiver or Slack
URL, then re-export the workflow MCP config so the agent runner picks up
`AGENT_RAILS_ALERT_WEBHOOK_URL`.

## Configuration

**Dashboard (Settings → Alert webhook URL)** — persisted in `dashboard.json` / Supabase
`settings.alert_webhook_url`. The runner export injects the URL into `agent-rails-mcp` env.

**Environment**

- `AGENT_RAILS_ALERT_WEBHOOK_URL` — used by MCP and `alert-watch` when flags are omitted.

**Headroom watcher**

```bash
pnpm build
pnpm alert-watch \
  --rpc "$AGENT_RAILS_RPC" \
  --treasury <treasury> \
  --policy <policy> \
  --webhook-url "$AGENT_RAILS_ALERT_WEBHOOK_URL" \
  --interval 30
```

Run beside `guardian-watch` (P1-01) in the same host process if you want pause + notify; they
share window rollover via `scripts/guardian-roll-window.ts`.

## Limitation (no hosted indexer)

Alerts are **local to whatever process you run**:

- **Denials** only fire for payments that flow through an MCP server configured with the webhook
  URL. Denials another runner or an old session produced are invisible.
- **Headroom** only updates on the `alert-watch` poll interval for the treasury/policy pair you
  started. There is no chain-wide fan-out until `@agent-rails/indexer` exists.

Each `alert-watch` process dedupes repeated breaches in memory until restart; it does not replace
a durable alert state store.
