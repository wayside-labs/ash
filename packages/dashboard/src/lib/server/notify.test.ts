import type { AgentEvent } from "@agent-rails/contract/alerts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { integrationSchema, type StoredIntegration } from "@/lib/schema";
import { channelsFor, describeEvent, fanOut } from "./notify";

const denied: AgentEvent = {
  schema_version: 1,
  kind: "payment_denied",
  ts: "2026-09-28T00:00:00.000Z",
  denial: {
    treasury: "BTE45zKpHiWMTwaPmShaUBq2cnA6XUc8KhgxnufSnz3w",
    session: "3tvQknH6RHfnssAGgC64z7KkejwrQ3USftxosmoimX4z",
    intent: "a".repeat(32),
    reason_code: "EXCEEDS_PER_TX_MAX",
    source: "program",
  },
};
const request: AgentEvent = {
  schema_version: 1,
  kind: "limit_increase_requested",
  ts: "2026-09-28T00:00:00.000Z",
  request: {
    treasury: "BTE45zKpHiWMTwaPmShaUBq2cnA6XUc8KhgxnufSnz3w",
    policy: "H4HU1sPoevCGqHeFQiyW5Q8NVmQgAb1DyZgP2LSzwMPE",
    session: "3tvQknH6RHfnssAGgC64z7KkejwrQ3USftxosmoimX4z",
    reason: "vendor raised prices",
  },
};

function channel(partial: Partial<StoredIntegration>): StoredIntegration {
  return integrationSchema.parse({ id: partial.kind, name: partial.kind, ...partial });
}

const all = [
  channel({ kind: "webhook", target: "https://hooks.example/x" }),
  channel({ kind: "slack", target: "https://hooks.slack.com/services/T/B/C" }),
  channel({ kind: "telegram", target: "123456:ABCDEFGHIJKLMNOPQRSTUVWXYZ#-100200" }),
  channel({ kind: "email", target: "ops@example.com" }),
];

afterEach(() => vi.unstubAllEnvs());

describe("channel selection", () => {
  const on = { limitAlerts: true, emailNotifications: true };

  it("sends to every enabled, subscribed channel with a target", () => {
    expect(channelsFor(denied, { channels: all, settings: on })).toHaveLength(4);
    const quiet = [...all.slice(1), channel({ kind: "webhook", target: "", id: "blank" })];
    expect(channelsFor(denied, { channels: quiet, settings: on })).toHaveLength(3);
    const off = all.map((c) => ({ ...c, enabled: c.kind !== "slack" }));
    expect(channelsFor(denied, { channels: off, settings: on })).toHaveLength(3);
    const narrow = all.map((c) => ({ ...c, events: ["headroom_low" as const] }));
    expect(channelsFor(denied, { channels: narrow, settings: on })).toHaveLength(0);
  });

  it("silences alerts, not requests, when limit alerts are off", () => {
    const settings = { limitAlerts: false, emailNotifications: true };
    expect(channelsFor(denied, { channels: all, settings })).toHaveLength(0);
    expect(channelsFor(request, { channels: all, settings })).toHaveLength(4);
  });

  it("drops email when email notifications are off", () => {
    const settings = { limitAlerts: true, emailNotifications: false };
    expect(channelsFor(denied, { channels: all, settings }).map((c) => c.kind)).not.toContain(
      "email",
    );
  });
});

describe("delivery", () => {
  it("speaks each channel's protocol and reports failures per channel", async () => {
    vi.stubEnv("RESEND_API_KEY", "");
    const calls: { url: string; body: Record<string, unknown> }[] = [];
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, body: JSON.parse(String(init?.body)) });
      return new Response(null, { status: url.includes("slack") ? 500 : 200 });
    }) as unknown as typeof fetch;

    const results = await fanOut(
      denied,
      { channels: all, settings: { limitAlerts: true, emailNotifications: true } },
      "Cofre",
      fetchImpl,
    );

    expect(calls.find((c) => c.url === "https://hooks.example/x")?.body).toEqual(denied);
    expect(
      calls.find((c) => c.url.startsWith("https://api.telegram.org/bot123456:"))?.body,
    ).toMatchObject({ chat_id: "-100200" });
    const byKind = Object.fromEntries(
      results.map((r) => [all.find((c) => c.id === r.channelId)?.kind, r]),
    );
    expect(byKind.webhook?.ok).toBe(true);
    expect(byKind.slack).toMatchObject({ ok: false, error: "HTTP 500" });
    expect(byKind.email).toMatchObject({ ok: false, error: /not configured/ });
  });

  it("describes events without inventing units", () => {
    expect(describeEvent(denied, "Cofre")).toContain("[Cofre]");
    expect(describeEvent(request)).toContain("Nothing changes unless you raise a limit");
  });
});

describe("channel validation", () => {
  it.each([
    ["webhook", "http://insecure.example/x"],
    ["slack", "https://example.com/not-slack"],
    ["telegram", "no-hash"],
    ["email", "not-an-email"],
  ] as const)("refuses a %s target of the wrong shape", (kind, target) => {
    expect(integrationSchema.safeParse({ id: "x", name: "x", kind, target }).success).toBe(false);
  });
});
