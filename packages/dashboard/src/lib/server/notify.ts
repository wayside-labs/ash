import type { AgentEvent } from "@ash/contract/alerts";
import type { Settings, StoredIntegration } from "@/lib/schema";
import { createAdminClient } from "@/lib/supabase/admin";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import type { OpsScope } from "./ops";
import { type IntegrationRow, integrationFromRow, settingsFromRow } from "./state/map";
import * as json from "./store-json";

/**
 * Fan-out of an ingested event to the tenant's notification channels (plan 1.3).
 *
 * Two operator switches apply here, and this is the only place they do:
 *  - `limitAlerts` off silences the two *alerts* (`payment_denied`, `headroom_low`) on every
 *    channel. Review requests still go out — silencing them would strand a payment.
 *  - `emailNotifications` off silences the email channel kind entirely.
 *
 * Delivery is best effort and never throws: the event is already stored and visible in the
 * dashboard, so a dead webhook costs a notification, not a record.
 */

const ALERT_KINDS = new Set<AgentEvent["kind"]>(["payment_denied", "headroom_low"]);
const DELIVERY_TIMEOUT_MS = 5_000;

export type NotifyConfig = {
  channels: StoredIntegration[];
  settings: Pick<Settings, "limitAlerts" | "emailNotifications">;
};

export type DeliveryResult = { channelId: string; ok: boolean; error?: string };

type Fetch = typeof fetch;

/** Plain-language one-liner for chat-style channels. Amounts stay in base units: no guessing. */
export function describeEvent(event: AgentEvent, workflowName?: string): string {
  const where = workflowName ? ` [${workflowName}]` : "";
  switch (event.kind) {
    case "payment_denied":
      return `ASH${where}: payment denied — ${event.denial.reason_code} (session ${event.denial.session}, intent ${event.denial.intent}).`;
    case "headroom_low":
      return `ASH${where}: ${event.headroom.window} window at ${(event.headroom.headroom_bps / 100).toFixed(1)}% headroom (spent ${event.headroom.spent} of ${event.headroom.limit}, mint ${event.headroom.mint}).`;
    case "payment_review_required":
      return `ASH${where}: payment waiting for approval — ${event.review.amount} base units of ${event.review.mint} to ${event.review.destination_label ?? event.review.destination}, reference ${event.review.reference}. Decide in the dashboard's Reviews page.`;
    case "limit_increase_requested":
      return `ASH${where}: agent asks for more budget${event.request.requested_amount ? ` (${event.request.requested_amount})` : ""} — "${event.request.reason}". Nothing changes unless you raise a limit.`;
  }
}

export function channelsFor(event: AgentEvent, config: NotifyConfig): StoredIntegration[] {
  return config.channels.filter((channel) => {
    if (!channel.enabled || !channel.target) return false;
    if (!channel.events.includes(event.kind)) return false;
    if (ALERT_KINDS.has(event.kind) && !config.settings.limitAlerts) return false;
    if (channel.kind === "email" && !config.settings.emailNotifications) return false;
    return true;
  });
}

