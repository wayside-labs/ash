import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it, vi } from "vitest";
import { createKnowledgeServer, loadKnowledgeConfig } from "./server.js";

async function connect(fetchImpl: typeof fetch, agentName?: string) {
  const server = createKnowledgeServer(
    { url: "https://dash.example/api/ingest", token: "tok", ...(agentName ? { agentName } : {}) },
    fetchImpl,
  );
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "0" });
  await Promise.all([server.connect(a), client.connect(b)]);
  return client;
}

describe("knowledge MCP", () => {
  it("exposes exactly one read-only tool", async () => {
    const client = await connect(vi.fn());
    expect((await client.listTools()).tools.map((t) => t.name)).toEqual(["knowledge_search"]);
  });

  it("searches with the token and agent, and fences the passages as untrusted", async () => {
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toContain("/knowledge?q=refund+window&k=3&agent=Buyer");
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer tok");
      return Response.json({
        mode: "lexical",
        hits: [{ docName: "Policy", idx: 0, text: "Refunds within 30 days.", score: 1 }],
      });
    }) as unknown as typeof fetch;
    const client = await connect(fetchImpl, "Buyer");
    const result = await client.callTool({
      name: "knowledge_search",
      arguments: { query: "refund window", k: 3 },
    });
    const text = (result.content as { text: string }[])[0]?.text ?? "";
    expect(text).toContain('<knowledge_results untrusted="true">');
    expect(text).toContain("[Policy #0] Refunds within 30 days.");
  });

  it("reports an HTTP failure as a tool error", async () => {
    const client = await connect((async () =>
      Response.json(
        { error: "unknown or revoked token" },
        { status: 401 },
      )) as unknown as typeof fetch);
    const result = await client.callTool({ name: "knowledge_search", arguments: { query: "x y" } });
    expect(result.isError).toBe(true);
  });

  it("refuses plain HTTP to anything but loopback", () => {
    const env = { AGENT_RAILS_INGEST_TOKEN: "t" };
    expect(() =>
      loadKnowledgeConfig({ ...env, AGENT_RAILS_INGEST_URL: "http://dash.example" }),
    ).toThrow();
    expect(
      loadKnowledgeConfig({ ...env, AGENT_RAILS_INGEST_URL: "http://127.0.0.1:3000/api/ingest" })
        .url,
    ).toBe("http://127.0.0.1:3000/api/ingest");
  });
});
