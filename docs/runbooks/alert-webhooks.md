# Alert webhooks (F8 / P1-03)

Generic HTTPS webhooks for operator alerts. Payload shapes live in
`@ash/contract/alerts` (`schema_version: 1`).

## Events

| `kind` | When | Emitter |
| --- | --- | --- |
| `payment_denied` | MCP refuses **`execute_payment`** (`reason_code` + `source`) | MCP when `ASH_ALERT_WEBHOOK_URL` is set |
| `headroom_low` | Rolled **policy window** spend leaves less than 20% headroom (≥80% of `short_window_max` / `long_window_max` consumed) | `pnpm alert-watch` poll loop |

`check_payment` dry-runs do **not** emit webhooks — only failed `execute_payment` paths do.

A **Slack** channel receives `{ "text": ... }`, a **Telegram** channel a `sendMessage`, and an
**email** channel a message through Resend (`RESEND_API_KEY`, `ALERT_EMAIL_FROM` on the
dashboard server). A generic **webhook** channel, or the direct `ASH_ALERT_WEBHOOK_URL`,
receives the ASH-shaped JSON.

## Configuration

**Dashboard channels (ADR-022, the default)** — Settings → **Notification channels**. Add a
webhook, Slack, Telegram or email channel and pick the event kinds it receives. The runner
export gives the agent's MCP the dashboard's ingest URL and the workflow's token; the MCP
posts events there and the dashboard delivers them to every subscribed channel, honouring
the **Limit alerts** and **Email notifications** switches. A generic webhook channel receives
exactly the payload below. The old single *Alert webhook URL* setting was migrated into a
webhook channel on upgrade.

**Direct, without a dashboard** — set `ASH_ALERT_WEBHOOK_URL` on the MCP yourself; it
posts `payment_denied` to that URL with no dashboard involved.

**Environment**

- `ASH_ALERT_WEBHOOK_URL` — used by MCP and `alert-watch` when flags are omitted.

**Headroom watcher**

```bash
pnpm build
pnpm alert-watch \
  --rpc "$ASH_RPC" \
  --treasury <treasury> \
  --policy <policy> \
  --webhook-url "$ASH_ALERT_WEBHOOK_URL" \
  --interval 30
```

Run beside `guardian-watch` (P1-01) in the same host process if you want pause + notify; they
share window rollover via `scripts/guardian-roll-window.ts`.

## Limitation (no hosted indexer)

Alerts are **local to whatever process you run**:

- **Denials** only fire for payments that flow through an MCP server configured with the webhook
  URL. Denials another runner or an old session produced are invisible.
- **Headroom** only updates on the `alert-watch` poll interval for the treasury/policy pair you
  started. There is no chain-wide fan-out until `@ash/indexer` exists.

Each `alert-watch` process dedupes repeated breaches in memory until restart; it does not replace
a durable alert state store.
