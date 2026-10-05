import { eq, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { auditLog, jobs, workerHeartbeat } from "@/db/schema";
import {
  SITE_REBUILD_KIND,
  enqueueSiteRebuild,
  requeueLostRebuild,
  siteRebuildHandler,
} from "@/blog/rebuild";
import { backoffMs, claimNext, enqueue, fail } from "@/jobs/queue";
import { runCycle } from "@/worker/cycle";
import { handlers } from "@/worker/handlers";
import { describeDb, freshDb } from "./helpers/db";

// On a minute boundary, so "+ n seconds" stays in a known bucket.
const t0 = new Date("2099-01-01T12:00:00Z");
const at = (ms: number) => new Date(t0.getTime() + ms);

describeDb("enfileirar o rebuild do site", () => {
  let db: Db;
  let close: () => Promise<void>;
  beforeEach(async () => {
    ({ db, close } = await freshDb());
  });
  afterEach(async () => close());

  it("rajada no mesmo minuto vira um job só, com um minuto de atraso", async () => {
    const first = await enqueueSiteRebuild(db, t0);
    expect(first).not.toBeNull();
    expect(await enqueueSiteRebuild(db, at(1_000))).toBeNull();
    expect(await enqueueSiteRebuild(db, at(59_999))).toBeNull();
    const rows = await db.select().from(jobs);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: "site-rebuild", status: "queued" });
    expect(rows[0]!.runAfter.getTime()).toBe(at(60_000).getTime());
  });

  it("pedido que chega com o job rodando não se perde: entra outro job", async () => {
    await enqueueSiteRebuild(db, t0);
    // Claimed the instant it became ready: the tightest case for the bucket argument.
    const claimedAt = at(60_000);
    const running = await claimNext(db, claimedAt);
    expect(running).not.toBeNull();

    const second = await enqueueSiteRebuild(db, claimedAt);
    expect(second).not.toBeNull();
    expect(second).not.toBe(running!.id);
    const rows = await db.select().from(jobs);
    expect(rows.map((r) => r.status).sort()).toEqual(["queued", "running"]);
  });

  it("dois pedidos de lados diferentes da virada do minuto viram dois jobs", async () => {
    expect(await enqueueSiteRebuild(db, at(59_000))).not.toBeNull();
    expect(await enqueueSiteRebuild(db, at(61_000))).not.toBeNull();
    expect(await db.select().from(jobs)).toHaveLength(2);
  });

  it("o job nasce com dez tentativas: uma queda do GitHub de horas não mata o rebuild", async () => {
    await enqueueSiteRebuild(db, t0);
    const [row] = await db.select().from(jobs);
    expect(row?.maxAttempts).toBe(10);
  });
});

describe("a janela de tentativas do rebuild", () => {
  it("nove esperas entre dez tentativas somam cerca de três horas", () => {
    const waits = [1, 2, 3, 4, 5, 6, 7, 8, 9].map(backoffMs);
    const total = waits.reduce((a, b) => a + b, 0);
    expect(total).toBe(11_010_000);
    expect(total / 3_600_000).toBeGreaterThan(3);
  });
});

// Shaped like a credential on purpose, and not one: the tests look for it in everything the
// handler writes.
const TOKEN = "ghx-test-token-0123456789";

describe("o worker conhece o job", () => {
  it("site-rebuild está registrado nos handlers", () => {
    expect(Object.keys(handlers)).toContain(SITE_REBUILD_KIND);
    expect(SITE_REBUILD_KIND).toBe("site-rebuild");
  });
});

