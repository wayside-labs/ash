import { evaluateHealth } from "./health";

const now = new Date("2026-10-01T12:00:00Z");
const ok = {
  version: "abc123",
  nodeEnv: "production",
  dbOk: true,
  heartbeatAt: new Date(now.getTime() - 60_000),
  now,
  emailDriver: "none" as const,
  lastError: null,
  deadJobs: [],
  rebuild: "on" as const,
};

describe("evaluateHealth: o que o worker deixou para trás", () => {
  it("tudo verde: ok e live, com o estado do rebuild à vista", () => {
    const h = evaluateHealth(ok);
    expect(h).toMatchObject({ ok: true, live: true, rebuild: "on" });
    expect(h.checks.cycle).toEqual({ ok: true, detail: "no error in the last cycle" });
    expect(h.checks.jobs).toEqual({ ok: true, detail: "no dead job in the last 24 h" });
    expect(evaluateHealth({ ...ok, rebuild: "off" })).toMatchObject({ ok: true, rebuild: "off" });
  });

  it("erro no último ciclo deixa vermelho e diz qual foi, mas o processo segue vivo", () => {
    const h = evaluateHealth({ ...ok, lastError: "tick publish-due: boom" });
    expect(h).toMatchObject({ ok: false, live: true });
    expect(h.checks.cycle).toEqual({ ok: false, detail: "last cycle: tick publish-due: boom" });
  });

  it("o erro sai sem os parâmetros da consulta e com tamanho limitado", () => {
    const h = evaluateHealth({
      ...ok,
      lastError: `Failed query: update "blog_posts" set "title" = $1\nparams: Título secreto,admin@example.com`,
    });
    expect(h.checks.cycle.detail).toBe('last cycle: Failed query: update "blog_posts" set "title" = $1');
    expect(JSON.stringify(h)).not.toContain("admin@example.com");
    const long = evaluateHealth({ ...ok, lastError: "x".repeat(5_000) });
    expect(long.checks.cycle.detail.length).toBeLessThanOrEqual(220);
  });

  it("job morto nas últimas 24 h deixa vermelho e diz quantos e de que tipo", () => {
    const h = evaluateHealth({
      ...ok,
      deadJobs: [
        { kind: "site-rebuild", count: 2 },
        { kind: "ping", count: 1 },
      ],
    });
    expect(h).toMatchObject({ ok: false, live: true });
    expect(h.checks.jobs).toEqual({
      ok: false,
      detail: "3 dead in the last 24 h (site-rebuild: 2, ping: 1)",
    });
  });

  it("banco fora ou worker parado não é live", () => {
    expect(evaluateHealth({ ...ok, dbOk: false })).toMatchObject({ ok: false, live: false });
    expect(evaluateHealth({ ...ok, heartbeatAt: null })).toMatchObject({ ok: false, live: false });
    expect(evaluateHealth({ ...ok, emailDriver: "mock" })).toMatchObject({ ok: false, live: false });
  });
});

describe("evaluateHealth", () => {
  it("tudo verde", () => {
    const h = evaluateHealth(ok);
    expect(h.ok).toBe(true);
    expect(h.checks.email).toEqual({ ok: true, detail: "not wired yet" });
  });
  it("worker sem batimento há mais de 3 min fica vermelho", () => {
    expect(evaluateHealth({ ...ok, heartbeatAt: new Date(now.getTime() - 181_000) }).ok).toBe(
      false,
    );
    expect(evaluateHealth({ ...ok, heartbeatAt: null }).checks.worker.ok).toBe(false);
  });
  it("driver mock em produção é falha", () => {
    expect(evaluateHealth({ ...ok, emailDriver: "mock" }).checks.email.ok).toBe(false);
    expect(
      evaluateHealth({ ...ok, nodeEnv: "development", emailDriver: "mock" }).checks.email.ok,
    ).toBe(true);
  });
  it("banco fora derruba o health", () => {
    expect(evaluateHealth({ ...ok, dbOk: false }).ok).toBe(false);
  });
});
