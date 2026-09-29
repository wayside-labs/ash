import type { DecisionSource } from "@agent-rails/contract";
import { buildPaymentDeniedAlert, type PaymentDeniedAlert } from "@agent-rails/contract/alerts";
import { postAlertWebhook } from "@agent-rails/sdk";
import type { ServerContext } from "./context.js";
import { emitAgentEvent } from "./ingest.js";

/**
 * Fire-and-forget denial alert: to `AGENT_RAILS_ALERT_WEBHOOK_URL` when configured, and to
 * the dashboard's ingest API when that is — independently, so either can be down.
 */
export function notifyPaymentDeniedWebhook(
  context: ServerContext,
  input: {
    session: string;
    intent: string;
    reason_code: PaymentDeniedAlert["reason_code"];
    source: DecisionSource;
  },
): void {
  const url = context.runtime.config.alertWebhookUrl;
  if (!url && !context.runtime.config.ingest) return;
  const payload = buildPaymentDeniedAlert({
    treasury: String(context.bound.treasury),
    policy: String(context.bound.policy),
    session: input.session,
    intent: input.intent,
    reason_code: input.reason_code,
    source: input.source,
  });
  if (url) void postAlertWebhook(url, payload).catch(() => {});
  emitAgentEvent(context, payload);
}
