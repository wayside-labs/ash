import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dashboardStateSchema } from "@/lib/schema";
import { opsStore } from "@/lib/server/ops";
import { resetLimits } from "@/lib/server/rate-limit";
import { POST as decide } from "../reviews/[id]/route";
import { POST as ingest } from "./events/route";
import { GET as reviewFor } from "./reviews/[intentId]/route";

/**
 * The whole review loop on the JSON store: a token, an agent reporting, a person deciding,
 * the agent's MCP reading the decision back. The chain and the model are not involved.
 */

const TREASURY = "BTE45zKpHiWMTwaPmShaUBq2cnA6XUc8KhgxnufSnz3w";
const OTHER = "H4HU1sPoevCGqHeFQiyW5Q8NVmQgAb1DyZgP2LSzwMPE";
const SESSION = "3tvQknH6RHfnssAGgC64z7KkejwrQ3USftxosmoimX4z";
const INTENT = "ab".repeat(16);
const BROWSER = {
  origin: "http://localhost:3000",
  host: "localhost:3000",
  "sec-fetch-site": "same-origin",
  "content-type": "application/json",
};

function reviewEvent(treasury = TREASURY) {
  return {
    schema_version: 1,
    kind: "payment_review_required",
    ts: "2026-09-28T00:00:00.000Z",
    review: {
      treasury,
      policy: OTHER,
      session: SESSION,
      intent_id: INTENT,
      destination: SESSION,
      destination_label: "vendor-oracle",
      mint: "So11111111111111111111111111111111111111112",
      amount: "5000000000",
      reference: "inv_big",
    },
  };
}

const post = (token: string, body: unknown) =>
  ingest(
    new Request("http://localhost:3000/api/ingest/events", {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );

const decision = (token: string) =>
  reviewFor(
    new Request(`http://localhost:3000/api/ingest/reviews/${INTENT}`, {
      headers: { authorization: `Bearer ${token}` },
    }),
    { params: Promise.resolve({ intentId: INTENT }) },
  );

let token: string;
let delivered: { url: string; body: unknown }[];

beforeEach(async () => {
  const home = await mkdtemp(join(tmpdir(), "ops-test-"));
  vi.stubEnv("ASH_HOME", home);
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "");
  resetLimits();
  const state = dashboardStateSchema.parse({
    workflows: [
      { id: "wf", name: "Cofre", treasuryAddress: TREASURY, createdAt: "2026-01-01T00:00:00Z" },
    ],
    integrations: [
      {
        id: "hook",
        name: "Ops webhook",
        kind: "webhook",
        target: "https://hooks.example/ash",
        events: ["payment_review_required", "payment_denied"],
      },
    ],
    settings: { limitAlerts: false },
  });
  await writeFile(join(home, "dashboard.json"), JSON.stringify(state));
  token = (await opsStore().issueToken({ kind: "json" }, "wf")).token;
  delivered = [];
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    delivered.push({ url, body: JSON.parse(String(init?.body)) });
    return new Response(null, { status: 200 });
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("ingest", () => {
  it("refuses a missing, unknown or revoked token", async () => {
    expect((await post("", reviewEvent())).status).toBe(401);
    expect((await post("art_nope", reviewEvent())).status).toBe(401);
    const rotated = await opsStore().issueToken({ kind: "json" }, "wf");
    expect((await post(token, reviewEvent())).status).toBe(401);
    expect((await post(rotated.token, reviewEvent())).status).toBe(202);
  });

  it("refuses an event about another treasury", async () => {
    const res = await post(token, reviewEvent(OTHER));
    expect(res.status).toBe(422);
  });

  it("queues a review, delivers it, and serves the decision back to the MCP", async () => {
    const res = await post(token, reviewEvent());
    expect(res.status).toBe(202);
    const body = (await res.json()) as { review: { id: string; status: string } };
    expect(body.review.status).toBe("pending");
    expect(delivered).toHaveLength(1);
    expect(delivered[0]?.url).toBe("https://hooks.example/ash");

    // Asking again does not open a second review.
    const again = (await (await post(token, reviewEvent())).json()) as { review: { id: string } };
    expect(again.review.id).toBe(body.review.id);

    expect(await (await decision(token)).json()).toMatchObject({ status: "pending" });

    const decided = await decide(
      new Request(`http://localhost:3000/api/reviews/${body.review.id}`, {
        method: "POST",
        headers: BROWSER,
        body: JSON.stringify({ decision: "approved" }),
      }),
      { params: Promise.resolve({ id: body.review.id }) },
    );
    expect(decided.status).toBe(200);
    expect(await (await decision(token)).json()).toMatchObject({ status: "approved" });

    // A decision is final: deciding again is a conflict, and re-reporting keeps the approval.
    const twice = await decide(
      new Request(`http://localhost:3000/api/reviews/${body.review.id}`, {
        method: "POST",
        headers: BROWSER,
        body: JSON.stringify({ decision: "rejected" }),
      }),
      { params: Promise.resolve({ id: body.review.id }) },
    );
    expect(twice.status).toBe(409);
    await post(token, reviewEvent());
    expect(await (await decision(token)).json()).toMatchObject({ status: "approved" });
  });

  it("does not let one workflow's token read another's decisions", async () => {
    await post(token, reviewEvent());
    const other = await opsStore().issueToken({ kind: "json" }, "wf-2");
    expect((await decision(other.token)).status).toBe(404);
  });

  it("stores alerts but keeps them off the channels while limit alerts are off", async () => {
    const res = await post(token, {
      schema_version: 1,
      kind: "payment_denied",
      ts: "2026-09-28T00:00:00.000Z",
      denial: {
        treasury: TREASURY,
        session: SESSION,
        intent: INTENT,
        reason_code: "EXCEEDS_PER_TX_MAX",
        source: "program",
      },
    });
    expect(res.status).toBe(202);
    expect(delivered).toHaveLength(0);
    expect(await opsStore().listEvents({ kind: "json" })).toHaveLength(1);
  });

  it("refuses a decision from another site", async () => {
    const res = await decide(
      new Request("http://localhost:3000/api/reviews/x", {
        method: "POST",
        headers: { ...BROWSER, origin: "https://evil.example", "sec-fetch-site": "cross-site" },
        body: JSON.stringify({ decision: "approved" }),
      }),
      { params: Promise.resolve({ id: "x" }) },
    );
    expect(res.status).toBe(403);
  });
});
