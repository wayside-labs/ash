import { describe, it, expect } from "vitest";
import { handleInterest } from "../../src/lib/interest-handler";
import type { D1Like } from "../../src/lib/lead-handler";

const ref = "0b8e6f2a-3c1d-4e5f-9a7b-1c2d3e4f5a6b";

function fakeDb() {
  const calls: Array<{ sql: string; args: unknown[] }> = [];
  const db: D1Like = {
    prepare(sql) {
      return {
        bind(...args) {
          return {
            run: async () => { calls.push({ sql, args }); return {}; },
            all: async <T,>() => ({ results: [] as T[] }),
            first: async <T,>() => null as T | null,
          };
        },
      };
    },
  };
  return { db, calls };
}
const now = () => new Date("2026-09-30T12:00:00.000Z");

describe("handleInterest", () => {
  it("is off while lead collection is off", async () => {
    const { db, calls } = fakeDb();
    const r = await handleInterest({ ref, channel: "email" }, { db, env: {}, now });
    expect(r.status).toBe(503);
    expect(calls).toHaveLength(0);
  });
  it("marks the lead interested with the channel it picked", async () => {
    const { db, calls } = fakeDb();
    const r = await handleInterest({ ref, channel: "whatsapp" }, { db, env: { TURNSTILE_SECRET: "s" }, now });
    expect(r).toEqual({ status: 200, body: { ok: true } });
    expect(calls).toEqual([{
      sql: "UPDATE leads SET interested_at = ?, interest_channel = ? WHERE id = ?",
      args: ["2026-09-30T12:00:00.000Z", "whatsapp", ref],
    }]);
  });
  it.each([
    [{ ref: "1; DROP TABLE leads", channel: "email" }],
    [{ ref, channel: "carrier-pigeon" }],
    [{ ref }],
    [null],
  ])("rejects a bad body %#", async (body) => {
    const { db, calls } = fakeDb();
    const r = await handleInterest(body, { db, env: { TURNSTILE_SECRET: "s" }, now });
    expect(r.status).toBe(400);
    expect(calls).toHaveLength(0);
  });
});
