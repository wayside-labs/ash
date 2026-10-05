import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dashboardStateSchema } from "@/lib/schema";
import { opsStore } from "@/lib/server/ops";
import { resetLimits } from "@/lib/server/rate-limit";
import { GET as ingestSearch } from "../ingest/knowledge/route";
import { DELETE } from "./[id]/route";
import { POST } from "./route";
import { GET as search } from "./search/route";

const BROWSER = {
  origin: "http://localhost:3000",
  host: "localhost:3000",
  "sec-fetch-site": "same-origin",
  "content-type": "application/json",
};

const add = (body: unknown) =>
  POST(
    new Request("http://localhost:3000/api/knowledge", {
      method: "POST",
      headers: BROWSER,
      body: JSON.stringify(body),
    }),
  );

beforeEach(async () => {
  const home = await mkdtemp(join(tmpdir(), "kb-test-"));
  vi.stubEnv("ASH_HOME", home);
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
  vi.stubEnv("VOYAGE_API_KEY", "");
  resetLimits();
  await writeFile(
    join(home, "dashboard.json"),
    JSON.stringify(
      dashboardStateSchema.parse({
        workflows: [
          { id: "wf", name: "Store", createdAt: "2026-01-01T00:00:00Z" },
          { id: "wf2", name: "Other", createdAt: "2026-01-01T00:00:00Z" },
        ],
      }),
    ),
  );
});
afterEach(() => vi.unstubAllEnvs());

describe("knowledge base", () => {
  it("indexes Markdown lexically without an embedding key and finds it", async () => {
    const res = await add({
      type: "md",
      name: "Refund policy",
      content:
        "# Refunds\n\nRefunds are accepted within thirty days of purchase.\n\nShipping is free.",
    });
    expect(res.status).toBe(201);
    const { document } = (await res.json()) as {
      document: { id: string; status: string; mode: string; chunkCount: number };
    };
    expect(document).toMatchObject({ status: "indexed", mode: "lexical" });
    expect(document.chunkCount).toBeGreaterThan(0);

    const found = await search(
      new Request("http://localhost:3000/api/knowledge/search?q=refund+days"),
    );
    const body = (await found.json()) as { hits: { text: string; docName: string }[] };
    expect(body.hits[0]?.docName).toBe("Refund policy");
    expect(body.hits[0]?.text).toContain("thirty days");
  });

  it("serves agents only the documents in their workflow's scope", async () => {
    await add({ type: "md", name: "Global", content: "global treasury rules apply" });
    await add({
      type: "md",
      name: "Other workflow only",
      content: "secret treasury rules for other",
      scope: "workflow",
      scopeName: "Other",
    });
    const { token } = await opsStore().issueToken({ kind: "json" }, "wf");
    const res = await ingestSearch(
      new Request("http://localhost:3000/api/ingest/knowledge?q=treasury+rules", {
        headers: { authorization: `Bearer ${token}` },
      }),
    );
    const body = (await res.json()) as { hits: { docName: string }[] };
    expect(body.hits.map((h) => h.docName)).toEqual(["Global"]);

    const anonymous = await ingestSearch(
      new Request("http://localhost:3000/api/ingest/knowledge?q=x"),
    );
    expect(anonymous.status).toBe(401);
  });

  it("records a failure as the document's error instead of pretending it indexed", async () => {
    const res = await add({ type: "url", name: "Metadata", url: "http://169.254.169.254/latest" });
    expect(res.status).toBe(422);
    const { document } = (await res.json()) as { document: { status: string; error: string } };
    expect(document.status).toBe("error");
    expect(document.error).toMatch(/private|link-local/);
  });

  it("deletes the row and its chunks", async () => {
    const res = await add({ type: "md", name: "Temp", content: "temporary text about vaults" });
    const { document } = (await res.json()) as { document: { id: string } };
    const del = await DELETE(
      new Request(`http://localhost:3000/api/knowledge/${document.id}`, {
        method: "DELETE",
        headers: BROWSER,
      }),
      { params: Promise.resolve({ id: document.id }) },
    );
    expect(del.status).toBe(200);
    const found = await search(new Request("http://localhost:3000/api/knowledge/search?q=vaults"));
    expect(((await found.json()) as { hits: unknown[] }).hits).toEqual([]);
  });
});
