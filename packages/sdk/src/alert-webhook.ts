import {
  type AgentEvent,
  type AlertWebhookPayload,
  agentEventSchema,
  alertWebhookPayloadSchema,
} from "@agent-rails/contract/alerts";

export type AlertWebhookFetch = (input: string, init?: RequestInit) => Promise<Response>;

export type PostAlertWebhookResult =
  | { ok: true; status: number }
  | { ok: false; status?: number; error: string };

/**
 * POST a JSON alert to a generic webhook URL (Slack incoming webhooks use the same shape).
 *
 * Non-blocking callers should fire-and-forget; delivery failure must not block payments.
 */
export async function postAlertWebhook(
  url: string,
  payload: AlertWebhookPayload,
  fetchImpl: AlertWebhookFetch = fetch,
): Promise<PostAlertWebhookResult> {
  const body = JSON.stringify(alertWebhookPayloadSchema.parse(payload));
  try {
    const response = await fetchImpl(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });
    if (!response.ok) {
      return { ok: false, status: response.status, error: `HTTP ${response.status}` };
    }
    return { ok: true, status: response.status };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "webhook request failed",
    };
  }
}

/**
 * POST an agent event to the dashboard's ingest endpoint (`/api/ingest/events`), with the
 * workflow's ingest token as a bearer. Same contract as `postAlertWebhook`: never throws,
 * so a caller on the payment path can fire and forget.
 */
export async function postAgentEvent(
  url: string,
  token: string,
  event: AgentEvent,
  fetchImpl: AlertWebhookFetch = fetch,
): Promise<PostAlertWebhookResult> {
  try {
    const body = JSON.stringify(agentEventSchema.parse(event));
    const response = await fetchImpl(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body,
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) {
      return { ok: false, status: response.status, error: `HTTP ${response.status}` };
    }
    return { ok: true, status: response.status };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "event request failed" };
  }
}
