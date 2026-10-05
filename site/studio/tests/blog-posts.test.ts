import { asc, eq, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { auditLog, blogPosts, jobs } from "@/db/schema";
import { NotFoundError, ValidationError, pgError } from "@/blog/errors";
import { MAX_BODY_HTML_LENGTH } from "@/blog/lib/body-content";
import { setPostStatus } from "@/blog/status";
import {
  StalePostError,
  TranslationExistsError,
  countPostsByStatus,
  countScheduled,
  createPost,
  createTranslation,
  getPost,
  getTranslationSibling,
  listPosts,
  listScheduled,
  listTranslatedGroups,
  updatePost,
} from "@/blog/posts";
import { ACTOR, editInput, postInput, seedAuthor, seedCategory } from "./helpers/blog";
import { describeDb, freshDb } from "./helpers/db";

const MISSING = "00000000-0000-4000-8000-000000000000";
const t0 = new Date("2099-01-01T12:00:00Z");

// One database for the whole block: every test creates its own posts under its own titles.
describeDb("posts", () => {
  let db: Db;
  let close: () => Promise<void>;
  let authorId: string;
  let categoryId: string;
  beforeAll(async () => {
    ({ db, close } = await freshDb());
    authorId = await seedAuthor(db);
    categoryId = await seedCategory(db);
  });
  afterAll(async () => close());

  const row = async (id: string) => {
    const [found] = await db.select().from(blogPosts).where(eq(blogPosts.id, id));
    return found!;
  };
  const audit = async (id: string) => {
    const rows = await db
      .select()
      .from(auditLog)
      .where(sql`${auditLog.payload}->>'postId' = ${id}`)
      .orderBy(asc(auditLog.id));
    return rows.map((r) => ({ event: r.event, actor: r.actor, payload: r.payload }));
  };

  // Ported from boringco's blog-cover-rascunho: its "does not leak to the public" half belongs
  // to the public listing, which arrives with src/blog/public.ts.
  it("post manual nasce rascunho e guarda a capa", async () => {
    const created = await createPost(
      db,
      postInput(authorId, {
        title: "Post de teste com capa",
        excerpt: "Resumo de teste",
        category_id: categoryId,
        tags: ["Solana", "agentes"],
        cover_url: "/media/posts/novo/capa.webp",
        cover_alt: "Capa de teste",
      }),
      ACTOR,
    );
    expect(created.slug).toBe("post-de-teste-com-capa");
    expect(await row(created.id)).toMatchObject({
      status: "rascunho",
      lang: "pt",
      slug: "post-de-teste-com-capa",
      excerpt: "Resumo de teste",
      categoryId,
      authorId,
      tags: ["solana", "agentes"],
      coverUrl: "/media/posts/novo/capa.webp",
      coverAlt: "Capa de teste",
      publishedAt: null,
      scheduledFor: null,
      createdBy: ACTOR,
      updatedBy: ACTOR,
    });
    const published = await listPosts(db, { status: "publicado" });
    expect(published.some((p) => p.id === created.id)).toBe(false);
  });

  it("grava o HTML sanitizado: script e atributo de evento não chegam ao banco", async () => {
    const { id } = await createPost(
      db,
      postInput(authorId, {
        title: "Post com script no corpo",
        body_html: '<h2>Seção</h2><p onclick="x()">oi<script>alert(1)</script></p>',
      }),
      ACTOR,
    );
    expect((await row(id)).bodyHtml).toBe("<h2>Seção</h2><p>oi</p>");
  });

  it("rascunho pode nascer sem corpo", async () => {
    const { id } = await createPost(
      db,
      { lang: "pt", title: "Rascunho ainda sem corpo", author_id: authorId },
      ACTOR,
    );
    expect((await row(id)).bodyHtml).toBe("");
  });

  it("mesmo título duas vezes no idioma ganha sufixo; no outro idioma repete o slug", async () => {
    const title = "Título repetido de propósito";
    const a = await createPost(db, postInput(authorId, { title }), ACTOR);
    const b = await createPost(db, postInput(authorId, { title }), ACTOR);
    const c = await createPost(db, postInput(authorId, { title }), ACTOR);
    const en = await createPost(db, postInput(authorId, { title, lang: "en" }), ACTOR);
    expect(a.slug).toBe("titulo-repetido-de-proposito");
    expect(b.slug).toBe("titulo-repetido-de-proposito-2");
    expect(c.slug).toBe("titulo-repetido-de-proposito-3");
    expect(en.slug).toBe("titulo-repetido-de-proposito");
  });

  it("criações simultâneas com o mesmo título saem com slugs diferentes", async () => {
    const title = "Corrida pelo mesmo slug";
    const created = await Promise.all(
      [1, 2, 3].map(() => createPost(db, postInput(authorId, { title }), ACTOR)),
    );
    expect(new Set(created.map((c) => c.slug)).size).toBe(3);
    // The attempts that lost the slug were rolled back whole: one audit row per post that
    // exists, none for an insert that did not happen.
    const logged = await db
      .select()
      .from(auditLog)
      .where(sql`${auditLog.payload}->>'slug' like 'corrida-pelo-mesmo-slug%'`);
    expect(logged.map((l) => l.event)).toEqual(Array(3).fill("blog.post_created"));
    expect(logged.map((l) => l.payload.postId).sort()).toEqual(created.map((c) => c.id).sort());
  });

  it("criar, traduzir e editar ficam na auditoria, com quem fez", async () => {
    const source = await createPost(
      db,
      postInput(authorId, { title: "Post que deixa rastro na auditoria" }),
      ACTOR,
    );
    const translated = await createTranslation(
      db,
      source.id,
      postInput(authorId, { lang: "en", title: "Post that leaves an audit trail" }),
      "tradutora@example.com",
    );
    await updatePost(
      db,
      source.id,
      await editInput(db, source.id, authorId, { title: "Post que deixa rastro, editado" }),
      "outra@example.com",
      t0,
    );

    expect(await audit(source.id)).toEqual([
      {
        event: "blog.post_created",
        actor: ACTOR,
        payload: { postId: source.id, slug: source.slug, lang: "pt" },
      },
      {
        event: "blog.post_updated",
        actor: "outra@example.com",
        payload: { postId: source.id, slug: source.slug, lang: "pt", status: "rascunho" },
      },
    ]);
    expect(await audit(translated.id)).toEqual([
      {
        event: "blog.post_created",
        actor: "tradutora@example.com",
        payload: { postId: translated.id, slug: translated.slug, lang: "en" },
      },
    ]);
  });

  it("o que foi recusado não é auditado", async () => {
    const { id } = await createPost(
      db,
      postInput(authorId, { title: "Post cujas recusas não deixam rastro" }),
      ACTOR,
    );
    const count = async () => (await db.select().from(auditLog)).length;
    const before = await count();
    await expect(createPost(db, postInput(authorId, { title: "curto" }), ACTOR)).rejects.toThrow(
      ValidationError,
    );
    await expect(createPost(db, postInput(MISSING), ACTOR)).rejects.toThrow(ValidationError);
    await expect(updatePost(db, id, await editInput(db, id, authorId, { lang: "en" }), ACTOR)).rejects.toThrow(
      ValidationError,
    );
    await expect(updatePost(db, MISSING, await editInput(db, MISSING, authorId), ACTOR)).rejects.toThrow(
      NotFoundError,
    );
    expect(await count()).toBe(before);
  });

  it("título longo ainda cabe no CHECK do slug depois do sufixo", async () => {
    const title = `${"palavra ".repeat(19)}fim`;
    const a = await createPost(db, postInput(authorId, { title }), ACTOR);
    const b = await createPost(db, postInput(authorId, { title }), ACTOR);
    expect(a.slug.length).toBeLessThanOrEqual(120);
    expect(b.slug.length).toBeLessThanOrEqual(120);
    expect(b.slug).not.toBe(a.slug);
    expect(b.slug).toMatch(/-2$/);
  });

  it("entrada inválida é ValidationError e não grava nada", async () => {
    const before = (await listPosts(db)).length;
    await expect(createPost(db, postInput(authorId, { title: "curto" }), ACTOR)).rejects.toThrow(
      ValidationError,
    );
    await expect(
      createPost(db, postInput(authorId, { body_html: "<p>a</p>{{calculadora}}" }), ACTOR),
    ).rejects.toThrow(/calculadora/);
    await expect(
      createPost(db, postInput(authorId, { body_html: "<p>antes {{mapa}} depois</p>" }), ACTOR),
    ).rejects.toThrow(/mapa/);
    expect((await listPosts(db)).length).toBe(before);
  });

  it("shortcode conhecido em nível de bloco é aceito", async () => {
    const { id } = await createPost(
      db,
      postInput(authorId, { title: "Post com shortcode de bloco", body_html: "<p>a</p>{{mapa}}" }),
      ACTOR,
    );
    expect((await row(id)).bodyHtml).toBe("<p>a</p>{{mapa}}");
  });

  it("corpo que estoura o teto depois de sanitizado é ValidationError, não 500", async () => {
    // Under the cap going in; each "&" becomes "&amp;" on the way out.
    const body = `<p>${"&".repeat(MAX_BODY_HTML_LENGTH - 100)}</p>`;
    await expect(
      createPost(db, postInput(authorId, { title: "Post grande demais", body_html: body }), ACTOR),
    ).rejects.toThrow(ValidationError);
  });

  it("autor ou categoria que não existem viram ValidationError", async () => {
    await expect(createPost(db, postInput(MISSING), ACTOR)).rejects.toThrow(ValidationError);
    await expect(
      createPost(db, postInput(authorId, { category_id: MISSING }), ACTOR),
    ).rejects.toThrow(ValidationError);
  });

  it("update troca o documento inteiro, mantém o slug e limpa o que foi omitido", async () => {
    const { id, slug } = await createPost(
      db,
      postInput(authorId, {
        title: "Post que vai ser editado",
        excerpt: "Resumo",
        category_id: categoryId,
        tags: ["a"],
        meta_title: "Meta",
        featured: true,
      }),
      ACTOR,
    );
    const updated = await updatePost(
      db,
      id,
      await editInput(db, id, authorId, { title: "Outro título bem diferente", body_html: "<p>novo</p>" }),
      "outra@example.com",
      t0,
    );
    expect(updated).toEqual({ id, slug, status: "rascunho", updatedAt: t0.toISOString() });
    expect(await row(id)).toMatchObject({
      slug,
      title: "Outro título bem diferente",
      bodyHtml: "<p>novo</p>",
      excerpt: null,
      categoryId: null,
      tags: [],
      metaTitle: null,
      featured: false,
      createdBy: ACTOR,
      updatedBy: "outra@example.com",
      updatedAt: t0,
    });
  });

  it("update de id inexistente falha", async () => {
    await expect(updatePost(db, MISSING, await editInput(db, MISSING, authorId), ACTOR)).rejects.toThrow(
      NotFoundError,
    );
    await expect(updatePost(db, "nao-e-uuid", postInput(authorId), ACTOR)).rejects.toThrow(
      NotFoundError,
    );
  });

  describe("edição concorrente", () => {
    const STALE = "Alguém salvou este post depois que você abriu. Recarregue.";
    let n = 0;
    const fresh = () => {
      n += 1;
      return createPost(db, postInput(authorId, { title: `Post de edição concorrente ${n}` }), ACTOR);
    };
    const save = (id: string, token: unknown, title: string, now?: Date) =>
      updatePost(db, id, postInput(authorId, { title, if_updated_at: token }), ACTOR, now);
    const updates = async (id: string) =>
      (await audit(id)).filter((a) => a.event === "blog.post_updated").length;

    it("criar e salvar devolvem o token do próximo save, que é o updated_at da linha", async () => {
      const created = await fresh();
      expect(created.updatedAt).toBe((await row(created.id)).updatedAt.toISOString());

      const first = await save(created.id, created.updatedAt, "Primeiro save com o token da criação");
      expect(first.updatedAt).toBe((await row(created.id)).updatedAt.toISOString());
      expect(first.updatedAt).not.toBe(created.updatedAt);

      const second = await save(created.id, first.updatedAt, "Segundo save com o token do primeiro");
      expect(second.updatedAt).not.toBe(first.updatedAt);
      expect((await row(created.id)).title).toBe("Segundo save com o token do primeiro");

      const translated = await createTranslation(
        db,
        created.id,
        postInput(authorId, { lang: "en", title: `Concurrent editing post ${n}` }),
        ACTOR,
      );
      expect(translated.updatedAt).toBe((await row(translated.id)).updatedAt.toISOString());
    });

    it("save com token velho é recusado e não grava nada: nem linha, nem auditoria, nem rebuild", async () => {
      const created = await fresh();
      // Published, so an accepted save would also enqueue a rebuild.
      await db
        .update(blogPosts)
        .set({ status: "publicado", publishedAt: t0 })
        .where(eq(blogPosts.id, created.id));
      await save(created.id, created.updatedAt, "Quem salvou primeiro fica com o texto");

      const before = await row(created.id);
      const logged = (await db.select().from(auditLog)).length;
      const queued = (await db.select().from(jobs)).length;
      const attempt = save(created.id, created.updatedAt, "Quem abriu antes e salvou depois");
      await expect(attempt).rejects.toThrow(StalePostError);
      await expect(attempt).rejects.toThrow(STALE);
      expect(await row(created.id)).toEqual(before);
      expect((await db.select().from(auditLog)).length).toBe(logged);
      expect((await db.select().from(jobs)).length).toBe(queued);
    });

    it("sem token, ou com um que não é instante ISO em UTC, é ValidationError e nada muda", async () => {
      const created = await fresh();
      const before = await row(created.id);
      for (const token of [undefined, null, "", "ontem", "2099-01-01", "2099-01-01T12:00:00-03:00", 0]) {
        await expect(
          save(created.id, token, "Título que não chega a ser gravado"),
          String(token),
        ).rejects.toThrow(ValidationError);
      }
      expect(await row(created.id)).toEqual(before);
    });

    it("criar ignora um if_updated_at que venha junto: o campo é só do update", async () => {
      const created = await createPost(
        db,
        postInput(authorId, { title: "Post criado com token sobrando", if_updated_at: "lixo" }),
        ACTOR,
      );
      expect((await row(created.id)).status).toBe("rascunho");
    });

    it("dois saves simultâneos com o mesmo token: exatamente um vence", async () => {
      for (let round = 0; round < 4; round++) {
        const created = await fresh();
        const titles = [`Save A da rodada ${round} da corrida`, `Save B da rodada ${round} da corrida`];
        const results = await Promise.allSettled(
          titles.map((title) => save(created.id, created.updatedAt, title)),
        );
        expect(results.map((r) => r.status).sort(), `round ${round}`).toEqual([
          "fulfilled",
          "rejected",
        ]);
        const lost = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
        expect(lost.reason).toBeInstanceOf(StalePostError);
        const winner = titles[results.findIndex((r) => r.status === "fulfilled")];
        expect((await row(created.id)).title).toBe(winner);
        expect(await updates(created.id)).toBe(1);
      }
    });

    it("microssegundos na coluna não causam recusa falsa; um milissegundo de diferença recusa", async () => {
      const created = await fresh();
      const micros = () =>
        db.execute(
          sql`update blog_posts set updated_at = '2099-03-01T10:00:00.123999Z' where id = ${created.id}`,
        );
      await micros();
      // The premise: the column really holds more than a Date can.
      const [stored] = await db.execute<{ us: string }>(
        sql`select to_char(updated_at at time zone 'UTC', 'US') as us from blog_posts where id = ${created.id}`,
      );
      expect(stored?.us).toBe("123999");
      // What a page would hand to the editor: truncated, never rounded up to .124.
      const token = (await getPost(db, created.id))!.updatedAt.toISOString();
      expect(token).toBe("2099-03-01T10:00:00.123Z");

      for (const off of ["2099-03-01T10:00:00.124Z", "2099-03-01T10:00:00.122Z"]) {
        await expect(save(created.id, off, "Token um milissegundo fora"), off).rejects.toThrow(
          StalePostError,
        );
      }
      await save(created.id, token, "Token truncado em milissegundos é aceito");
      // The same instant written with more digits is the same instant.
      await micros();
      await save(created.id, "2099-03-01T10:00:00.123999Z", "Token com microssegundos é aceito");
    });

    it("um save sempre troca o token, mesmo com o relógio parado", async () => {
      const created = await fresh();
      const first = await save(created.id, created.updatedAt, "Save com o relógio parado, um", t0);
      const second = await save(created.id, first.updatedAt, "Save com o relógio parado, dois", t0);
      expect(first.updatedAt).toBe(t0.toISOString());
      expect(second.updatedAt).not.toBe(first.updatedAt);
      await expect(
        save(created.id, first.updatedAt, "Save com o token de antes, relógio parado", t0),
      ).rejects.toThrow(StalePostError);
    });

    it("uma transição de estado também envelhece o token, e devolve o novo", async () => {
      const created = await fresh();
      const moved = await setPostStatus(db, { id: created.id, action: "submit" }, ACTOR);
      expect(moved.updatedAt).toBe((await row(created.id)).updatedAt.toISOString());
      await expect(
        save(created.id, created.updatedAt, "Save com o token de antes do envio"),
      ).rejects.toThrow(StalePostError);
      const saved = await save(created.id, moved.updatedAt, "Save com o token que o envio devolveu");
      expect(saved.status).toBe("revisao");
    });
  });

  it("update não troca o idioma do post", async () => {
    const { id } = await createPost(
      db,
      postInput(authorId, { title: "Post que tenta mudar de idioma" }),
      ACTOR,
    );
    await expect(updatePost(db, id, await editInput(db, id, authorId, { lang: "en" }), ACTOR)).rejects.toThrow(
      ValidationError,
    );
    expect((await row(id)).lang).toBe("pt");
  });

  it("update de rascunho não enfileira rebuild; de publicado enfileira um só, com atraso", async () => {
    // The queue is shared by the block, and an earlier test saves a published post.
    await db.delete(jobs);
    const { id } = await createPost(
      db,
      postInput(authorId, { title: "Post publicado e depois editado" }),
      ACTOR,
    );
    await updatePost(db, id, await editInput(db, id, authorId, { title: "Rascunho editado uma vez" }), ACTOR, t0);
    expect(await db.select().from(jobs)).toHaveLength(0);

    await db
      .update(blogPosts)
      .set({ status: "publicado", publishedAt: t0 })
      .where(eq(blogPosts.id, id));
    await updatePost(db, id, await editInput(db, id, authorId, { title: "Publicado editado uma vez" }), ACTOR, t0);
    await updatePost(db, id, await editInput(db, id, authorId, { title: "Publicado editado de novo" }), ACTOR, t0);
    const queued = await db.select().from(jobs);
    expect(queued).toHaveLength(1);
    expect(queued[0]).toMatchObject({ kind: "site-rebuild", status: "queued" });
    expect(queued[0]!.runAfter.getTime()).toBe(t0.getTime() + 60_000);
    expect(await row(id)).toMatchObject({ status: "publicado", publishedAt: t0 });
  });

  it("post aprovado não pode ser salvo com o corpo vazio", async () => {
    const { id } = await createPost(
      db,
      postInput(authorId, { title: "Post aprovado que perderia o corpo" }),
      ACTOR,
    );
    await db.update(blogPosts).set({ status: "aprovado" }).where(eq(blogPosts.id, id));
    await expect(
      updatePost(db, id, await editInput(db, id, authorId, { body_html: "<p></p>" }), ACTOR),
    ).rejects.toThrow(ValidationError);
    expect((await row(id)).bodyHtml).toBe("<h2>Uma seção</h2><p>corpo</p>");
  });

  it("getPost devolve o post inteiro, ou null", async () => {
    const { id } = await createPost(
      db,
      postInput(authorId, { title: "Post lido por inteiro" }),
      ACTOR,
    );
    expect(await getPost(db, id)).toMatchObject({ id, bodyHtml: "<h2>Uma seção</h2><p>corpo</p>" });
    expect(await getPost(db, MISSING)).toBeNull();
    expect(await getPost(db, "nao-e-uuid")).toBeNull();
  });

  it("listPosts não traz o corpo e filtra por status e idioma", async () => {
    const { id } = await createPost(
      db,
      postInput(authorId, { title: "Post em inglês para a lista", lang: "en" }),
      ACTOR,
    );
    const all = await listPosts(db);
    expect(all.length).toBeGreaterThan(1);
    for (const p of all) expect(p).not.toHaveProperty("bodyHtml");
    const en = await listPosts(db, { lang: "en", status: "rascunho" });
    expect(en.some((p) => p.id === id)).toBe(true);
    expect(en.every((p) => p.lang === "en" && p.status === "rascunho")).toBe(true);
  });

  it("tradução nasce rascunho no mesmo grupo, com slug do próprio título", async () => {
    const source = await createPost(
      db,
      postInput(authorId, { title: "Post original em português" }),
      ACTOR,
    );
    const translated = await createTranslation(
      db,
      source.id,
      postInput(authorId, { lang: "en", title: "Original post in English" }),
      ACTOR,
    );
    expect(translated.slug).toBe("original-post-in-english");
    const [a, b] = [await row(source.id), await row(translated.id)];
    expect(b).toMatchObject({ lang: "en", status: "rascunho", createdBy: ACTOR });
    expect(b.translationGroup).toBe(a.translationGroup);
  });

  it("segunda tradução para o mesmo idioma falha limpo e não grava", async () => {
    const source = await createPost(
      db,
      postInput(authorId, { title: "Post com tradução duplicada" }),
      ACTOR,
    );
    const input = postInput(authorId, { lang: "en", title: "Post with a duplicated translation" });
    await createTranslation(db, source.id, input, ACTOR);
    const before = (await listPosts(db)).length;
    await expect(createTranslation(db, source.id, input, ACTOR)).rejects.toThrow(
      TranslationExistsError,
    );
    expect((await listPosts(db)).length).toBe(before);
  });

  it("duas traduções simultâneas para o mesmo idioma: uma entra, a outra é TranslationExistsError", async () => {
    const source = await createPost(
      db,
      postInput(authorId, { title: "Post com duas traduções ao mesmo tempo" }),
      ACTOR,
    );
    // Different titles, so the two never meet on the slug index: only (group, lang) can refuse.
    const results = await Promise.allSettled(
      ["First concurrent translation", "Second concurrent translation"].map((title) =>
        createTranslation(db, source.id, postInput(authorId, { lang: "en", title }), ACTOR),
      ),
    );
    expect(results.map((r) => r.status).sort()).toEqual(["fulfilled", "rejected"]);
    const lost = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(lost.reason).toBeInstanceOf(TranslationExistsError);
    const group = (await row(source.id)).translationGroup;
    const inGroup = await db.select().from(blogPosts).where(eq(blogPosts.translationGroup, group));
    expect(inGroup.map((p) => p.lang).sort()).toEqual(["en", "pt"]);
  });

  it("editar não muda o estado: revisão, aprovado e rejeitado continuam onde estavam", async () => {
    for (const status of ["revisao", "aprovado", "rejeitado"] as const) {
      const { id } = await createPost(
        db,
        postInput(authorId, { title: `Post editado enquanto está em ${status}` }),
        ACTOR,
      );
      await db
        .update(blogPosts)
        .set({ status, feedback: status === "rejeitado" ? "Falta a fonte" : null })
        .where(eq(blogPosts.id, id));
      const updated = await updatePost(
        db,
        id,
        await editInput(db, id, authorId, { title: `Título novo do post em ${status}` }),
        ACTOR,
        t0,
      );
      expect(updated.status).toBe(status);
      expect(await row(id)).toMatchObject({
        status,
        title: `Título novo do post em ${status}`,
        feedback: status === "rejeitado" ? "Falta a fonte" : null,
        publishedAt: null,
      });
    }
  });

  it("post publicado não pode ser salvo com o corpo vazio, e nada muda", async () => {
    const { id } = await createPost(
      db,
      postInput(authorId, { title: "Post publicado que perderia o corpo" }),
      ACTOR,
    );
    await db
      .update(blogPosts)
      .set({ status: "publicado", publishedAt: t0 })
      .where(eq(blogPosts.id, id));
    const before = await row(id);
    const queued = (await db.select().from(jobs)).length;
    for (const body_html of ["", "<p></p>", "<p><br></p>"]) {
      await expect(
        updatePost(db, id, await editInput(db, id, authorId, { title: "Outro título qualquer", body_html }), ACTOR),
      ).rejects.toThrow(ValidationError);
    }
    expect(await row(id)).toEqual(before);
    expect((await db.select().from(jobs)).length).toBe(queued);
  });

  it("tradução para o idioma que o original já tem é TranslationExistsError; de post inexistente, NotFoundError", async () => {
    const source = await createPost(
      db,
      postInput(authorId, { title: "Post traduzido para o mesmo idioma" }),
      ACTOR,
    );
    await expect(
      createTranslation(db, source.id, postInput(authorId, { title: "Outro título em pt" }), ACTOR),
    ).rejects.toThrow(TranslationExistsError);
    await expect(
      createTranslation(db, MISSING, postInput(authorId, { lang: "en" }), ACTOR),
    ).rejects.toThrow(NotFoundError);
  });
});

// This one breaks the schema on purpose, so it gets its own database.
describeDb("posts: transação", () => {
  let db: Db;
  let close: () => Promise<void>;
  let authorId: string;
  beforeAll(async () => {
    ({ db, close } = await freshDb());
    authorId = await seedAuthor(db);
  });
  afterAll(async () => close());

  it("se a auditoria falha, o post não é criado nem editado", async () => {
    const { id } = await createPost(db, postInput(authorId), ACTOR);
    const [before] = await db.select().from(blogPosts);
    await db.execute(sql`alter table audit_log rename to audit_log_gone`);
    try {
      const attempts = [
        () => createPost(db, postInput(authorId, { title: "Post que não chega a existir" }), ACTOR),
        async () =>
          updatePost(
            db,
            id,
            await editInput(db, id, authorId, { title: "Título que não é gravado" }),
            ACTOR,
          ),
      ];
      for (const attempt of attempts) {
        const err = await attempt().then(
          () => null,
          (e: unknown) => e,
        );
        // 42P01 is undefined_table: the failure this test set up, and not some other one. It is
        // also not a 23505, so the slug loop must give up instead of trying four more times.
        expect(pgError(err)?.code).toBe("42P01");
      }
    } finally {
      await db.execute(sql`alter table audit_log_gone rename to audit_log`);
    }
    expect(await db.select().from(blogPosts)).toEqual([before]);
  });
});

// Counts and limits need to know every row in the table, so this block has its own database.
describeDb("posts: listas", () => {
  let db: Db;
  let close: () => Promise<void>;
  let authorId: string;
  beforeAll(async () => {
    ({ db, close } = await freshDb());
    authorId = await seedAuthor(db);
  });
  afterAll(async () => close());

  const hour = (n: number) => new Date(t0.getTime() + n * 3_600_000);
  // Straight into the table: what is under test is the reading.
  const seed = (rows: Partial<typeof blogPosts.$inferInsert>[]) =>
    db
      .insert(blogPosts)
      .values(
        rows.map((r, i) => ({
          lang: "pt" as const,
          title: `Post de lista ${i}`,
          authorId,
          ...r,
          slug: r.slug ?? `post-de-lista-${Math.random().toString(36).slice(2, 12)}`,
        })),
      )
      .returning({ id: blogPosts.id, slug: blogPosts.slug });

  it("sem posts, a contagem traz os cinco estados com zero", async () => {
    expect(await countPostsByStatus(db)).toEqual({
      rascunho: 0,
      revisao: 0,
      aprovado: 0,
      publicado: 0,
      rejeitado: 0,
    });
    expect(await listPosts(db)).toEqual([]);
    expect(await listScheduled(db)).toEqual([]);
  });

  it("conta por estado, com zero para o que não tem, e filtra por idioma", async () => {
    await seed([
      { status: "rascunho" },
      { status: "rascunho" },
      { status: "rascunho", lang: "en" },
      { status: "revisao" },
      { status: "aprovado" },
      { status: "aprovado", scheduledFor: hour(2) },
      { status: "publicado", publishedAt: t0, lang: "en" },
    ]);
    expect(await countPostsByStatus(db)).toEqual({
      rascunho: 3,
      revisao: 1,
      aprovado: 2,
      publicado: 1,
      rejeitado: 0,
    });
    expect(await countPostsByStatus(db, { lang: "en" })).toEqual({
      rascunho: 1,
      revisao: 0,
      aprovado: 0,
      publicado: 1,
      rejeitado: 0,
    });
    expect(await countPostsByStatus(db, { lang: "pt" })).toMatchObject({ rascunho: 2, publicado: 0 });
  });

  it("agendados: só aprovado com data, do mais próximo para o mais distante, sem o corpo", async () => {
    const [late, soon, english] = await seed([
      { status: "aprovado", scheduledFor: hour(30), slug: "agendado-para-depois" },
      { status: "aprovado", scheduledFor: hour(1), slug: "agendado-para-ja" },
      { status: "aprovado", scheduledFor: hour(10), slug: "scheduled-in-english", lang: "en" },
      // Not on the list: no date, or a date on a post that is not waiting to be published.
      { status: "aprovado", slug: "aprovado-sem-data" },
      { status: "rascunho", scheduledFor: hour(5), slug: "rascunho-com-data" },
    ]);
    const all = await listScheduled(db);
    // The one from the previous test is at two hours.
    expect(all.map((p) => p.scheduledFor?.getTime())).toEqual(
      [1, 2, 10, 30].map((n) => hour(n).getTime()),
    );
    expect(all[0]?.id).toBe(soon?.id);
    expect(all.at(-1)?.id).toBe(late?.id);
    for (const p of all) {
      expect(p.status).toBe("aprovado");
      expect(p).not.toHaveProperty("bodyHtml");
    }
    expect((await listScheduled(db, { lang: "en" })).map((p) => p.id)).toEqual([english?.id]);
    expect((await listScheduled(db, { limit: 2 })).map((p) => p.id)).toEqual([soon?.id, all[1]?.id]);

    // The count is of the same posts, and "overdue" is a date at or before now.
    expect(await countScheduled(db, t0)).toEqual({ total: 4, overdue: 0 });
    expect(await countScheduled(db, hour(1))).toEqual({ total: 4, overdue: 1 });
    expect(await countScheduled(db, hour(10))).toEqual({ total: 4, overdue: 3 });
    expect(await countScheduled(db, hour(100))).toEqual({ total: 4, overdue: 4 });
  });

  it("grupos de tradução: só conta o grupo que já tem os dois idiomas, e o irmão é o outro post do grupo", async () => {
    const before = await listTranslatedGroups(db);
    const alone = await createPost(db, postInput(authorId, { title: "Um post sem tradução ainda" }), ACTOR);
    const original = await createPost(db, postInput(authorId, { title: "Um post com tradução feita" }), ACTOR);
    const translation = await createTranslation(
      db,
      original.id,
      postInput(authorId, { lang: "en", title: "A post with a translation" }),
      ACTOR,
    );
    const group = async (id: string) => {
      const [found] = await db
        .select({ id: blogPosts.id, translationGroup: blogPosts.translationGroup })
        .from(blogPosts)
        .where(eq(blogPosts.id, id));
      return found!;
    };
    const [aloneRow, originalRow, translationRow] = await Promise.all(
      [alone.id, original.id, translation.id].map(group),
    );

    const groups = await listTranslatedGroups(db);
    expect(groups.size).toBe(before.size + 1);
    expect(groups.has(originalRow!.translationGroup)).toBe(true);
    expect(groups.has(aloneRow!.translationGroup)).toBe(false);

    expect(await getTranslationSibling(db, aloneRow!)).toBeNull();
    expect(await getTranslationSibling(db, originalRow!)).toEqual({
      id: translation.id,
      title: "A post with a translation",
      lang: "en",
      status: "rascunho",
    });
    expect(await getTranslationSibling(db, translationRow!)).toMatchObject({
      id: original.id,
      lang: "pt",
    });
  });

  it("limite: padrão de 200, no máximo 500, e fora disso é ValidationError", async () => {
    const before = (await db.select({ id: blogPosts.id }).from(blogPosts)).length;
    await seed(Array.from({ length: 205 }, () => ({ status: "rejeitado" as const })));
    const total = before + 205;

    expect(await listPosts(db)).toHaveLength(200);
    expect(await listPosts(db, { limit: 500 })).toHaveLength(total);
    expect(await listPosts(db, { limit: 3 })).toHaveLength(3);
    expect(await listPosts(db, { status: "rejeitado", limit: 201 })).toHaveLength(201);
    // The newest first, whatever the limit.
    const [newest] = await listPosts(db, { limit: 1 });
    expect(newest?.id).toBe((await listPosts(db))[0]?.id);
    // The count is not capped by the list.
    expect((await countPostsByStatus(db)).rejeitado).toBe(205);

    for (const limit of [0, -1, 501, 1.5, Number.NaN, Number.POSITIVE_INFINITY, "10"]) {
      await expect(listPosts(db, { limit: limit as number }), String(limit)).rejects.toThrow(
        ValidationError,
      );
      await expect(listScheduled(db, { limit: limit as number }), String(limit)).rejects.toThrow(
        ValidationError,
      );
    }
  });
});
