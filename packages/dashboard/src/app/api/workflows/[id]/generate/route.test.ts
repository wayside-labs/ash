import { describe, expect, it, vi } from "vitest";
import { dashboardStateSchema } from "@/lib/schema";

vi.mock("@/lib/server/store", () => ({ readState: vi.fn() }));
vi.mock("@/lib/server/i18n", () => ({ serverT: async (key: string) => key }));
vi.mock("@/lib/server/llm/complete", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/server/llm/complete")>()),
  completeText: vi.fn(),
}));

import { completeText } from "@/lib/server/llm/complete";
import { resetLimits } from "@/lib/server/rate-limit";
import { readState } from "@/lib/server/store";
import { POST } from "./route";

const HEADERS = {
  origin: "http://localhost:3000",
  host: "localhost:3000",
  "sec-fetch-site": "same-origin",
  "content-type": "application/json",
};

const state = dashboardStateSchema.parse({
  workflows: [{ id: "wf", name: "Earn", createdAt: "2026-01-01T00:00:00Z" }],
  mcps: [{ id: "rails", name: "ash", scope: "workflow", scopeName: "Earn" }],
});

const call = (prompt: string) =>
  POST(
    new Request("http://localhost:3000/api/workflows/wf/generate", {
      method: "POST",
      headers: HEADERS,
      body: JSON.stringify({ prompt }),
    }),
    { params: Promise.resolve({ id: "wf" }) },
  );

describe("POST /api/workflows/[id]/generate", () => {
  it("returns a validated proposal from the model's JSON", async () => {
    resetLimits();
    vi.mocked(readState).mockResolvedValue(state);
    vi.mocked(completeText).mockResolvedValueOnce({
      ok: true,
      provider: "claude-cli",
      text: 'Here:\n```json\n{"summary":"s","agents":[{"name":"Buyer","role":"pays"}],"tools":[{"mcpId":"rails","agent":"Buyer"}]}\n```',
    });
    const res = await call("add a buyer that pays vendors");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { proposal: { newAgents: unknown[]; tools: unknown[] } };
    expect(body.proposal.newAgents).toEqual([{ name: "Buyer", role: "pays" }]);
    expect(body.proposal.tools).toHaveLength(1);
  });

  it("says so when no model is connected instead of inventing a graph", async () => {
    resetLimits();
    vi.mocked(readState).mockResolvedValue(state);
    vi.mocked(completeText).mockResolvedValueOnce({ ok: false, provider: "demo" });
    const res = await call("anything");
    expect(res.status).toBe(409);
  });

  it("reports an unusable answer as a 502", async () => {
    resetLimits();
    vi.mocked(readState).mockResolvedValue(state);
    vi.mocked(completeText).mockResolvedValueOnce({
      ok: true,
      provider: "claude-cli",
      text: "I cannot help with that.",
    });
    expect((await call("anything")).status).toBe(502);
  });
});
