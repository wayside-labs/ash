import type { DecisionSource } from "@agent-rails/contract";
import { buildPaymentDeniedAlert, type PaymentDeniedAlert } from "@agent-rails/contract/alerts";
import { postAlertWebhook } from "@agent-rails/sdk";
import type { ServerContext } from "../context.js";

/** Fire-and-forget denial alert when `AGENT_RAILS_ALERT_WEBHOOK_URL` is configured. */
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
  if (!url) return;
  const payload = buildPaymentDeniedAlert({
    treasury: String(context.bound.treasury),
    policy: String(context.bound.policy),
    session: input.session,
    intent: input.intent,
    reason_code: input.reason_code,
    source: input.source,
  });
  void postAlertWebhook(url, payload).catch(() => {});
}
