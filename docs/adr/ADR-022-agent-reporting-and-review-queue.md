# ADR-022: Agents report to the dashboard; a person decides what they ask

**Status:** Accepted

## Context

Three things an agent-side process knows never reached the operator's dashboard:

- **Denials and low headroom** went from the MCP straight to one webhook URL, set per account
  in Settings. A hosted dashboard had no record of them, and the Settings toggles
  (`limitAlerts`, `emailNotifications`) were stored and read by nothing.
- **`review_required`** (ADR-013's `human-review` guard-rail) held a payment and wrote a line
  to a JSONL file on the agent's host. Nobody could approve it; the agent's only option was
  to stop. The outcome was terminal by accident, not by design.
- **"I need more budget"** — ADR-007 reserved `request_*` tools for exactly this, and none
  existed, so an agent blocked by a limit either gave up silently or, worse, tried smaller
  payments.

The dashboard also stores integrations and knowledge-base rows with no consumer. Each needs a
way for a process that has no browser session to talk to the dashboard.

## Options considered

- **A. Keep the direct webhook; add a second MCP → dashboard path only for reviews.** Two
  delivery paths for overlapping events, and the toggles would still bind nothing.
- **B. One ingest API, authenticated per workflow by a bearer token; the dashboard stores
  every event and fans it out to channels.** One path, one place the toggles apply, and a
  record the dashboard can show.
- **C. Put approvals on-chain now** (`MintLimit.approval_threshold`, reserved since v1).
  The right end state (plan 4.1), but a program upgrade and a new account type; it does not
  replace the need for an event path, and it should not block one.

## Decision

Option B, with C kept as the security boundary it will become.

1. **Ingest tokens.** One live token per workflow (`ingest_tokens`), looked up by sha256.
   The runner export issues one on first use and compiles it, with the dashboard's public
   ingest URL, into the env of the rails MCP and the knowledge MCP only — never a
   third-party server. Rotating retires the old token in the same write.
2. **Ingest routes** (`/api/ingest/*`) authenticate the bearer instead of calling
   `assertSameOrigin`. The caller is a process with no cookie a cross-site page could ride.
   `route-guard.test.ts` keeps them on an explicit list and fails if one stops
   authenticating. An event whose treasury differs from the workflow's is refused: a token
   speaks for one workflow.
3. **Events and channels.** Every event is stored (`agent_events`), then delivered to each
   enabled channel (`integrations`: webhook, Slack, Telegram, email) subscribed to its kind.
   `limitAlerts` off silences the two alerts; review and budget requests still go out,
   because silencing them would strand a payment. `emailNotifications` gates the email kind.
   The generic webhook receives the event JSON — for the two alerts, byte for byte the payload
   the MCP used to post — so existing receivers keep working. The single settings webhook is
   migrated into a channel and cleared, so nothing is delivered twice.
4. **Review queue, bound to the intent id.** `human-review` now emits
   `payment_review_required` with the full intent and returns `review_required` with
   `next_step: wait_for_approval`. A person approves or rejects it on `/reviews`. On the
   agent's next `execute_payment` with the same arguments, the MCP asks
   `GET /api/ingest/reviews/{intent_id}`: approved → the ordinary payment path, policy and
   all; rejected → `denied / REVIEW_REJECTED`; pending, missing or unreachable → held again.
   The binding is the intent id (ADR-012), which the payment's own arguments derive, so an
   approval cannot stretch to another amount, destination or reference — and needs no
   "consumed" flag, because the receipt settles an intent once. Approvals and pending
   reviews lapse after 24 hours.
5. **`agent_rails_request_limit_increase`.** A seventh agent tool, ADR-007's `request_*`
   pattern: it emits `limit_increase_requested` and changes nothing. Acknowledging it on
   `/reviews` changes nothing either; raising a limit is still `policy set` on the CLI or the
   Limits page. It is in readonly mode too — it grants nothing, and a planner that cannot pay
   may still say it needs budget.

## Consequences

- The review gate is still a mediation-plane control (ADR-013): a compromised agent host can
  skip the MCP and sign directly with the session key. The on-chain `approval_threshold`
  (plan 4.1) is what makes approval a boundary; this ADR is what gives it a queue and a UI.
- A dashboard outage holds reviewed payments (fail closed) and drops alerts (fail open), which
  is the same asymmetry ADR-013 applies to hooks.
- The ingest token is a secret of the same class as MCP env values: stored whole, never
  returned by a read route, only compiled into the runner export.
- `AGENT_TOOL_NAMES` has seven entries. The Vercel adapter and the tool-surface assertion move
  with it; `FORBIDDEN_TOOL_PATTERNS` is unchanged.
