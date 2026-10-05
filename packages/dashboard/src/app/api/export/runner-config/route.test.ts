import { describe, expect, it, vi } from "vitest";
import { readZip } from "@/lib/__fixtures__/read-zip";
import { dashboardStateSchema } from "@/lib/schema";

vi.mock("@/lib/server/store", () => ({ readState: vi.fn() }));
vi.mock("@/lib/server/i18n", () => ({ serverT: async (key: string) => key }));
vi.mock("@/lib/server/ops", () => ({
  userOpsScope: async () => ({ kind: "json" }),
  ensureIngestToken: async () => "art_test",
  ingestBaseUrl: (req: Request) => `${new URL(req.url).origin}/api/ingest`,
}));

import { readState } from "@/lib/server/store";
import { GET } from "./route";

const HEADERS = {
  origin: "http://localhost:3000",
  host: "localhost:3000",
  "sec-fetch-site": "same-origin",
};

function state() {
  return dashboardStateSchema.parse({
    workflows: [{ id: "wf", name: "Earn", createdAt: "2026-01-01T00:00:00.000Z" }],
    agents: [
      { id: "ag", name: "Builder", workflowId: "wf", createdAt: "2026-01-01T00:00:00.000Z" },
    ],
    mcps: [
      {
        id: "rails",
        name: "ash",
        enabled: true,
        command: "ash-mcp",
        env: { ASH_SESSION: "abc" },
      },
    ],
    skills: [
      { id: "s1", name: "Vendor checkout", enabled: true, content: "Pay then redeem." },
      { id: "s2", name: "Off", enabled: false, content: "x" },
    ],
  });
}

const get = (query: string) =>
  GET(new Request(`http://localhost:3000/api/export/runner-config?${query}`, { headers: HEADERS }));

describe("GET /api/export/runner-config", () => {
  it("bundles the MCP config and the enabled skills as a zip", async () => {
    vi.mocked(readState).mockResolvedValueOnce(state());
    const res = await get("workflowId=wf&agentId=ag&format=zip");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/zip");
    expect(res.headers.get("x-runner-skills")).toBe("1");
    const files = readZip(new Uint8Array(await res.arrayBuffer()));
    expect(Object.keys(files).sort()).toEqual([
      ".claude/skills/vendor-checkout/SKILL.md",
      ".mcp.json",
      "README.txt",
    ]);
    const config = JSON.parse(files[".mcp.json"] as string);
    expect(config.mcpServers["ash"].env).toMatchObject({
      ASH_SESSION: "abc",
      ASH_INGEST_URL: "http://localhost:3000/api/ingest",
      ASH_INGEST_TOKEN: "art_test",
    });
  });

  it("refuses an unknown format", async () => {
    vi.mocked(readState).mockResolvedValueOnce(state());
    expect((await get("workflowId=wf&format=tar")).status).toBe(400);
  });
});
