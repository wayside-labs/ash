import { eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { jobs, workerHeartbeat } from "@/db/schema";
import { enqueue, reapExpired } from "@/jobs/queue";
import { runCycle } from "@/worker/cycle";
import { describeDb, freshDb } from "./helpers/db";

const t0 = new Date("2099-01-01T12:00:00Z");

describeDb("runCycle", () => {
  let db: Db;
  let close: () => Promise<void>;
  beforeEach(async () => {
    ({ db, close } = await freshDb());
  });
  afterEach(async () => close());

  it("processa, registra falha de kind sem handler e bate o ponto", async () => {
    const seen: unknown[] = [];
    await enqueue(db, { kind: "ok", payload: { n: 1 } });
    const bad = await enqueue(db, { kind: "desconhecido", maxAttempts: 1 });
    const res = await runCycle(db, { ok: async (p) => void seen.push(p) }, { worker: "w1" });
    expect(res).toEqual({ processed: 1, failed: 1, timedOut: false });
    expect(seen).toEqual([{ n: 1 }]);
    const [dead] = await db.select().from(jobs).where(eq(jobs.id, bad!));
    expect(dead).toMatchObject({
      status: "dead",
      lastError: 'no handler for kind "desconhecido"',
    });
    const [beat] = await db.select().from(workerHeartbeat);
    expect(beat).toMatchObject({ worker: "w1", lastError: 'no handler for kind "desconhecido"' });
  });

  it("handler que lança, com tentativas sobrando, volta para a fila com backoff", async () => {
    const id = await enqueue(db, { kind: "boom" });
    const handlers = {
      boom: async () => {
        throw new Error("boom");
      },
    };
    await runCycle(db, handlers, { worker: "w1", now: () => t0 });
    const [row] = await db.select().from(jobs).where(eq(jobs.id, id!));
    expect(row).toMatchObject({ status: "queued", lastError: "boom", attempts: 1 });
    expect(row!.runAfter.getTime()).toBe(t0.getTime() + 30_000);
  });

  it("respeita maxJobs", async () => {
    for (let i = 0; i < 3; i++) await enqueue(db, { kind: "ok" });
    const res = await runCycle(db, { ok: async () => {} }, { worker: "w1", maxJobs: 2 });
    expect(res).toEqual({ processed: 2, failed: 0, timedOut: false });
  });

  it("shouldStop é checado antes de cada claim", async () => {
    const id = await enqueue(db, { kind: "ok" });
    const res = await runCycle(
      db,
      { ok: async () => {} },
      { worker: "w1", shouldStop: () => true },
    );
    expect(res).toEqual({ processed: 0, failed: 0, timedOut: false });
    const [row] = await db.select().from(jobs).where(eq(jobs.id, id!));
    expect(row?.status).toBe("queued");
    expect(await db.select().from(workerHeartbeat)).toHaveLength(1);
  });

  it("lease perdida no complete não derruba o ciclo e o batimento é gravado", async () => {
    const id = await enqueue(db, { kind: "slow" });
    const handlers = {
      slow: async () => {
        // Another process reaps the lease while the handler is still running.
        await reapExpired(db, new Date(t0.getTime() + 3_600_000));
      },
    };
    const res = await runCycle(db, handlers, { worker: "w1", now: () => t0 });
    expect(res).toEqual({ processed: 0, failed: 0, timedOut: false });
    const [row] = await db.select().from(jobs).where(eq(jobs.id, id!));
    expect(row?.status).toBe("queued");
    expect(await db.select().from(workerHeartbeat)).toHaveLength(1);
  });

  it("handler que nunca termina estoura o prazo e recebe o signal abortado", async () => {
    const id = await enqueue(db, { kind: "hang" });
    let signal: AbortSignal | undefined;
    const handlers = {
      hang: (_p: Record<string, unknown>, ctx: { signal: AbortSignal }) => {
        signal = ctx.signal;
        return new Promise<void>(() => {});
      },
    };
    const res = await runCycle(db, handlers, { worker: "w1", leaseMs: 2_000 });
    expect(res).toEqual({ processed: 0, failed: 1, timedOut: true });
    expect(signal?.aborted).toBe(true);
    const [row] = await db.select().from(jobs).where(eq(jobs.id, id!));
    expect(row).toMatchObject({ status: "queued", lastError: "handler timed out after 1s" });
  });

  it("handler com timeout encerra o ciclo: nenhum claim depois dele", async () => {
    const hung = await enqueue(db, { kind: "hang" });
    const later = await enqueue(db, { kind: "ok", runAfter: new Date(Date.now() + 1) });
    let okRan = false;
    const handlers = {
      hang: () => new Promise<void>(() => {}),
      ok: async () => void (okRan = true),
    };
    await new Promise((r) => setTimeout(r, 5));
    const res = await runCycle(db, handlers, { worker: "w1", leaseMs: 2_000 });
    expect(res.timedOut).toBe(true);
    expect(okRan).toBe(false);
    const [row] = await db.select().from(jobs).where(eq(jobs.id, later!));
    expect(row?.status).toBe("queued");
    const [h] = await db.select().from(jobs).where(eq(jobs.id, hung!));
    expect(h?.lastError).toBe("handler timed out after 1s");
  });

  it("timeout com batimento final falhando ainda devolve timedOut", async () => {
    await enqueue(db, { kind: "hang" });
    let broken = false;
    const flaky = new Proxy(db, {
      get(target, prop, receiver) {
        if (prop === "insert" && broken) {
          return () => {
            throw new Error("beat failed");
          };
        }
        return Reflect.get(target, prop, receiver);
      },
    });
    const handlers = {
      hang: () => {
        broken = true;
        return new Promise<void>(() => {});
      },
    };
    const res = await runCycle(flaky, handlers, { worker: "w1", leaseMs: 2_000 });
    expect(res.timedOut).toBe(true);
  });

  it("um batimento antigo não sobrescreve um mais novo", async () => {
    const newer = new Date("2099-01-01T12:00:10Z");
    const older = new Date("2099-01-01T12:00:00Z");
    await runCycle(db, {}, { worker: "w1", now: () => newer });
    await runCycle(db, {}, { worker: "w1", now: () => older });
    const [beat] = await db.select().from(workerHeartbeat);
    expect(beat?.beatAt.getTime()).toBe(newer.getTime());
  });

  it("bate o ponto enquanto um handler longo roda", async () => {
    await enqueue(db, { kind: "long" });
    let before: Date | undefined;
    let after: Date | undefined;
    const beatAt = async () => (await db.select().from(workerHeartbeat))[0]?.beatAt;
    const handlers = {
      long: async () => {
        before = await beatAt();
        await new Promise((r) => setTimeout(r, 600));
        after = await beatAt();
      },
    };
    await runCycle(db, handlers, { worker: "w1", heartbeatMs: 100 });
    expect(after!.getTime()).toBeGreaterThan(before!.getTime());
  });

  it("o handler recebe jobId e attempt", async () => {
    const id = await enqueue(db, { kind: "ctx" });
    let got: { jobId: string; attempt: number } | undefined;
    await runCycle(
      db,
      { ctx: async (_p, c) => void (got = { jobId: c.jobId, attempt: c.attempt }) },
      { worker: "w1" },
    );
    expect(got).toEqual({ jobId: id, attempt: 1 });
  });
});

describe("runCycle: erro do corpo", () => {
  it("se o corpo falha e o batimento final também, o erro original sobe", async () => {
    const fake = {
      execute: () => Promise.reject(new Error("body failed")),
      insert: () => {
        throw new Error("beat failed");
      },
    };
    await expect(runCycle(fake as unknown as Db, {}, { worker: "w1" })).rejects.toThrow(
      "body failed",
    );
  });
});

// No database: an empty queue answered from memory, and the heartbeats that were written.
describe("runCycle: ticks", () => {
  const fakeDb = () => {
    const beats: Array<{ lastError: string | null }> = [];
    const handle = {
      execute: async () => [],
      insert: () => ({
        values: (row: { lastError: string | null }) => ({
          onConflictDoUpdate: async () => void beats.push(row),
        }),
      }),
    };
    return { db: handle as unknown as Db, beats };
  };
  const quiet = () => vi.spyOn(console, "error").mockImplementation(() => {});

  it("tick que devolve { warning } vai para o batimento e para o log, sem contar como falha", async () => {
    const { db, beats } = fakeDb();
    const errors = quiet();
    try {
      const res = await runCycle(
        db,
        {},
        { worker: "w1", ticks: { aviso: async () => ({ warning: "2 posts sem corpo" }) } },
      );
      expect(res).toEqual({ processed: 0, failed: 0, timedOut: false });
      expect(beats.at(-1)?.lastError).toBe("tick aviso: 2 posts sem corpo");
      expect(errors.mock.calls.flat().join("\n")).toContain("2 posts sem corpo");
    } finally {
      errors.mockRestore();
    }
  });

  it("tick que devolve outra coisa, ou nada, não deixa rastro", async () => {
    for (const result of [undefined, null, [], "texto", { published: [] }, { warning: 7 }]) {
      const { db, beats } = fakeDb();
      await runCycle(db, {}, { worker: "w1", ticks: { quieto: async () => result } });
      expect(beats.at(-1)?.lastError, JSON.stringify(result)).toBeNull();
    }
  });

  it("dois ticks com problema: o batimento guarda os dois, não só o último", async () => {
    const { db, beats } = fakeDb();
    const errors = quiet();
    try {
      await runCycle(
        db,
        {},
        {
          worker: "w1",
          ticks: {
            primeiro: async () => {
              throw new Error("boom");
            },
            quieto: async () => undefined,
            terceiro: async () => ({ warning: "1 post sem corpo" }),
          },
        },
      );
    } finally {
      errors.mockRestore();
    }
    expect(beats.at(-1)?.lastError).toBe("tick primeiro: boom; tick terceiro: 1 post sem corpo");
  });

  it("muitos problemas no mesmo ciclo: o batimento continua com tamanho limitado", async () => {
    const { db, beats } = fakeDb();
    const errors = quiet();
    const ticks = Object.fromEntries(
      Array.from({ length: 50 }, (_, i) => [`t${i}`, async () => ({ warning: "x".repeat(100) })]),
    );
    try {
      await runCycle(db, {}, { worker: "w1", ticks });
    } finally {
      errors.mockRestore();
    }
    const stored = beats.at(-1)?.lastError as string;
    expect(stored.length).toBe(2000);
    expect(stored.startsWith("tick t0: xxx")).toBe(true);
  });

  it("tick que lança não impede o seguinte de rodar", async () => {
    const { db, beats } = fakeDb();
    const errors = quiet();
    const ran: string[] = [];
    try {
      await runCycle(
        db,
        {},
        {
          worker: "w1",
          ticks: {
            primeiro: async () => {
              ran.push("primeiro");
              throw new Error("boom");
            },
            segundo: async () => void ran.push("segundo"),
          },
        },
      );
    } finally {
      errors.mockRestore();
    }
    expect(ran).toEqual(["primeiro", "segundo"]);
    expect(beats.at(-1)?.lastError).toBe("tick primeiro: boom");
  });
});
