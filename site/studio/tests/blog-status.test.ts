import { asc, eq, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { auditLog, blogPosts, jobs } from "@/db/schema";
import { ValidationError, pgError } from "@/blog/errors";
import { hasBodyContent } from "@/blog/lib/body-content";
import { StalePostError, createPost, updatePost } from "@/blog/posts";
import { POST_ACTIONS } from "@/blog/schemas";
import { LostTransitionError, rejectPost, setPostStatus } from "@/blog/status";
import { ACTOR, editInput, postInput, seedAuthor } from "./helpers/blog";
import { describeDb, freshDb } from "./helpers/db";

const MISSING = "00000000-0000-4000-8000-000000000000";
const t0 = new Date("2099-01-01T12:00:00Z");
const t1 = new Date("2099-02-01T12:00:00Z");
const inDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString();

const STATES = ["rascunho", "revisao", "aprovado", "publicado", "rejeitado"] as const;
type State = (typeof STATES)[number];

// 42P01 is undefined_table: the rollback tests must fail for the reason they set up, not for
// some other error that would also leave the row untouched.
const failsForMissingTable = async (attempt: Promise<unknown>) => {
  const err = await attempt.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).not.toBeNull();
  expect(pgError(err)?.code).toBe("42P01");
};

let counter = 0;

function tools(get: () => Db, author: () => string) {
  const row = async (id: string) => {
    const [found] = await get().select().from(blogPosts).where(eq(blogPosts.id, id));
    return found!;
  };
  const events = async (id: string) => {
    const rows = await get()
      .select()
      .from(auditLog)
      .where(sql`${auditLog.payload}->>'postId' = ${id}`)
      .orderBy(asc(auditLog.id));
    return rows.map((r) => r.event);
  };
  // Creates through the real core, then walks the machine up to the wanted state.
  const postIn = async (
    status: State,
    overrides: Record<string, unknown> = {},
  ) => {
    counter += 1;
    const { id } = await createPost(
      get(),
      postInput(author(), { title: `Post de transição número ${counter}`, ...overrides }),
      ACTOR,
    );
    if (status === "rascunho") return id;
    await setPostStatus(get(), { id, action: "submit" }, ACTOR, t0);
    if (status === "revisao") return id;
    if (status === "rejeitado") {
      await rejectPost(get(), { id, feedback: "Falta a fonte do número" }, ACTOR, t0);
      return id;
    }
    await setPostStatus(get(), { id, action: "approve" }, ACTOR, t0);
    if (status === "aprovado") return id;
    await setPostStatus(get(), { id, action: "publish" }, ACTOR, t0);
    return id;
  };
  return { row, events, postIn };
}