async function post(fetchImpl: Fetch, url: string, body: unknown, headers = {}): Promise<void> {
  const res = await fetchImpl(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(DELIVERY_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
}

export async function deliver(
  channel: StoredIntegration,
  event: AgentEvent,
  text: string,
  fetchImpl: Fetch = fetch,
): Promise<void> {
  switch (channel.kind) {
    case "webhook":
      // The generic webhook receives the event itself — for the two alerts, byte for byte
      // the payload the MCP used to post directly, so existing receivers keep working.
      return post(fetchImpl, channel.target, event);
    case "slack":
      return post(fetchImpl, channel.target, { text });
    case "telegram": {
      const [botToken, chatId] = channel.target.split("#");
      return post(fetchImpl, `https://api.telegram.org/bot${botToken}/sendMessage`, {
        chat_id: chatId,
        text,
        disable_web_page_preview: true,
      });
    }
    case "email": {
      const key = process.env.RESEND_API_KEY;
      const from = process.env.ALERT_EMAIL_FROM;
      if (!key || !from) throw new Error("email is not configured on this server");
      return post(
        fetchImpl,
        "https://api.resend.com/emails",
        {
          from,
          to: [channel.target],
          subject: text.length > 90 ? `${text.slice(0, 87)}...` : text,
          text: `${text}\n\n${JSON.stringify(event, null, 2)}`,
        },
        { Authorization: `Bearer ${key}` },
      );
    }
  }
}

export async function fanOut(
  event: AgentEvent,
  config: NotifyConfig,
  workflowName?: string,
  fetchImpl: Fetch = fetch,
): Promise<DeliveryResult[]> {
  const text = describeEvent(event, workflowName);
  return Promise.all(
    channelsFor(event, config).map(async (channel) => {
      try {
        await deliver(channel, event, text, fetchImpl);
        return { channelId: channel.id, ok: true };
      } catch (error) {
        return {
          channelId: channel.id,
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }),
  );
}

/**
 * Channels and the two switches, read with no user session (the ingest route has none).
 * Settings are per account; an org uses its earliest member's, the account that created it.
 */
export async function readNotifyConfig(
  scope: OpsScope,
): Promise<NotifyConfig & { workflowNames: Map<string, string>; treasuries: Map<string, string> }> {
  if (scope.kind === "json" || !isSupabaseConfigured()) {
    const state = await json.readState();
    return {
      channels: state.integrations,
      settings: state.settings,
      workflowNames: new Map(state.workflows.map((w) => [w.id, w.name])),
      treasuries: treasuryMap(state.workflows),
    };
  }
  const db = createAdminClient();
  const [channels, owner, workflows] = await Promise.all([
    db.from("integrations").select("*").eq("org_id", scope.orgId),
    db
      .from("memberships")
      .select("account_id")
      .eq("org_id", scope.orgId)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle(),
    db.from("workflows").select("id, name, treasury_address").eq("org_id", scope.orgId),
  ]);
  let settings: NotifyConfig["settings"] = { limitAlerts: true, emailNotifications: false };
  if (owner.data?.account_id) {
    const row = await db
      .from("settings")
      .select("*")
      .eq("account_id", owner.data.account_id)
      .maybeSingle();
    if (row.data) settings = settingsFromRow(row.data);
  }
  return {
    channels: ((channels.data ?? []) as IntegrationRow[]).map(integrationFromRow),
    settings,
    workflowNames: new Map(
      (
        (workflows.data ?? []) as { id: string; name: string; treasury_address: string | null }[]
      ).map((w) => [w.id, w.name]),
    ),
    treasuries: treasuryMap(
      (
        (workflows.data ?? []) as { id: string; name: string; treasury_address: string | null }[]
      ).map((w) => ({ id: w.id, treasuryAddress: w.treasury_address })),
    ),
  };
}

function treasuryMap(
  workflows: { id: string; treasuryAddress: string | null }[],
): Map<string, string> {
  return new Map(
    workflows.flatMap((w) => (w.treasuryAddress ? [[w.id, w.treasuryAddress] as const] : [])),
  );
}

/** Last outcome per channel, so the Settings page can show a dead webhook as dead. */
export async function recordDeliveries(scope: OpsScope, results: DeliveryResult[]): Promise<void> {
  if (results.length === 0) return;
  const at = new Date().toISOString();
  if (scope.kind === "json" || !isSupabaseConfigured()) {
    await json.mutateState((state) => {
      for (const result of results) {
        const channel = state.integrations.find((c) => c.id === result.channelId);
        if (!channel) continue;
        channel.lastDeliveryAt = at;
        channel.lastError = result.ok ? null : (result.error ?? "failed");
      }
    });
    return;
  }
  const db = createAdminClient();
  await Promise.all(
    results.map((result) =>
      db
        .from("integrations")
        .update({ last_delivery_at: at, last_error: result.ok ? null : (result.error ?? "failed") })
        .eq("org_id", scope.orgId)
        .eq("id", result.channelId),
    ),
  );
}