// The failure paths never reach the database, so they need none.
describe("handler do rebuild do site: a chamada ao GitHub", () => {
  const ctx = () => ({
    db: {} as Db,
    now: t0,
    signal: new AbortController().signal,
    jobId: "11111111-1111-4111-8111-111111111111",
    attempt: 1,
  });
  const failure = async (run: Promise<void>) =>
    (await run.then(
      () => null,
      (e: unknown) => e,
    )) as Error;

  it("não segue redirecionamento: o token não vai para outro endereço", async () => {
    const fetch = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => {
      return new Response(null, { status: 500 });
    });
    await failure(siteRebuildHandler({ token: TOKEN, repo: "lglucas/ash-web", fetch })({}, ctx()));
    expect(fetch.mock.calls[0]![1]?.redirect).toBe("error");
  });

  it("um 3xx que chegasse mesmo assim é falha, não sucesso", async () => {
    const fetch = vi.fn(async () => new Response(null, { status: 302, headers: { location: "https://evil.example/" } }));
    const err = await failure(
      siteRebuildHandler({ token: TOKEN, repo: "lglucas/ash-web", fetch })({}, ctx()),
    );
    expect(err.message).toBe("github dispatch failed: HTTP 302");
  });

  it("o corpo da resposta é descartado, nunca lido para dentro do erro", async () => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(new TextEncoder().encode(`echo ${TOKEN} `));
      },
      cancel() {
        cancelled = true;
      },
    });
    const fetch = vi.fn(async () => new Response(body, { status: 403 }));
    const err = await failure(
      siteRebuildHandler({ token: TOKEN, repo: "lglucas/ash-web", fetch })({}, ctx()),
    );
    expect(err.message).toBe("github dispatch failed: HTTP 403");
    expect(cancelled).toBe(true);
  });

  it("resposta fora de 2xx lança com o status e sem o token", async () => {
    for (const status of [401, 404, 422, 500]) {
      const fetch = vi.fn(async () => new Response(`bad credentials: ${TOKEN}`, { status }));
      const err = await failure(
        siteRebuildHandler({ token: TOKEN, repo: "lglucas/ash-web", fetch })({}, ctx()),
      );
      expect(err.message).toBe(`github dispatch failed: HTTP ${status}`);
      expect(JSON.stringify(err, Object.getOwnPropertyNames(err))).not.toContain(TOKEN);
    }
  });

  it("erro de rede lança, com o token riscado da mensagem", async () => {
    const fetch = vi.fn(async () => {
      throw new TypeError(`fetch failed for Bearer ${TOKEN}`);
    });
    const err = await failure(
      siteRebuildHandler({ token: TOKEN, repo: "lglucas/ash-web", fetch })({}, ctx()),
    );
    expect(err.message).toMatch(/fetch failed/);
    expect(JSON.stringify(err, Object.getOwnPropertyNames(err))).not.toContain(TOKEN);
  });

  it("GitHub que não responde é cortado pelo prazo", async () => {
    const fetch = vi.fn(
      (_url: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_, reject) => {
          init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
        }),
    );
    const run = siteRebuildHandler({ token: TOKEN, repo: "lglucas/ash-web", fetch, timeoutMs: 80 })(
      {},
      ctx(),
    );
    await expect(run).rejects.toThrow(/github dispatch failed/);
  });
});