describeDb("estados do post", () => {
  let db: Db;
  let close: () => Promise<void>;
  let authorId: string;
  beforeAll(async () => {
    ({ db, close } = await freshDb());
    authorId = await seedAuthor(db);
  });
  afterAll(async () => close());
  const { row, events, postIn } = tools(
    () => db,
    () => authorId,
  );

  it("caminho inteiro: rascunho, revisão, aprovado, publicado, com auditoria a cada passo", async () => {
    const id = await postIn("rascunho");
    // Every transition hands back the new updated_at: the editor's token for its next save.
    expect(await setPostStatus(db, { id, action: "submit" }, ACTOR, t0)).toEqual({
      id,
      slug: (await row(id)).slug,
      lang: "pt",
      status: "revisao",
      updatedAt: t0.toISOString(),
    });
    expect(await setPostStatus(db, { id, action: "approve" }, "revisora@example.com", t0)).toMatchObject(
      { status: "aprovado" },
    );
    expect(await setPostStatus(db, { id, action: "publish" }, ACTOR, t1)).toMatchObject({
      status: "publicado",
    });

    expect(await row(id)).toMatchObject({
      status: "publicado",
      publishedAt: t1,
      scheduledFor: null,
      updatedAt: t1,
      updatedBy: ACTOR,
    });
    const logs = await db
      .select()
      .from(auditLog)
      .where(sql`${auditLog.payload}->>'postId' = ${id}`)
      .orderBy(asc(auditLog.id));
    expect(logs.map((l) => [l.event, l.actor])).toEqual([
      ["blog.post_created", ACTOR],
      ["blog.post_submitted", ACTOR],
      ["blog.post_approved", "revisora@example.com"],
      ["blog.post_published", ACTOR],
    ]);
    expect(logs[3]!.payload).toMatchObject({ postId: id, lang: "pt", slug: (await row(id)).slug });
  });

  it("despublicar limpa a agenda e mantém a data; republicar mantém a data original", async () => {
    const id = await postIn("publicado");
    // A row published by a path that left the schedule behind (boringco's worker did).
    await db.update(blogPosts).set({ scheduledFor: t1 }).where(eq(blogPosts.id, id));

    await setPostStatus(db, { id, action: "unpublish" }, ACTOR, t1);
    expect(await row(id)).toMatchObject({
      status: "aprovado",
      scheduledFor: null,
      publishedAt: t0,
      updatedAt: t1,
    });

    await setPostStatus(db, { id, action: "publish" }, ACTOR, t1);
    expect(await row(id)).toMatchObject({ status: "publicado", publishedAt: t0 });
    expect(await events(id)).toEqual([
      "blog.post_created",
      "blog.post_submitted",
      "blog.post_approved",
      "blog.post_published",
      "blog.post_unpublished",
      "blog.post_published",
    ]);
  });

  // The next four are boringco's blog-set-post-status suite.
  it("reagenda um post aprovado e registra na auditoria", async () => {
    const id = await postIn("aprovado");
    await setPostStatus(db, { id, action: "schedule", scheduled_for: inDays(3) }, ACTOR);
    const when = inDays(10);
    await setPostStatus(db, { id, action: "schedule", scheduled_for: when }, ACTOR);

    const after = await row(id);
    expect(after.status).toBe("aprovado");
    expect(after.scheduledFor?.toISOString()).toBe(when);
    const [last] = await db
      .select()
      .from(auditLog)
      .where(sql`${auditLog.payload}->>'postId' = ${id}`)
      .orderBy(sql`${auditLog.id} desc`)
      .limit(1);
    expect(last).toMatchObject({ event: "blog.post_scheduled", actor: ACTOR });
    expect(last!.payload).toMatchObject({ scheduledFor: when });
  });

  it("recusa data no passado sem tocar no banco", async () => {
    const id = await postIn("aprovado");
    const before = await row(id);
    await expect(
      setPostStatus(db, { id, action: "schedule", scheduled_for: inDays(-1) }, ACTOR),
    ).rejects.toThrow(ValidationError);
    await expect(setPostStatus(db, { id, action: "schedule" }, ACTOR)).rejects.toThrow(
      ValidationError,
    );
    expect(await row(id)).toEqual(before);
  });

  it("recusa despublicar um post que está aprovado", async () => {
    const id = await postIn("aprovado");
    const attempt = setPostStatus(db, { id, action: "unpublish" }, ACTOR);
    await expect(attempt).rejects.toThrow(LostTransitionError);
    await expect(attempt).rejects.toThrow(/publicado/);
  });

  it("publica um agendado, limpa a agenda e recusa publicar de novo", async () => {
    const id = await postIn("aprovado");
    await setPostStatus(db, { id, action: "schedule", scheduled_for: inDays(3) }, ACTOR);
    await setPostStatus(db, { id, action: "publish" }, ACTOR, t1);
    expect(await row(id)).toMatchObject({
      status: "publicado",
      publishedAt: t1,
      scheduledFor: null,
    });
    await expect(setPostStatus(db, { id, action: "publish" }, ACTOR)).rejects.toThrow(
      LostTransitionError,
    );
  });

  it("desagendar tira a data, mantém aprovado e audita", async () => {
    const id = await postIn("aprovado");
    await setPostStatus(db, { id, action: "schedule", scheduled_for: inDays(3) }, ACTOR);

    expect(
      await setPostStatus(db, { id, action: "unschedule" }, "outra@example.com", t1),
    ).toMatchObject({ id, status: "aprovado" });
    expect(await row(id)).toMatchObject({
      status: "aprovado",
      scheduledFor: null,
      publishedAt: null,
      updatedAt: t1,
      updatedBy: "outra@example.com",
    });
    const [last] = await db
      .select()
      .from(auditLog)
      .where(sql`${auditLog.payload}->>'postId' = ${id}`)
      .orderBy(sql`${auditLog.id} desc`)
      .limit(1);
    expect(last).toMatchObject({ event: "blog.post_unscheduled", actor: "outra@example.com" });
    expect(last!.payload).toMatchObject({ postId: id, lang: "pt", slug: (await row(id)).slug });
  });

  it("desagendar um aprovado que não tem data é LostTransitionError, e nada muda", async () => {
    const id = await postIn("aprovado");
    const before = [await row(id), await events(id)];
    const attempt = setPostStatus(db, { id, action: "unschedule" }, ACTOR, t1);
    await expect(attempt).rejects.toThrow(LostTransitionError);
    // Still approved, so "is no longer approved" would be the wrong thing to tell the admin.
    await expect(attempt).rejects.toThrow("Este post não está agendado. Recarregue a página.");
    expect([await row(id), await events(id)]).toEqual(before);
    // From any other state the message is the usual one.
    const draft = await postIn("rascunho");
    await expect(setPostStatus(db, { id: draft, action: "unschedule" }, ACTOR)).rejects.toThrow(
      /não está mais em "aprovado"/,
    );

    // The second click of two: the first one already took the date away.
    await setPostStatus(db, { id, action: "schedule", scheduled_for: inDays(3) }, ACTOR);
    const results = await Promise.allSettled([
      setPostStatus(db, { id, action: "unschedule" }, ACTOR, t1),
      setPostStatus(db, { id, action: "unschedule" }, ACTOR, t1),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual(["fulfilled", "rejected"]);
    const lost = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(lost.reason).toBeInstanceOf(LostTransitionError);
    expect((await events(id)).filter((e) => e === "blog.post_unscheduled")).toHaveLength(1);
  });

  it("toda ação a partir de todo estado que não é o dela: nada muda, nada é auditado", async () => {
    const allowedFrom: Record<(typeof POST_ACTIONS)[number] | "reject", State> = {
      submit: "rascunho",
      approve: "revisao",
      reject: "revisao",
      reopen: "rejeitado",
      schedule: "aprovado",
      unschedule: "aprovado",
      publish: "aprovado",
      unpublish: "publicado",
    };
    const ids = {} as Record<State, string>;
    for (const state of STATES) ids[state] = await postIn(state);
    const snapshot = async () => {
      const out: unknown[] = [];
      for (const state of STATES) out.push(await row(ids[state]), await events(ids[state]));
      out.push((await db.select().from(jobs)).length);
      return out;
    };
    const before = await snapshot();

    let refused = 0;
    for (const [action, allowed] of Object.entries(allowedFrom)) {
      for (const state of STATES) {
        if (state === allowed) continue;
        const id = ids[state];
        const attempt =
          action === "reject"
            ? rejectPost(db, { id, feedback: "Não está em revisão" }, ACTOR, t1)
            : setPostStatus(
                db,
                action === "schedule" ? { id, action, scheduled_for: inDays(2) } : { id, action },
                ACTOR,
                t1,
              );
        await expect(attempt, `${action} from ${state}`).rejects.toThrow(LostTransitionError);
        refused += 1;
      }
    }
    // Eight actions, five states, one allowed state each.
    expect(refused).toBe(32);
    expect(await snapshot()).toEqual(before);
  });

  it("editar e publicar ao mesmo tempo: o estado, a data e a agenda limpa sobrevivem à edição", async () => {
    for (let round = 0; round < 4; round++) {
      const id = await postIn("aprovado");
      await setPostStatus(db, { id, action: "schedule", scheduled_for: inDays(3) }, ACTOR);
      const title = `Título novo da rodada ${round} da corrida`;
      const before = (await row(id)).title;
      const [edit, publish] = await Promise.allSettled([
        updatePost(db, id, await editInput(db, id, authorId, { title }), ACTOR, t1),
        setPostStatus(db, { id, action: "publish" }, ACTOR, t1),
      ]);
      // The publication never loses. The edit either went in first, or found the post moved
      // under it and was refused whole: the editor's token is from before the publication.
      expect(publish.status, `round ${round}`).toBe("fulfilled");
      if (edit.status === "rejected") expect(edit.reason).toBeInstanceOf(StalePostError);
      expect(await row(id), `round ${round}`).toMatchObject({
        status: "publicado",
        publishedAt: t1,
        scheduledFor: null,
        title: edit.status === "fulfilled" ? title : before,
      });
    }
  });

  it("esvaziar o corpo e aprovar ao mesmo tempo: nunca termina aprovado sem corpo", async () => {
    for (let round = 0; round < 4; round++) {
      const id = await postIn("revisao");
      const results = await Promise.allSettled([
        updatePost(db, id, await editInput(db, id, authorId, { body_html: "<p></p>" }), ACTOR, t1),
        setPostStatus(db, { id, action: "approve" }, ACTOR, t1),
      ]);
      // Whoever comes second sees what the first one committed, and is refused: the approval
      // for the empty body, the edit for a token from before the approval.
      expect(results.map((r) => r.status).sort(), `round ${round}`).toEqual([
        "fulfilled",
        "rejected",
      ]);
      const [edit, approval] = results as [PromiseSettledResult<unknown>, PromiseSettledResult<unknown>];
      if (edit.status === "rejected") expect(edit.reason).toBeInstanceOf(StalePostError);
      if (approval.status === "rejected") expect(approval.reason).toBeInstanceOf(ValidationError);
      const after = await row(id);
      expect(after.status === "aprovado" && !hasBodyContent(after.bodyHtml)).toBe(false);
      expect(after.status === "aprovado" || after.bodyHtml === "<p></p>").toBe(true);
    }
  });

  // if_updated_at on a transition: the version the screen was showing when the button was
  // clicked. With it, the transition only goes through on that very version.
  describe("transição com o token da versão (if_updated_at)", () => {
    const token = async (id: string) => (await row(id)).updatedAt.toISOString();
    // Each action from its own state, with what it needs besides the id.
    const ACTIONS: [string, State, Record<string, unknown>][] = [
      ["submit", "rascunho", {}],
      ["approve", "revisao", {}],
      ["reopen", "rejeitado", {}],
      ["schedule", "aprovado", { scheduled_for: inDays(3) }],
      ["publish", "aprovado", {}],
      ["unpublish", "publicado", {}],
    ];

    for (const [action, from, extra] of ACTIONS) {
      it(`${action}: com o token certo passa; com o de uma versão anterior é StalePostError e nada muda`, async () => {
        const id = await postIn(from);
        const old = await token(id);
        // Someone saves the post: the row moves on, the screen that holds `old` does not know.
        await updatePost(db, id, await editInput(db, id, authorId, { title: `Editado antes de ${action} valer` }), ACTOR);
        const before = await row(id);
        const logged = (await events(id)).length;

        const stale = setPostStatus(db, { id, action, ...extra, if_updated_at: old }, ACTOR, t1);
        await expect(stale).rejects.toThrow(StalePostError);
        await expect(stale).rejects.not.toThrow(LostTransitionError);
        expect(await row(id)).toEqual(before);
        expect(await events(id)).toHaveLength(logged);

        // With the token of the version that is there now, the same click goes through, and
        // hands back the next token.
        const fresh = await token(id);
        const moved = await setPostStatus(db, { id, action, ...extra, if_updated_at: fresh }, ACTOR, t1);
        expect(moved.updatedAt).not.toBe(fresh);
        expect(moved.updatedAt).toBe(await token(id));
      });
    }

    it("reject: o mesmo, e o comentário só é gravado quando o token bate", async () => {
      const id = await postIn("revisao");
      const old = await token(id);
      await updatePost(db, id, await editInput(db, id, authorId, { title: "Editado antes da rejeição" }), ACTOR);
      await expect(
        rejectPost(db, { id, feedback: "Falta a fonte do número", if_updated_at: old }, ACTOR, t1),
      ).rejects.toThrow(StalePostError);
      expect(await row(id)).toMatchObject({ status: "revisao", feedback: null });
      await rejectPost(db, { id, feedback: "Falta a fonte do número", if_updated_at: await token(id) }, ACTOR, t1);
      expect(await row(id)).toMatchObject({ status: "rejeitado", feedback: "Falta a fonte do número" });
    });

    it("unschedule: token velho é StalePostError; token certo sem data continua sendo NotScheduledError", async () => {
      const id = await postIn("aprovado");
      await setPostStatus(db, { id, action: "schedule", scheduled_for: inDays(3) }, ACTOR);
      const old = await token(id);
      await setPostStatus(db, { id, action: "schedule", scheduled_for: inDays(4) }, ACTOR);
      await expect(
        setPostStatus(db, { id, action: "unschedule", if_updated_at: old }, ACTOR),
      ).rejects.toThrow(StalePostError);
      expect((await row(id)).scheduledFor).not.toBeNull();

      await setPostStatus(db, { id, action: "unschedule", if_updated_at: await token(id) }, ACTOR);
      // In the right state, with no date: the date is what is missing, whatever the token says.
      for (const stamp of [await token(id), old]) {
        await expect(
          setPostStatus(db, { id, action: "unschedule", if_updated_at: stamp }, ACTOR),
        ).rejects.toThrow("Este post não está agendado. Recarregue a página.");
      }
    });

    it("estado errado continua sendo LostTransitionError, com token certo ou errado: o estado vem antes da versão", async () => {
      const id = await postIn("rascunho");
      const current = await token(id);
      for (const stamp of [current, t0.toISOString()]) {
        const attempt = setPostStatus(db, { id, action: "publish", if_updated_at: stamp }, ACTOR);
        await expect(attempt).rejects.toThrow(LostTransitionError);
        await expect(attempt).rejects.not.toThrow(StalePostError);
      }
      await expect(
        setPostStatus(db, { id: MISSING, action: "submit", if_updated_at: current }, ACTOR),
      ).rejects.toThrow(LostTransitionError);
    });

    it("a comparação é em milissegundos: linha com microssegundos aceita o token que saiu dela", async () => {
      const id = await postIn("rascunho");
      await db.execute(
        sql`update blog_posts set updated_at = '2099-01-01T12:00:00.000750Z' where id = ${id}`,
      );
      // What a page would have read from that row: the microseconds are gone.
      expect(await token(id)).toBe("2099-01-01T12:00:00.000Z");
      await expect(
        setPostStatus(db, { id, action: "submit", if_updated_at: "2099-01-01T12:00:00.001Z" }, ACTOR, t1),
      ).rejects.toThrow(StalePostError);
      const moved = await setPostStatus(
        db,
        { id, action: "submit", if_updated_at: "2099-01-01T12:00:00.000Z" },
        ACTOR,
        t1,
      );
      expect(moved.status).toBe("revisao");
    });

    it("sem token (quem chama não tem tela) a transição age sobre a linha como está", async () => {
      const id = await postIn("rascunho");
      await updatePost(db, id, await editInput(db, id, authorId, { title: "Editado, e ninguém conferiu a versão" }), ACTOR);
      await expect(setPostStatus(db, { id, action: "submit" }, ACTOR)).resolves.toMatchObject({
        status: "revisao",
      });
    });

    it("token que não é instante ISO em UTC é ValidationError, e nada muda", async () => {
      const id = await postIn("rascunho");
      const before = await row(id);
      for (const bad of ["ontem", "2099-01-01", "2099-01-01T12:00:00-03:00", 0, null, ""]) {
        await expect(
          setPostStatus(db, { id, action: "submit", if_updated_at: bad }, ACTOR),
          String(bad),
        ).rejects.toThrow(ValidationError);
        await expect(
          rejectPost(db, { id, feedback: "Falta a fonte", if_updated_at: bad }, ACTOR),
          String(bad),
        ).rejects.toThrow(ValidationError);
      }
      expect(await row(id)).toEqual(before);
    });

    it("editar e aprovar ao mesmo tempo, os dois com o token da mesma versão: só um passa", async () => {
      for (let round = 0; round < 6; round++) {
        const id = await postIn("revisao");
        const seen = await token(id);
        const title = `Título mudado durante a revisão ${round}`;
        const [edit, approval] = await Promise.allSettled([
          updatePost(db, id, await editInput(db, id, authorId, { title }), ACTOR, t1),
          setPostStatus(db, { id, action: "approve", if_updated_at: seen }, ACTOR, t1),
        ]);
        // Never both: the reviewer does not approve a text they did not read, and the author
        // does not edit under an approval.
        expect([edit.status, approval.status].sort(), `round ${round}`).toEqual([
          "fulfilled",
          "rejected",
        ]);
        const after = await row(id);
        if (edit.status === "fulfilled") {
          // The edit committed first: the approval found another version and was refused.
          expect((approval as PromiseRejectedResult).reason).toBeInstanceOf(StalePostError);
          expect(after).toMatchObject({ status: "revisao", title });
        } else {
          expect(edit.reason).toBeInstanceOf(StalePostError);
          expect(after.status).toBe("aprovado");
          expect(after.title).not.toBe(title);
        }
      }
    });

    it("a ordem certa de verdade: a edição grava, e só depois a aprovação com o token antigo chega", async () => {
      const id = await postIn("revisao");
      const seen = await token(id);
      await updatePost(db, id, await editInput(db, id, authorId, { title: "O texto mudou depois que a lista abriu" }), ACTOR, t1);
      await expect(
        setPostStatus(db, { id, action: "approve", if_updated_at: seen }, ACTOR, t1),
      ).rejects.toThrow(StalePostError);
      expect((await row(id)).status).toBe("revisao");
    });
  });

  it("post que não existe é LostTransitionError; entrada malformada é ValidationError", async () => {
    await expect(setPostStatus(db, { id: MISSING, action: "submit" }, ACTOR)).rejects.toThrow(
      LostTransitionError,
    );
    await expect(setPostStatus(db, { id: "nao-e-uuid", action: "submit" }, ACTOR)).rejects.toThrow(
      ValidationError,
    );
    await expect(setPostStatus(db, { id: MISSING, action: "reject" }, ACTOR)).rejects.toThrow(
      ValidationError,
    );
  });

  it("rejeitar exige feedback; reabrir devolve ao rascunho; aprovar depois limpa o feedback", async () => {
    const id = await postIn("revisao");
    await expect(rejectPost(db, { id }, ACTOR)).rejects.toThrow(ValidationError);
    await expect(rejectPost(db, { id, feedback: "   " }, ACTOR)).rejects.toThrow(ValidationError);
    expect((await row(id)).status).toBe("revisao");

    await rejectPost(db, { id, feedback: "  Falta a fonte do número  " }, ACTOR, t1);
    expect(await row(id)).toMatchObject({
      status: "rejeitado",
      feedback: "Falta a fonte do número",
      updatedAt: t1,
    });

    await setPostStatus(db, { id, action: "reopen" }, ACTOR, t1);
    // Still there: the author fixes the draft with the reviewer's note in front of them.
    expect(await row(id)).toMatchObject({ status: "rascunho", feedback: "Falta a fonte do número" });

    await setPostStatus(db, { id, action: "submit" }, ACTOR, t1);
    await setPostStatus(db, { id, action: "approve" }, ACTOR, t1);
    expect(await row(id)).toMatchObject({ status: "aprovado", feedback: null });
    expect(await events(id)).toEqual([
      "blog.post_created",
      "blog.post_submitted",
      "blog.post_rejected",
      "blog.post_reopened",
      "blog.post_submitted",
      "blog.post_approved",
    ]);
  });

  it("aprovar um post com o corpo de editor vazio falha", async () => {
    for (const body_html of ["", "<p></p>", "<p><br></p><p>&nbsp;</p>"]) {
      const id = await postIn("revisao", { body_html });
      await expect(setPostStatus(db, { id, action: "approve" }, ACTOR), body_html).rejects.toThrow(
        ValidationError,
      );
      expect((await row(id)).status).toBe("revisao");
      expect(await events(id)).toEqual(["blog.post_created", "blog.post_submitted"]);
    }
  });

  it("duas publicações simultâneas: uma vence, a outra perde, uma linha de auditoria", async () => {
    const id = await postIn("aprovado");
    const results = await Promise.allSettled([
      setPostStatus(db, { id, action: "publish" }, ACTOR, t1),
      setPostStatus(db, { id, action: "publish" }, ACTOR, t1),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual(["fulfilled", "rejected"]);
    const lost = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(lost.reason).toBeInstanceOf(LostTransitionError);
    expect((await events(id)).filter((e) => e === "blog.post_published")).toHaveLength(1);
  });
});

// These break the schema on purpose, so each one gets its own database.
describeDb("estados do post: transação", () => {
  let db: Db;
  let close: () => Promise<void>;
  let authorId: string;
  beforeEach(async () => {
    ({ db, close } = await freshDb());
    authorId = await seedAuthor(db);
  });
  afterEach(async () => close());
  const { row, events, postIn } = tools(
    () => db,
    () => authorId,
  );

  it("publicar e despublicar enfileiram o rebuild; as outras transições não", async () => {
    const id = await postIn("aprovado");
    await setPostStatus(db, { id, action: "schedule", scheduled_for: inDays(2) }, ACTOR);
    await setPostStatus(db, { id, action: "unschedule" }, ACTOR);
    await setPostStatus(db, { id, action: "schedule", scheduled_for: inDays(2) }, ACTOR);
    expect(await db.select().from(jobs)).toHaveLength(0);

    await setPostStatus(db, { id, action: "publish" }, ACTOR, t0);
    const queued = await db.select().from(jobs);
    expect(queued).toHaveLength(1);
    expect(queued[0]).toMatchObject({ kind: "site-rebuild", status: "queued" });
    expect(queued[0]!.runAfter.getTime()).toBe(t0.getTime() + 60_000);

    // Same minute, job still waiting: the unpublish joins it instead of adding another.
    await setPostStatus(db, { id, action: "unpublish" }, ACTOR, t0);
    expect(await db.select().from(jobs)).toHaveLength(1);

    // A later minute is a later build.
    await setPostStatus(db, { id, action: "publish" }, ACTOR, t1);
    expect(await db.select().from(jobs)).toHaveLength(2);
  });

  it("se a auditoria falha, a transição não acontece", async () => {
    const id = await postIn("rascunho");
    await db.execute(sql`alter table audit_log rename to audit_log_gone`);
    try {
      await failsForMissingTable(setPostStatus(db, { id, action: "submit" }, ACTOR, t1));
    } finally {
      await db.execute(sql`alter table audit_log_gone rename to audit_log`);
    }
    expect(await row(id)).toMatchObject({ status: "rascunho" });
    expect(await events(id)).toEqual(["blog.post_created"]);
  });

  it("se a transação falha depois da auditoria, a linha de auditoria some junto", async () => {
    const id = await postIn("aprovado");
    const before = await row(id);
    await db.execute(sql`alter table jobs rename to jobs_gone`);
    try {
      await failsForMissingTable(setPostStatus(db, { id, action: "publish" }, ACTOR, t1));
    } finally {
      await db.execute(sql`alter table jobs_gone rename to jobs`);
    }
    expect(await row(id)).toEqual(before);
    expect(await events(id)).toEqual(["blog.post_created", "blog.post_submitted", "blog.post_approved"]);
  });
});
