import { describe, it, expect } from "vitest";
import { handleLead, type D1Like, type LeadEnv } from "../../src/lib/lead-handler";

const body = { name: "Ana Souza", role: "Partner", kind: "investor", email: "ana@exemplo.com", lang: "pt", consent: true, turnstileToken: "tok" };
const listmonkEnv: LeadEnv = {
  TURNSTILE_SECRET: "sec", LISTMONK_URL: "https://lists.example", LISTMONK_USER: "api", LISTMONK_TOKEN: "t0k",
  LISTMONK_LIST_ID: "3", CF_ACCESS_CLIENT_ID: "cid", CF_ACCESS_CLIENT_SECRET: "csec",
};

function fakeDb(pending: Array<Record<string, string>> = []) {
  const calls: Array<{ sql: string; args: unknown[] }> = [];
  const db: D1Like = {
    prepare(sql) {
      return {
        bind(...args) {
          return {
            run: async () => { calls.push({ sql, args }); return {}; },
            all: async <T,>() => { calls.push({ sql, args }); return { results: pending as T[] }; },
            first: async <T,>() => { calls.push({ sql, args }); return { id: "lead-1" } as T; },
          };
        },
      };
    },
  };
  return { db, calls };
}

// Routes by URL: Turnstile answers `captcha`, Listmonk answers the queued statuses in order.
function fakeFetch(captcha: boolean, listmonk: Array<number | "throw"> = []) {
  const seen: Array<{ url: string; init: RequestInit | undefined }> = [];
  const queue = [...listmonk];
  const f = (async (url: string | URL, init?: RequestInit) => {
    seen.push({ url: String(url), init });
    if (String(url).includes("turnstile")) return new Response(JSON.stringify({ success: captcha }));
    const next = queue.shift() ?? 200;
    if (next === "throw") throw new Error("down");
    return new Response("{}", { status: next });
  }) as typeof fetch;
  return { f, seen };
}

const now = () => new Date("2026-09-30T12:00:00.000Z");
const statusWrites = (calls: Array<{ sql: string; args: unknown[] }>) =>
  calls.filter((c) => c.sql.startsWith("UPDATE leads SET listmonk_status")).map((c) => c.args);

describe("handleLead", () => {
  it("fails closed when Turnstile is not configured", async () => {
    const { db, calls } = fakeDb();
    const r = await handleLead(body, { db, fetch: fakeFetch(true).f, env: {}, now });
    expect(r.status).toBe(503);
    expect(calls).toHaveLength(0);
  });
  it("rejects a failed captcha and writes nothing", async () => {
    const { db, calls } = fakeDb();
    const r = await handleLead(body, { db, fetch: fakeFetch(false).f, env: { TURNSTILE_SECRET: "sec" }, now });
    expect(r).toEqual({ status: 400, body: { ok: false, errors: ["captcha"] } });
    expect(calls).toHaveLength(0);
  });
  it("rejects an invalid body with the field errors", async () => {
    const { db } = fakeDb();
    const r = await handleLead({ ...body, email: "nope" }, { db, fetch: fakeFetch(true).f, env: { TURNSTILE_SECRET: "sec" }, now });
    expect(r).toEqual({ status: 400, body: { ok: false, errors: ["email"] } });
  });
  it("stores the lead as pending when Listmonk is not configured", async () => {
    const { db, calls } = fakeDb();
    const r = await handleLead(body, { db, fetch: fakeFetch(true).f, env: { TURNSTILE_SECRET: "sec" }, now });
    // The ref is the row id (kept on upsert via RETURNING), so a returning visitor keeps theirs.
    expect(r).toEqual({ status: 200, body: { ok: true, ref: "lead-1" } });
    const insert = calls.find((c) => c.sql.startsWith("INSERT INTO leads"));
    expect(insert?.sql).toContain("ON CONFLICT(email)");
    expect(insert?.sql).toContain("RETURNING id");
    expect(insert?.args.slice(1)).toEqual([
      "2026-09-30T12:00:00.000Z", "2026-09-30T12:00:00.000Z", "Ana Souza", "Partner", "investor",
      "ana@exemplo.com", "pt", "2026-09-30T12:00:00.000Z",
    ]);
    expect(statusWrites(calls)).toEqual([]);
  });
  it("marks the lead sent when Listmonk accepts it, and sends the right request", async () => {
    const { db, calls } = fakeDb();
    const { f, seen } = fakeFetch(true, [200]);
    await handleLead(body, { db, fetch: f, env: listmonkEnv, now });
    expect(statusWrites(calls)).toContainEqual(["sent", "ana@exemplo.com"]);
    const req = seen.find((s) => s.url === "https://lists.example/api/subscribers");
    const headers = new Headers(req?.init?.headers);
    expect(headers.get("authorization")).toBe(`Basic ${btoa("api:t0k")}`);
    expect(headers.get("cf-access-client-id")).toBe("cid");
    expect(headers.get("cf-access-client-secret")).toBe("csec");
    expect(JSON.parse(String(req?.init?.body))).toEqual({
      email: "ana@exemplo.com", name: "Ana Souza", status: "enabled", lists: [3],
      attribs: { role: "Partner", kind: "investor", lang: "pt", source: "investor-pitch" },
      preconfirm_subscriptions: false,
    });
  });
  it("treats 'already subscribed' as sent", async () => {
    const { db, calls } = fakeDb();
    await handleLead(body, { db, fetch: fakeFetch(true, [409]).f, env: listmonkEnv, now });
    expect(statusWrites(calls)).toContainEqual(["sent", "ana@exemplo.com"]);
  });
  it.each([[500], ["throw" as const]])("keeps the lead pending and still answers 200 when Listmonk fails (%s)", async (fail) => {
    const { db, calls } = fakeDb();
    const r = await handleLead(body, { db, fetch: fakeFetch(true, [fail]).f, env: listmonkEnv, now });
    expect(r.status).toBe(200);
    expect(statusWrites(calls)).toEqual([]);
  });
  it("once Listmonk answers, retries older pending leads", async () => {
    const older = { name: "Bia", role: "CFO", kind: "founder", email: "bia@exemplo.com", lang: "en" };
    const { db, calls } = fakeDb([older]);
    await handleLead(body, { db, fetch: fakeFetch(true, [200, 200]).f, env: listmonkEnv, now });
    expect(statusWrites(calls)).toEqual([["sent", "ana@exemplo.com"], ["sent", "bia@exemplo.com"]]);
    const select = calls.find((c) => c.sql.startsWith("SELECT"));
    expect(select?.sql).toContain("LIMIT 5");
  });
});