describeDb("handler do rebuild do site", () => {
  let db: Db;
  let close: () => Promise<void>;
  beforeAll(async () => {
    ({ db, close } = await freshDb());
  });
  afterAll(async () => close());
  beforeEach(async () => {
    await db.execute(sql`truncate audit_log, jobs, worker_heartbeat`);
  });

  const ctx = (signal: AbortSignal = new AbortController().signal) => ({
    db,
    now: t0,
    signal,
    jobId: "11111111-1111-4111-8111-111111111111",
    attempt: 1,
  });
  const audit = () => db.select().from(auditLog);
  const written = async () => JSON.stringify(await audit());

  it("sem token: registra site.rebuild_skipped, conclui e não chama o GitHub", async () => {
    const fetch = vi.fn();
    await siteRebuildHandler({ token: undefined, repo: "lglucas/ash-web", fetch })({}, ctx());
    expect(fetch).not.toHaveBeenCalled();
    const rows = await audit();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ event: "site.rebuild_skipped", actor: null });
    expect(rows[0]!.payload).toMatchObject({ jobId: ctx().jobId });
  });

  it("com token: um POST de repository_dispatch, com bearer, e auditoria sem o token", async () => {
    const fetch = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => {
      return new Response(null, { status: 204 });
    });
    await siteRebuildHandler({ token: TOKEN, repo: "lglucas/ash-web", fetch })({}, ctx());

    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe("https://api.github.com/repos/lglucas/ash-web/dispatches");
    expect(init?.method).toBe("POST");
    const headers = new Headers(init?.headers);
    expect(headers.get("authorization")).toBe(`Bearer ${TOKEN}`);
    expect(headers.get("accept")).toBe("application/vnd.github+json");
    expect(headers.get("user-agent")).toBeTruthy();
    expect(JSON.parse(String(init?.body))).toMatchObject({ event_type: "studio-publish" });
    expect(init?.signal).toBeInstanceOf(AbortSignal);

    const rows = await audit();
    expect(rows.map((r) => r.event)).toEqual(["site.rebuild_dispatched"]);
    expect(rows[0]!.payload).toMatchObject({ repo: "lglucas/ash-web", jobId: ctx().jobId });
    expect(await written()).not.toContain(TOKEN);
  });

  it("resposta fora de 2xx lança, com o status e sem o token nem o corpo da resposta", async () => {
    for (const status of [401, 404, 422, 500]) {
      const fetch = vi.fn(async () => new Response(`bad credentials: ${TOKEN}`, { status }));
      const run = siteRebuildHandler({ token: TOKEN, repo: "lglucas/ash-web", fetch })({}, ctx());
      const err = (await run.then(
        () => null,
        (e: unknown) => e,
      )) as Error;
      expect(err, String(status)).toBeInstanceOf(Error);
      expect(err.message).toContain(String(status));
      expect(err.message).not.toContain(TOKEN);
      expect(JSON.stringify(err, Object.getOwnPropertyNames(err))).not.toContain(TOKEN);
    }
    expect(await audit()).toHaveLength(0);
  });

  it("erro de rede lança, e se a mensagem trouxer o token ele sai riscado", async () => {
    const fetch = vi.fn(async () => {
      throw new TypeError(`fetch failed for Bearer ${TOKEN}`);
    });
    const run = siteRebuildHandler({ token: TOKEN, repo: "lglucas/ash-web", fetch })({}, ctx());
    const err = (await run.then(
      () => null,
      (e: unknown) => e,
    )) as Error;
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toMatch(/fetch failed/);
    expect(err.message).not.toContain(TOKEN);
    expect(JSON.stringify(err, Object.getOwnPropertyNames(err))).not.toContain(TOKEN);
    expect(await audit()).toHaveLength(0);
  });

  it("GitHub que não responde é cortado pelo prazo", async () => {
    const fetch = vi.fn(
      (_url: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_, reject) => {
          init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
        }),
    );
    const started = Date.now();
    const run = siteRebuildHandler({ token: TOKEN, repo: "lglucas/ash-web", fetch, timeoutMs: 80 })(
      {},
      ctx(),
    );
    await expect(run).rejects.toThrow(/github dispatch failed/);
    expect(Date.now() - started).toBeLessThan(5_000);
  });

  it("o sinal do job (lease acabando) também corta a chamada", async () => {
    const controller = new AbortController();
    const fetch = vi.fn(
      (_url: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
        }),
    );
    const run = siteRebuildHandler({ token: TOKEN, repo: "lglucas/ash-web", fetch })(
      {},
      ctx(controller.signal),
    );
    controller.abort();
    await expect(run).rejects.toThrow(/github dispatch failed/);
  });

  it("na fila: falha volta com backoff, e nem o job nem o batimento guardam o token", async () => {
    await enqueueSiteRebuild(db, at(-60_000));
    const fetch = vi.fn(async () => new Response(TOKEN, { status: 502 }));
    const res = await runCycle(
      db,
      { [SITE_REBUILD_KIND]: siteRebuildHandler({ token: TOKEN, repo: "lglucas/ash-web", fetch }) },
      { worker: "w1", now: () => t0 },
    );
    expect(res).toEqual({ processed: 0, failed: 1, timedOut: false });
    const [job] = await db.select().from(jobs);
    expect(job).toMatchObject({ status: "queued", attempts: 1 });
    expect(job!.lastError).toContain("502");
    expect(job!.runAfter.getTime()).toBe(t0.getTime() + 30_000);
    const stored = JSON.stringify([
      await db.select().from(jobs),
      await db.select().from(workerHeartbeat),
      await audit(),
    ]);
    expect(stored).not.toContain(TOKEN);
  });

  it("na fila: sucesso conclui o job", async () => {
    await enqueueSiteRebuild(db, at(-60_000));
    const fetch = vi.fn(async () => new Response(null, { status: 204 }));
    const res = await runCycle(
      db,
      { [SITE_REBUILD_KIND]: siteRebuildHandler({ token: TOKEN, repo: "lglucas/ash-web", fetch }) },
      { worker: "w1", now: () => t0 },
    );
    expect(res).toEqual({ processed: 1, failed: 0, timedOut: false });
    const [job] = await db.select().from(jobs);
    expect(job?.status).toBe("done");
  });

  // After an outage the queue holds one job per minute in which something changed. They all ask
  // for the same thing: the site as it is now.
  const backlog = async () => {
    for (const minutes of [-30, -20, -10]) await enqueueSiteRebuild(db, at(minutes * 60_000));
    const future = await enqueueSiteRebuild(db, at(10 * 60_000));
    const other = await enqueue(db, { kind: "ok", runAfter: at(-60_000) });
    return { future: future!, other: other! };
  };
  const statusOf = async (id: string) =>
    (await db.select().from(jobs).where(eq(jobs.id, id)))[0]?.status;
  const rebuilds = async () =>
    (await db.select().from(jobs).where(eq(jobs.kind, SITE_REBUILD_KIND))).map((j) => j.status).sort();

  it("fila acumulada: um disparo só, e os outros pedidos vencidos saem como feitos", async () => {
    const { future, other } = await backlog();
    const fetch = vi.fn(async () => new Response(null, { status: 204 }));
    let otherRan = false;
    const res = await runCycle(
      db,
      {
        [SITE_REBUILD_KIND]: siteRebuildHandler({ token: TOKEN, repo: "lglucas/ash-web", fetch }),
        ok: async () => void (otherRan = true),
      },
      { worker: "w1", now: () => t0 },
    );
    expect(fetch).toHaveBeenCalledTimes(1);
    // One rebuild ran; the other kind's job is untouched by the coalescing and ran too.
    expect(res).toEqual({ processed: 2, failed: 0, timedOut: false });
    expect(otherRan).toBe(true);
    expect(await rebuilds()).toEqual(["done", "done", "done", "queued"]);
    expect(await statusOf(future)).toBe("queued");
    expect(await statusOf(other)).toBe("done");
    const [log] = await db.select().from(auditLog).where(eq(auditLog.event, "site.rebuild_dispatched"));
    expect(log!.payload).toMatchObject({ absorbed: 2 });
  });

  it("sem token, a fila acumulada também é limpa de uma vez", async () => {
    await backlog();
    const fetch = vi.fn();
    await runCycle(
      db,
      {
        [SITE_REBUILD_KIND]: siteRebuildHandler({ token: undefined, repo: "lglucas/ash-web", fetch }),
        ok: async () => {},
      },
      { worker: "w1", now: () => t0 },
    );
    expect(fetch).not.toHaveBeenCalled();
    expect(await rebuilds()).toEqual(["done", "done", "done", "queued"]);
    expect(await db.select().from(auditLog).where(eq(auditLog.event, "site.rebuild_skipped"))).toHaveLength(1);
  });

  it("disparo que falha não dá baixa em ninguém", async () => {
    await backlog();
    const fetch = vi.fn(async () => new Response(null, { status: 503 }));
    await runCycle(
      db,
      { [SITE_REBUILD_KIND]: siteRebuildHandler({ token: TOKEN, repo: "lglucas/ash-web", fetch }) },
      { worker: "w1", now: () => t0, maxJobs: 1 },
    );
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(await rebuilds()).toEqual(["queued", "queued", "queued", "queued"]);
  });

  // A rebuild that used up its attempts is a change the site never got. Health forgets a dead
  // job after 24 h; the site stays stale until something asks again. This tick is what asks.
  const died = async (when: Date) => {
    const id = await enqueue(db, { kind: SITE_REBUILD_KIND, runAfter: when, maxAttempts: 1 });
    const job = await claimNext(db, when);
    expect(job?.id).toBe(id);
    await fail(db, job!, "github dispatch failed: HTTP 503", when);
    return id!;
  };
  const succeeded = (event: string, when: Date) =>
    db.insert(auditLog).values({ event, createdAt: when, payload: {} });
  const requeued = () =>
    db.select().from(auditLog).where(eq(auditLog.event, "site.rebuild_requeued"));

  it("rebuild que morreu e nunca foi refeito volta para a fila, uma vez só", async () => {
    await died(at(-48 * 3_600_000));
    const id = await requeueLostRebuild(db, t0);
    expect(id).not.toBeNull();
    expect(await rebuilds()).toEqual(["dead", "queued"]);
    const [job] = await db.select().from(jobs).where(eq(jobs.id, id!));
    expect(job).toMatchObject({ status: "queued", maxAttempts: 10 });
    expect(job!.runAfter.getTime()).toBe(t0.getTime() + 60_000);
    expect((await requeued())[0]!.payload).toMatchObject({ jobId: id });

    // The next cycles see a rebuild already waiting, and add nothing.
    expect(await requeueLostRebuild(db, at(60_000))).toBeNull();
    expect(await requeueLostRebuild(db, at(3_600_000))).toBeNull();
    expect(await rebuilds()).toEqual(["dead", "queued"]);
    expect(await requeued()).toHaveLength(1);
  });

  it("morte anterior ao último disparo ou pulo bem-sucedido não conta", async () => {
    await died(at(-3 * 3_600_000));
    await succeeded("site.rebuild_dispatched", at(-3_600_000));
    expect(await requeueLostRebuild(db, t0)).toBeNull();

    await db.execute(sql`truncate audit_log`);
    await succeeded("site.rebuild_skipped", at(-3_600_000));
    expect(await requeueLostRebuild(db, t0)).toBeNull();
    expect(await rebuilds()).toEqual(["dead"]);
  });

  it("morte depois do último sucesso conta", async () => {
    await succeeded("site.rebuild_dispatched", at(-3 * 3_600_000));
    await died(at(-3_600_000));
    expect(await requeueLostRebuild(db, t0)).not.toBeNull();
  });

  it("sem nenhum job morto, ou com job morto de outro tipo, nada entra", async () => {
    expect(await requeueLostRebuild(db, t0)).toBeNull();
    const other = await enqueue(db, { kind: "ping", runAfter: at(-1), maxAttempts: 1 });
    const job = await claimNext(db, t0);
    expect(job?.id).toBe(other);
    await fail(db, job!, "boom", t0);
    expect(await requeueLostRebuild(db, t0)).toBeNull();
    expect(await db.select().from(jobs)).toHaveLength(1);
  });

  it("com um rebuild rodando, espera: quem está rodando pode ser o que resolve", async () => {
    await died(at(-2 * 3_600_000));
    await enqueueSiteRebuild(db, at(-120_000));
    expect((await claimNext(db, t0))?.kind).toBe(SITE_REBUILD_KIND);
    expect(await requeueLostRebuild(db, t0)).toBeNull();
    expect(await rebuilds()).toEqual(["dead", "running"]);
  });

  it("ciclo inteiro: morto, o tick reenfileira, o job roda, dá certo, e o tick sossega", async () => {
    // Real dates here, not 2099: the handler's audit row is stamped by the database clock, and
    // the comparison is between that and when the job died.
    const real = Date.now();
    await died(new Date(real - 48 * 3_600_000));
    const fetch = vi.fn(async () => new Response(null, { status: 204 }));
    const cycle = (now: Date) =>
      runCycle(
        db,
        { [SITE_REBUILD_KIND]: siteRebuildHandler({ token: TOKEN, repo: "lglucas/ash-web", fetch }) },
        { worker: "w1", now: () => now, ticks: { "rebuild-retry": requeueLostRebuild } },
      );
    // Cycle 1 enqueues (one minute of delay); cycle 2, after the delay, dispatches.
    expect(await cycle(new Date(real))).toEqual({ processed: 0, failed: 0, timedOut: false });
    expect(await cycle(new Date(real + 61_000))).toEqual({ processed: 1, failed: 0, timedOut: false });
    expect(fetch).toHaveBeenCalledTimes(1);
    // The success is newer than the death, so the tick has nothing left to do.
    expect(await requeueLostRebuild(db, new Date(real + 120_000))).toBeNull();
    expect(await rebuilds()).toEqual(["dead", "done"]);
  });
});

