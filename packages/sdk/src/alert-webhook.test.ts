import { buildHeadroomLowAlert, buildPaymentDeniedAlert } from "@agent-rails/contract/alerts";
import { describe, expect, it, vi } from "vitest";
import { type AlertWebhookFetch, postAgentEvent, postAlertWebhook } from "./alert-webhook.js";

describe("postAlertWebhook", () => {
  it("POSTs JSON with payment_denied payload", async () => {
    const fetchImpl = vi.fn<AlertWebhookFetch>(async () => new Response("", { status: 200 }));
    const payload = buildPaymentDeniedAlert({
      ts: "2026-09-26T12:00:00.000Z",
      treasury: "CzMHCrWhbCqVMDTNDriaMAcJ1mS5LLKGKGKpTLtHnGTW",
      policy: "11111111111111111111111111111112",
      session: "22222222222222222222222222222222",
      intent: "a".repeat(32),
      reason_code: "EXCEEDS_PER_TX_MAX",
      source: "program",
    });

    const result = await postAlertWebhook("https://example.com/hook", payload, fetchImpl);

    expect(result).toEqual({ ok: true, status: 200 });
    expect(fetchImpl).toHaveBeenCalledOnce();
    const init = fetchImpl.mock.calls[0]?.[1];
    expect(init?.method).toBe("POST");
    expect(init?.headers).toEqual({ "Content-Type": "application/json" });
    expect(JSON.parse(String(init?.body))).toEqual(payload);
  });

  it("POSTs JSON with headroom_low payload", async () => {
    const fetchImpl = vi.fn<AlertWebhookFetch>(async () => new Response("ok", { status: 200 }));
    const payload = buildHeadroomLowAlert({
      headroom: {
        treasury: "CzMHCrWhbCqVMDTNDriaMAcJ1mS5LLKGKGKpTLtHnGTW",
        session: "22222222222222222222222222222222",
        policy: "11111111111111111111111111111112",
        mint: "So11111111111111111111111111111111111111112",
        window: "short",
        spent: "800000000",
        limit: "1000000000",
        headroom_bps: 2000,
        headroom_threshold_bps: 2000,
      },
    });

    await postAlertWebhook("https://hooks.slack.com/services/T/B/x", payload, fetchImpl);
    const init = fetchImpl.mock.calls[0]?.[1];
    expect(JSON.parse(String(init?.body)).kind).toBe("headroom_low");
  });
});

describe("postAgentEvent", () => {
  const event = {
    schema_version: 1 as const,
    kind: "limit_increase_requested" as const,
    ts: "2026-09-28T00:00:00.000Z",
    request: {
      treasury: "BTE45zKpHiWMTwaPmShaUBq2cnA6XUc8KhgxnufSnz3w",
      policy: "H4HU1sPoevCGqHeFQiyW5Q8NVmQgAb1DyZgP2LSzwMPE",
      session: "3tvQknH6RHfnssAGgC64z7KkejwrQ3USftxosmoimX4z",
      reason: "need more",
    },
  };

  it("sends the event with the ingest token as a bearer", async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 202 }));
    const result = await postAgentEvent("https://dash/api/ingest/events", "tok", event, fetchImpl);
    expect(result).toEqual({ ok: true, status: 202 });
    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer tok");
    expect(JSON.parse(String(init.body)).kind).toBe("limit_increase_requested");
  });

  it("never throws: a schema error or a network error is a result", async () => {
    const bad = { ...event, request: { ...event.request, reason: "" } };
    expect((await postAgentEvent("u", "t", bad, vi.fn())).ok).toBe(false);
    const offline = vi.fn(async () => {
      throw new Error("offline");
    });
    expect(await postAgentEvent("u", "t", event, offline)).toEqual({ ok: false, error: "offline" });
  });
});
