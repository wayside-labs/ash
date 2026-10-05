import { eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { jobs } from "@/db/schema";
import {
  LostLeaseError,
  absorbDue,
  backoffMs,
  claimNext,
  complete,
  enqueue,
  fail,
  reapExpired,
} from "@/jobs/queue";
import { describeDb, freshDb } from "./helpers/db";

const t0 = new Date("2099-01-01T12:00:00Z");
const at = (ms: number) => new Date(t0.getTime() + ms);

describe("backoffMs", () => {
  it("dobra a cada tentativa e para em 1 h", () => {
    expect([1, 2, 3].map(backoffMs)).toEqual([30_000, 60_000, 120_000]);
    expect(backoffMs(20)).toBe(3_600_000);
  });
});

describeDb("fila", () => {
  let db: Db;
  let close: () => Promise<void>;
  beforeEach(async () => {
    ({ db, close } = await freshDb());
  });
  afterEach(async () => close());

  it("dedupe: mesma chave vira um job só", async () => {
    const a = await enqueue(db, { kind: "ping", dedupeKey: "k" });
    const b = await enqueue(db, { kind: "ping", dedupeKey: "k" });
    expect(a).not.toBeNull();
    expect(b).toBeNull();
  });

  it("não pega job cujo run_after está no futuro", async () => {
    await enqueue(db, { kind: "ping", runAfter: at(60_000) });
    expect(await claimNext(db, t0)).toBeNull();
    expect(await claimNext(db, at(60_000))).not.toBeNull();
  });

  it("rodadas simultâneas nunca pegam o mesmo job", async () => {
    for (let i = 0; i < 3; i++) await enqueue(db, { kind: "ping" });
    const got = await Promise.all([1, 2, 3, 4].map(() => claimNext(db, t0)));
    const ids = got.filter(Boolean).map((j) => j?.id);
    expect(ids).toHaveLength(3);
    expect(new Set(ids).size).toBe(3);
  });

  it("falha reagenda com backoff e morre na última tentativa", async () => {
    await enqueue(db, { kind: "ping", maxAttempts: 2 });
    const j1 = await claimNext(db, t0);
    await fail(db, j1!, "boom", t0);
    const [r1] = await db.select().from(jobs).where(eq(jobs.id, j1!.id));
    expect(r1).toMatchObject({ status: "queued", lastError: "boom" });
    expect(r1!.runAfter.getTime()).toBe(at(30_000).getTime());
    const j2 = await claimNext(db, at(30_000));
    await fail(db, j2!, "boom2", at(30_000));
    const [r2] = await db.select().from(jobs).where(eq(jobs.id, j1!.id));
    expect(r2).toMatchObject({ status: "dead", attempts: 2 });
  });

  it("lease vencida volta para a fila com backoff; sem tentativas, morre", async () => {
    await enqueue(db, { kind: "ping", maxAttempts: 1 });
    await enqueue(db, { kind: "ping", maxAttempts: 3 });
    const a = await claimNext(db, t0, 1_000);
    const b = await claimNext(db, t0, 1_000);
    await reapExpired(db, at(2_000));
    // Requeued, but not immediately: the backoff for attempt 1 (30 s) applies.
    expect(await claimNext(db, at(2_000))).toBeNull();
    const again = await claimNext(db, at(2_000 + 30_000));
    const survivor = [a, b].find((j) => j?.maxAttempts === 3);
    expect(again?.id).toBe(survivor?.id);
    const dead = [a, b].find((j) => j?.maxAttempts === 1);
    const [row] = await db.select().from(jobs).where(eq(jobs.id, dead!.id));
    expect(row).toMatchObject({ status: "dead", lastError: "lease expired (attempt 1)" });
  });

  it("complete de job que não está rodando é LostLeaseError, não silêncio", async () => {
    const id = await enqueue(db, { kind: "ping" });
    const ghost = { id: id!, kind: "ping", payload: {}, attempts: 1, maxAttempts: 3 };
    await expect(complete(db, ghost, t0)).rejects.toThrow(LostLeaseError);
  });

  it("fencing: quem perdeu a lease não conclui o job da tentativa seguinte", async () => {
    await enqueue(db, { kind: "ping" });
    const first = await claimNext(db, t0, 1_000);
    await reapExpired(db, at(2_000));
    const second = await claimNext(db, at(2_000 + 30_000));
    expect(second).toMatchObject({ id: first!.id, attempts: 2 });
    await expect(complete(db, first!, at(40_000))).rejects.toThrow(LostLeaseError);
    await expect(fail(db, first!, "late", at(40_000))).rejects.toThrow(LostLeaseError);
    const [row] = await db.select().from(jobs).where(eq(jobs.id, first!.id));
    expect(row).toMatchObject({ status: "running", attempts: 2 });
    await complete(db, second!, at(40_000));
    const [done] = await db.select().from(jobs).where(eq(jobs.id, first!.id));
    expect(done?.status).toBe("done");
  });

  it("dedupe vale só enquanto o job está queued ou running", async () => {
    const a = await enqueue(db, { kind: "ping", dedupeKey: "k" });
    const job = await claimNext(db, t0);
    await complete(db, job!, t0);
    const b = await enqueue(db, { kind: "ping", dedupeKey: "k" });
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
  });

  it("absorbDue dá baixa só nos jobs do mesmo kind, na fila e já vencidos, menos o que pediu", async () => {
    const self = await enqueue(db, { kind: "build", runAfter: at(-3_000) });
    const due = await enqueue(db, { kind: "build", runAfter: at(-2_000) });
    const exact = await enqueue(db, { kind: "build", runAfter: t0 });
    const future = await enqueue(db, { kind: "build", runAfter: at(1) });
    const otherKind = await enqueue(db, { kind: "ping", runAfter: at(-2_000) });
    const dead = await enqueue(db, { kind: "build", runAfter: at(-5_000), maxAttempts: 1 });
    // `dead` is the oldest, so it is the one claimed here; it fails its only attempt.
    const claimedDead = await claimNext(db, t0);
    expect(claimedDead?.id).toBe(dead);
    await fail(db, claimedDead!, "boom", t0);
    // `self` is next, and is the running job that asks for the absorption.
    const running = await claimNext(db, t0);
    expect(running?.id).toBe(self);

    expect(await absorbDue(db, { kind: "build", except: self!, now: t0 })).toBe(2);

    const status = async (id: string | null) =>
      (await db.select().from(jobs).where(eq(jobs.id, id!)))[0]?.status;
    expect(await status(self)).toBe("running");
    expect(await status(due)).toBe("done");
    expect(await status(exact)).toBe("done");
    expect(await status(future)).toBe("queued");
    expect(await status(otherKind)).toBe("queued");
    expect(await status(dead)).toBe("dead");
    // Idempotent: nothing left to absorb.
    expect(await absorbDue(db, { kind: "build", except: self!, now: t0 })).toBe(0);
  });

  it("job absorvido libera a chave de dedupe e não é mais reivindicado", async () => {
    const self = await enqueue(db, { kind: "build", dedupeKey: "a", runAfter: at(-2_000) });
    await enqueue(db, { kind: "build", dedupeKey: "b", runAfter: at(-1_000) });
    await claimNext(db, t0);
    await absorbDue(db, { kind: "build", except: self!, now: t0 });
    expect(await claimNext(db, t0)).toBeNull();
    expect(await enqueue(db, { kind: "build", dedupeKey: "b" })).not.toBeNull();
  });
});