describe("reenfileirar rebuild perdido, sem banco", () => {
  const fakeDb = (lost: boolean, deduped = false) => {
    const calls: string[] = [];
    const audited: unknown[] = [];
    const tx = {
      insert: () => ({
        values: (row: unknown) => ({
          returning: async () => {
            audited.push(row);
            return [{ id: 1 }];
          },
          onConflictDoNothing: () => ({
            returning: async () => {
              calls.push("enqueue");
              // The queue answers "no row" when a job with the same dedupe key already exists.
              return deduped ? [] : [{ id: "job-novo" }];
            },
          }),
        }),
      }),
    };
    const handle = {
      execute: async (query: { queryChunks: unknown[] }) => {
        calls.push(`query:${JSON.stringify(query.queryChunks)}`);
        return [{ lost }];
      },
      transaction: (run: (t: typeof tx) => Promise<unknown>) => run(tx),
    };
    return { db: handle as unknown as Db, calls, audited };
  };

  it("uma consulta por ciclo; sem rebuild perdido, nada mais acontece", async () => {
    const { db, calls, audited } = fakeDb(false);
    expect(await requeueLostRebuild(db, t0)).toBeNull();
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain("site.rebuild_dispatched");
    expect(calls[0]).toContain("site.rebuild_skipped");
    expect(calls[0]).toContain("'dead'");
    expect(audited).toEqual([]);
  });

  it("com rebuild perdido: enfileira e audita na mesma transação", async () => {
    const { db, calls, audited } = fakeDb(true);
    expect(await requeueLostRebuild(db, t0)).toBe("job-novo");
    expect(calls.slice(1)).toEqual(["enqueue"]);
    expect(audited[0]).toMatchObject({
      event: "site.rebuild_requeued",
      payload: { jobId: "job-novo" },
    });
  });

  it("se a fila não aceitou o job (chave repetida), não diz na auditoria que reenfileirou", async () => {
    const { db, calls, audited } = fakeDb(true, true);
    expect(await requeueLostRebuild(db, t0)).toBeNull();
    expect(calls.slice(1)).toEqual(["enqueue"]);
    expect(audited).toEqual([]);
  });
});
