import { GET } from "@/app/api/health/route";
import { db } from "@/db/client";
import { env } from "@/lib/env";
import type { Health } from "@/lib/health";

vi.mock("@/db/client", () => ({ db: vi.fn() }));
vi.mock("@/lib/env", async (original) => ({
  ...(await original<typeof import("@/lib/env")>()),
  env: vi.fn(),
}));

const TOKEN = "ghx-test-token-0123456789";

// The route asks two questions of the database, in this order: the newest heartbeat, then the
// dead jobs of the last day.
function database(beat: { beat_at: string; last_error: string | null } | null, dead: unknown[]) {
  const execute = vi.fn().mockResolvedValueOnce(beat ? [beat] : []).mockResolvedValueOnce(dead);
  vi.mocked(db).mockReturnValue({ execute } as unknown as ReturnType<typeof db>);
  return execute;
}
const environment = (extra: Record<string, unknown> = {}) =>
  vi.mocked(env).mockReturnValue({
    APP_VERSION: "abc123",
    NODE_ENV: "production",
    EMAIL_DRIVER: "none",
    ...extra,
  } as ReturnType<typeof env>);

const fresh = () => new Date(Date.now() - 30_000).toISOString();
const get = (query = "") => GET(new Request(`http://127.0.0.1:3000/api/health${query}`));

describe("GET /api/health", () => {
  beforeEach(() => {
    vi.mocked(db).mockReset();
    vi.mocked(env).mockReset();
    environment();
  });

  it("tudo verde: 200, sem cache, rebuild desligado à vista", async () => {
    database({ beat_at: fresh(), last_error: null }, []);
    const res = await get();
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = (await res.json()) as Health;
    expect(body).toMatchObject({ ok: true, live: true, rebuild: "off", version: "abc123" });
  });

  it("rebuild ligado aparece pelo token ou pela bandeira, e o token nunca sai na resposta", async () => {
    environment({ GITHUB_DISPATCH_TOKEN: TOKEN });
    database({ beat_at: fresh(), last_error: null }, []);
    let res = await get();
    const text = await res.text();
    expect(JSON.parse(text)).toMatchObject({ rebuild: "on" });
    expect(text).not.toContain(TOKEN);

    environment({ SITE_REBUILD: "on" });
    database({ beat_at: fresh(), last_error: null }, []);
    res = await get();
    expect(await res.json()).toMatchObject({ rebuild: "on" });
  });

  it("job morto nas últimas 24 h: 503 dizendo o porquê, mas a sonda de vida segue 200", async () => {
    database({ beat_at: fresh(), last_error: null }, [{ kind: "site-rebuild", count: 1 }]);
    const full = await get();
    expect(full.status).toBe(503);
    const body = (await full.json()) as Health;
    expect(body).toMatchObject({ ok: false, live: true });
    expect(body.checks.jobs).toEqual({
      ok: false,
      detail: "1 dead in the last 24 h (site-rebuild: 1)",
    });

    database({ beat_at: fresh(), last_error: null }, [{ kind: "site-rebuild", count: 1 }]);
    const live = await get("?probe=live");
    expect(live.status).toBe(200);
    // Same body: whoever reads the probe's answer still sees what is red.
    expect(await live.json()).toMatchObject({ ok: false, live: true });
  });

  it("erro no último ciclo do worker: 503 com o erro, sem os parâmetros da consulta", async () => {
    database(
      { beat_at: fresh(), last_error: "Failed query: update x\nparams: admin@example.com" },
      [],
    );
    const res = await get();
    expect(res.status).toBe(503);
    const text = await res.text();
    expect(JSON.parse(text).checks.cycle).toEqual({
      ok: false,
      detail: "last cycle: Failed query: update x",
    });
    expect(text).not.toContain("admin@example.com");
  });

  it("a consulta dos jobs mortos olha só as últimas 24 h", async () => {
    const execute = database({ beat_at: fresh(), last_error: null }, []);
    const before = Date.now();
    await get();
    const query = execute.mock.calls[1]![0] as { queryChunks: unknown[] };
    const text = JSON.stringify(query.queryChunks);
    expect(text).toContain("status = 'dead'");
    const stamp = /\d{4}-\d{2}-\d{2}T[\d:.]+Z/.exec(text)?.[0];
    expect(stamp).toBeDefined();
    const cutoff = new Date(stamp as string).getTime();
    expect(before - cutoff).toBeGreaterThanOrEqual(24 * 3_600_000 - 5_000);
    expect(before - cutoff).toBeLessThanOrEqual(24 * 3_600_000 + 5_000);
  });

  it("worker sem batimento: nem ok nem live, 503 nas duas sondas", async () => {
    database(null, []);
    expect((await get()).status).toBe(503);
    database(null, []);
    const live = await get("?probe=live");
    expect(live.status).toBe(503);
    expect(await live.json()).toMatchObject({ live: false });
  });

  it("banco fora: 503 nas duas sondas, sem o erro do banco na resposta", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      for (const query of ["", "?probe=live"]) {
        vi.mocked(db).mockImplementation(() => {
          throw new Error("connect ECONNREFUSED postgres://studio:hunter2@db/studio");
        });
        const res = await get(query);
        expect(res.status).toBe(503);
        const text = await res.text();
        expect(text).not.toContain("hunter2");
        expect(JSON.parse(text).checks.db).toEqual({ ok: false, detail: "unreachable" });
      }
    } finally {
      errors.mockRestore();
    }
  });
});
