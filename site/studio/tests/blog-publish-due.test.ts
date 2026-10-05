import { asc, eq, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { auditLog, blogPosts, jobs, workerHeartbeat } from "@/db/schema";
import { pgError } from "@/blog/errors";
import { StalePostError, createPost, updatePost } from "@/blog/posts";
import { publishDue, publishDueTick, splitDue } from "@/blog/publish-due";
import { setPostStatus } from "@/blog/status";
import { enqueue } from "@/jobs/queue";
import { runCycle } from "@/worker/cycle";
import { ACTOR, editInput, postInput, seedAuthor } from "./helpers/blog";
import { describeDb, freshDb } from "./helpers/db";

const t0 = new Date("2099-01-01T12:00:00Z");
const at = (ms: number) => new Date(t0.getTime() + ms);
const HOUR = 3_600_000;

const due = (slug: string, bodyHtml: string) => ({ id: slug, slug, lang: "pt" as const, bodyHtml });

// A transaction that answers from memory: the candidates the SELECT finds, and what the UPDATE
// reports as published. Enough for what publishDue decides in code.
function fakeDb(candidates: ReturnType<typeof due>[], updated = candidates) {
  const calls: string[] = [];
  const audited: unknown[] = [];
  const tx = {
    execute: async (query: { queryChunks: unknown[] }) => {
      calls.push(JSON.stringify(query.queryChunks));
    },
    select: () => ({
      from: () => ({
        where: () => ({
          orderBy: () => ({
            for: async (mode: string) => {
              calls.push(`select ordered for ${mode}`);
              return candidates;
            },
          }),
        }),
      }),
    }),
    update: () => ({
      set: () => ({
        where: () => ({
          returning: async () => {
            calls.push("update");
            return updated.map(({ id, slug, lang }) => ({ id, slug, lang }));
          },
        }),
      }),
    }),
    insert: () => ({
      values: (row: unknown) => ({
        // logAudit ends in returning(); enqueue goes through onConflictDoNothing() first.
        returning: async () => {
          audited.push(row);
          return [{ id: 1 }];
        },
        onConflictDoNothing: () => ({
          returning: async () => {
            calls.push("enqueue");
            return [{ id: "job" }];
          },
        }),
      }),
    }),
  };
  const db = { transaction: (run: (t: typeof tx) => Promise<unknown>) => run(tx) };
  return { db: db as unknown as Db, calls, audited };
}

describe("publicação agendada, sem banco", () => {
  it("splitDue: corpo de editor vazio não é publicável, e não é só a string vazia", () => {
    const good = due("bom", "<p>texto</p>");
    const image = due("so-imagem", '<p><img src="/media/posts/novo/a.webp" /></p>');
    const empties = ["", "<p></p>", "<p><br /></p>", "<p>&nbsp;</p>", "<h2></h2><p> </p>"].map(
      (body, i) => due(`vazio-${i}`, body),
    );
    const { publishable, refused } = splitDue([good, ...empties, image]);
    expect(publishable.map((p) => p.slug)).toEqual(["bom", "so-imagem"]);
    expect(refused.map((p) => p.slug)).toEqual(empties.map((p) => p.slug));
  });

  it("a transação começa por SET LOCAL statement_timeout, e o SELECT trava as linhas antes do UPDATE", async () => {
    const { db, calls } = fakeDb([due("a", "<p>x</p>")]);
    await publishDue(db, t0);
    expect(calls[0]).toContain("set local statement_timeout = ");
    expect(calls[0]).toContain("5000");
    expect(calls.slice(1)).toEqual(["select ordered for update", "update", "enqueue"]);
  });

  it("nada vencido: nem UPDATE, nem auditoria, nem rebuild", async () => {
    const { db, calls, audited } = fakeDb([]);
    expect(await publishDue(db, t0)).toEqual({ published: [], refused: [] });
    expect(calls.slice(1)).toEqual(["select ordered for update"]);
    expect(audited).toEqual([]);
  });

  it("vencidos sem corpo são recusados e devolvidos; os outros são publicados e auditados", async () => {
    const good = due("bom", "<p>texto</p>");
    const empty = due("vazio", "<p></p>");
    const { db, calls, audited } = fakeDb([good, empty], [good]);
    const out = await publishDue(db, t0);
    expect(out).toEqual({
      published: [{ id: "bom", slug: "bom", lang: "pt" }],
      refused: [{ id: "vazio", slug: "vazio", lang: "pt" }],
    });
    expect(audited).toHaveLength(1);
    expect(audited[0]).toMatchObject({
      event: "blog.post_published",
      payload: { postId: "bom", scheduled: true },
    });
    expect(calls.slice(1)).toEqual(["select ordered for update", "update", "enqueue"]);
  });

  it("só vencidos sem corpo: nenhum UPDATE, nenhum rebuild, e todos devolvidos como recusados", async () => {
    const { db, calls, audited } = fakeDb([due("v1", ""), due("v2", "<p></p>")], []);
    const out = await publishDue(db, t0);
    expect(out.published).toEqual([]);
    expect(out.refused.map((p) => p.slug)).toEqual(["v1", "v2"]);
    expect(calls.slice(1)).toEqual(["select ordered for update"]);
    expect(audited).toEqual([]);
  });

  it("o tick avisa quantos foram recusados; quais são vai só para o log; sem recusa, nada", async () => {
    const log = vi.fn();
    const ok = await publishDueTick(fakeDb([due("a", "<p>x</p>")]).db, t0, log);
    expect(ok).toBeUndefined();
    expect(log).not.toHaveBeenCalled();

    const refusedDb = fakeDb([due("titulo-ainda-secreto", ""), due("outro-rascunho", "<p></p>")], []);
    const warned = await publishDueTick(refusedDb.db, t0, log);
    // The warning ends up in the heartbeat and in /api/health, which the Docker network can read:
    // the count is enough there. A slug of an unpublished post is a title nobody announced yet.
    expect(warned).toEqual({
      warning: "2 scheduled post(s) past due and not published: empty body",
    });
    expect(JSON.stringify(warned)).not.toContain("secreto");
    expect(log).toHaveBeenCalledTimes(1);
    expect(JSON.parse(log.mock.calls[0]![0] as string)).toEqual({
      at: "publish-due",
      refused: ["pt/titulo-ainda-secreto", "pt/outro-rascunho"],
    });
  });

  it("com muitos recusados o aviso continua do mesmo tamanho", async () => {
    const many = Array.from({ length: 200 }, (_, i) => due(`post-vazio-numero-${i}`, ""));
    const warned = await publishDueTick(fakeDb(many, []).db, t0, () => {});
    expect(warned).toEqual({
      warning: "200 scheduled post(s) past due and not published: empty body",
    });
  });
});

// publishDue looks at the whole table, so each test starts from empty tables; one migration for
// the block is enough.
describeDb("publicação agendada", () => {
  let db: Db;
  let close: () => Promise<void>;
  let authorId: string;
  let counter = 0;
  beforeAll(async () => {
    ({ db, close } = await freshDb());
    authorId = await seedAuthor(db);
  });
  afterAll(async () => close());
  beforeEach(async () => {
    await db.execute(sql`truncate blog_posts, audit_log, jobs, worker_heartbeat`);
  });

  const row = async (id: string) => {
    const [found] = await db.select().from(blogPosts).where(eq(blogPosts.id, id));
    return found!;
  };
  const published = () =>
    db
      .select()
      .from(auditLog)
      .where(eq(auditLog.event, "blog.post_published"))
      .orderBy(asc(auditLog.id));
  // An approved post with a schedule, written straight to the table: the schema refuses a date
  // in the past, and "due" is exactly that.
  const scheduled = async (when: Date | null, extra: Partial<typeof blogPosts.$inferInsert> = {}) => {
    counter += 1;
    const { id } = await createPost(
      db,
      postInput(authorId, { title: `Post agendado número ${counter}` }),
      ACTOR,
    );
    await db
      .update(blogPosts)
      .set({ status: "aprovado", scheduledFor: when, updatedAt: at(-HOUR), ...extra })
      .where(eq(blogPosts.id, id));
    return id;
  };
  const NOTHING = { published: [], refused: [] };

  it("post que venceu é publicado, auditado, e o rebuild entra na fila", async () => {
    const id = await scheduled(at(-1));
    const out = await publishDue(db, t0);
    const after = await row(id);
    expect(out).toEqual({ published: [{ id, slug: after.slug, lang: "pt" }], refused: [] });
    expect(after).toMatchObject({
      status: "publicado",
      publishedAt: t0,
      scheduledFor: null,
      updatedAt: t0,
      // The schedule was the admin's decision; the worker does not sign the row.
      updatedBy: ACTOR,
    });
    const logs = await published();
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ actor: null });
    expect(logs[0]!.payload).toEqual({ postId: id, slug: after.slug, lang: "pt", scheduled: true });
    const queued = await db.select().from(jobs);
    expect(queued).toHaveLength(1);
    expect(queued[0]).toMatchObject({ kind: "site-rebuild", status: "queued" });
  });

  // updated_at is the token an open editor sends back with its next save (updatePost's
  // if_updated_at). A publication is a write like any other: it has to move that token, even when
  // the worker's clock has not moved past the row.
  describe("o token de edição (updated_at) sempre avança", () => {
    const cases: [string, Date, Date][] = [
      ["agora igual ao updated_at da linha", t0, at(1)],
      ["agora anterior ao updated_at da linha", at(HOUR), at(HOUR + 1)],
      ["agora um milissegundo antes", at(1), at(2)],
      ["agora depois (o caso comum)", at(-HOUR), t0],
    ];
    for (const [label, rowUpdatedAt, expected] of cases) {
      it(label, async () => {
        const id = await scheduled(at(-1), { updatedAt: rowUpdatedAt });
        await publishDue(db, t0);
        const after = await row(id);
        expect(after.status).toBe("publicado");
        expect(after.updatedAt).toEqual(expected);
        // Never backwards, and never the same instant.
        expect(after.updatedAt.getTime()).toBeGreaterThan(rowUpdatedAt.getTime());
      });
    }

    it("linha com microssegundos: o token novo é um milissegundo inteiro adiante", async () => {
      const id = await scheduled(at(-1));
      // What defaultNow() writes: Postgres keeps microseconds, a JS Date does not.
      await db.execute(
        sql`update blog_posts set updated_at = '2099-01-01T12:00:00.000750Z' where id = ${id}`,
      );
      expect((await row(id)).updatedAt).toEqual(t0);
      await publishDue(db, t0);
      expect((await row(id)).updatedAt).toEqual(at(1));
    });

    it("o save de um editor aberto antes da publicação é recusado depois dela", async () => {
      const id = await scheduled(at(-1), { updatedAt: t0 });
      const stale = await editInput(db, id, authorId, { title: "Um título novo qualquer" });
      await publishDue(db, t0);
      await expect(updatePost(db, id, stale, ACTOR, at(5))).rejects.toThrow(StalePostError);
      expect((await row(id)).title).not.toBe("Um título novo qualquer");
      // With the token of the published version, the same save goes through.
      const fresh = await editInput(db, id, authorId, { title: "Um título novo qualquer" });
      await expect(updatePost(db, id, fresh, ACTOR, at(5))).resolves.toMatchObject({ id });
    });
  });

  it("agendado para exatamente agora já vale", async () => {
    const id = await scheduled(t0);
    await publishDue(db, t0);
    expect((await row(id)).status).toBe("publicado");
  });

  it("o que ainda não venceu, não tem data ou não está aprovado fica como está", async () => {
    const future = await scheduled(at(1));
    const unscheduled = await scheduled(null);
    const draft = await scheduled(at(-HOUR), { status: "rascunho" });
    const review = await scheduled(at(-HOUR), { status: "revisao" });
    const rejected = await scheduled(at(-HOUR), { status: "rejeitado" });
    const before = await db.select().from(blogPosts).orderBy(asc(blogPosts.id));

    expect(await publishDue(db, t0)).toEqual(NOTHING);
    expect(await db.select().from(blogPosts).orderBy(asc(blogPosts.id))).toEqual(before);
    expect(await published()).toHaveLength(0);
    expect(await db.select().from(jobs)).toHaveLength(0);
    for (const id of [future, unscheduled, draft, review, rejected]) {
      expect((await row(id)).status).not.toBe("publicado");
    }
  });

  it("vários vencidos: todos publicados, uma auditoria por post, um rebuild só", async () => {
    const ids = [await scheduled(at(-3)), await scheduled(at(-2)), await scheduled(at(-1))];
    const later = await scheduled(at(HOUR));
    const out = await publishDue(db, t0);
    expect(out.published.map((p) => p.id).sort()).toEqual([...ids].sort());
    expect((await published()).map((l) => (l.payload as { postId: string }).postId).sort()).toEqual(
      [...ids].sort(),
    );
    expect(await db.select().from(jobs)).toHaveLength(1);
    expect((await row(later)).status).toBe("aprovado");
  });

  it("post despublicado depois não volta sozinho no ciclo seguinte", async () => {
    const id = await scheduled(at(-1));
    await publishDue(db, t0);
    await setPostStatus(db, { id, action: "unpublish" }, ACTOR, at(HOUR));

    expect(await publishDue(db, at(2 * HOUR))).toEqual(NOTHING);
    expect(await publishDue(db, at(48 * HOUR))).toEqual(NOTHING);
    expect(await row(id)).toMatchObject({ status: "aprovado", scheduledFor: null, publishedAt: t0 });
    expect(await published()).toHaveLength(1);
  });

  it("republicação agendada mantém a data da primeira publicação", async () => {
    const first = at(-24 * HOUR);
    const id = await scheduled(at(-1), { publishedAt: first });
    await publishDue(db, t0);
    expect(await row(id)).toMatchObject({ status: "publicado", publishedAt: first });
  });

  it("dois ciclos ao mesmo tempo publicam uma vez e gravam uma auditoria", async () => {
    const id = await scheduled(at(-1));
    const [a, b] = await Promise.all([publishDue(db, t0), publishDue(db, t0)]);
    expect([a.published.length, b.published.length].sort()).toEqual([0, 1]);
    expect(await published()).toHaveLength(1);
    expect((await row(id)).status).toBe("publicado");
    expect(await db.select().from(jobs)).toHaveLength(1);
  });

  it("vencido com corpo vazio, de qualquer jeito de ser vazio, não é publicado e é devolvido como recusado", async () => {
    const blank = await scheduled(at(-1), { bodyHtml: "" });
    const editorEmpty = await scheduled(at(-1), { bodyHtml: "<p></p>" });
    const fine = await scheduled(at(-1));
    const before = [await row(blank), await row(editorEmpty)];

    const out = await publishDue(db, t0);
    expect(out.published.map((p) => p.id)).toEqual([fine]);
    expect(out.refused.map((p) => p.id).sort()).toEqual([blank, editorEmpty].sort());
    expect([await row(blank), await row(editorEmpty)]).toEqual(before);
    expect(await published()).toHaveLength(1);

    // Still refused on every later cycle, until someone writes a body or clears the date.
    const again = await publishDue(db, at(HOUR));
    expect(again.published).toEqual([]);
    expect(again.refused).toHaveLength(2);
  });

  it("recusado aparece no batimento do worker, a cada ciclo, sem parar a fila", async () => {
    await scheduled(at(-1), { bodyHtml: "<p></p>" });
    await enqueue(db, { kind: "ok", runAfter: at(-1) });
    let ran = false;
    const res = await runCycle(
      db,
      { ok: async () => void (ran = true) },
      { worker: "w1", now: () => t0, ticks: { "publish-due": publishDueTick } },
    );
    expect(res).toEqual({ processed: 1, failed: 0, timedOut: false });
    expect(ran).toBe(true);
    const [beat] = await db.select().from(workerHeartbeat);
    expect(beat?.lastError).toBe(
      "tick publish-due: 1 scheduled post(s) past due and not published: empty body",
    );
  });

  it("linha travada por outra transação: desiste em segundos em vez de segurar a fila", async () => {
    const id = await scheduled(at(-1));
    let release: () => void = () => {};
    const held = new Promise<void>((resolve) => void (release = resolve));
    let locked: () => void = () => {};
    const isLocked = new Promise<void>((resolve) => void (locked = resolve));
    // An admin's save that never finishes: it holds the row.
    const locker = db.transaction(async (tx) => {
      await tx.select().from(blogPosts).where(eq(blogPosts.id, id)).for("update");
      locked();
      await held;
    });
    await isLocked;

    const started = Date.now();
    const err = await publishDue(db, t0).then(
      () => null,
      (e: unknown) => e,
    );
    const elapsed = Date.now() - started;
    release();
    await locker;

    // 57014 is query_canceled: the statement timeout, not some other failure.
    expect(pgError(err)?.code).toBe("57014");
    expect(elapsed).toBeGreaterThanOrEqual(4_000);
    expect(elapsed).toBeLessThan(15_000);
    expect((await row(id)).status).toBe("aprovado");
    // The limit ended with that transaction: the next cycle publishes normally.
    expect((await publishDue(db, at(1_000))).published.map((p) => p.id)).toEqual([id]);
  });

  it("se a auditoria falha, nada é publicado", async () => {
    const id = await scheduled(at(-1));
    await db.execute(sql`alter table audit_log rename to audit_log_gone`);
    let err: unknown;
    try {
      err = await publishDue(db, t0).then(
        () => null,
        (e: unknown) => e,
      );
    } finally {
      await db.execute(sql`alter table audit_log_gone rename to audit_log`);
    }
    expect(pgError(err)?.code).toBe("42P01");
    expect(await row(id)).toMatchObject({ status: "aprovado", publishedAt: null });
    expect(await db.select().from(jobs)).toHaveLength(0);
  });

  it("roda a cada ciclo do worker, antes dos jobs", async () => {
    const id = await scheduled(at(-1));
    await enqueue(db, { kind: "ok", runAfter: at(-1) });
    let statusSeenByJob: string | undefined;
    const res = await runCycle(
      db,
      { ok: async () => void (statusSeenByJob = (await row(id)).status) },
      { worker: "w1", now: () => t0, ticks: { "publish-due": publishDueTick } },
    );
    expect(res).toEqual({ processed: 1, failed: 0, timedOut: false });
    expect(statusSeenByJob).toBe("publicado");
    const [beat] = await db.select().from(workerHeartbeat);
    expect(beat?.lastError).toBeNull();
  });

  it("falha na publicação agendada não para o ciclo e aparece no batimento", async () => {
    const id = await scheduled(at(-1));
    await enqueue(db, { kind: "ok", runAfter: at(-1) });
    let ran = false;
    await db.execute(sql`alter table audit_log rename to audit_log_gone`);
    let res: Awaited<ReturnType<typeof runCycle>>;
    try {
      res = await runCycle(
        db,
        { ok: async () => void (ran = true) },
        { worker: "w1", now: () => t0, ticks: { "publish-due": publishDueTick } },
      );
    } finally {
      await db.execute(sql`alter table audit_log_gone rename to audit_log`);
    }
    expect(res).toEqual({ processed: 1, failed: 0, timedOut: false });
    expect(ran).toBe(true);
    expect((await row(id)).status).toBe("aprovado");
    const [beat] = await db.select().from(workerHeartbeat);
    expect(beat?.lastError).toMatch(/^tick publish-due: /);
  });
});
