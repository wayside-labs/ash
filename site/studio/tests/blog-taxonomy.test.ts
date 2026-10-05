import { asc, eq, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { auditLog, blogAuthors, blogCategories, blogPosts, jobs } from "@/db/schema";
import { AuthorInUseError, deleteAuthor, listAuthors, upsertAuthor } from "@/blog/authors";
import { deleteCategory, listCategories, upsertCategory } from "@/blog/categories";
import { NotFoundError, ValidationError, pgError } from "@/blog/errors";
import { createPost } from "@/blog/posts";
import { ACTOR, postInput, seedAuthor } from "./helpers/blog";
import { describeDb, freshDb } from "./helpers/db";

const MISSING = "00000000-0000-4000-8000-000000000000";
const t0 = new Date("2099-01-01T12:00:00Z");

// One database for the block; each test works on slugs of its own.
describeDb("categorias e autores", () => {
  let db: Db;
  let close: () => Promise<void>;
  let authorId: string;
  beforeAll(async () => {
    ({ db, close } = await freshDb());
    authorId = await seedAuthor(db, "autora-dos-posts");
  });
  afterAll(async () => close());

  const publish = (id: string) =>
    db.update(blogPosts).set({ status: "publicado", publishedAt: t0 }).where(eq(blogPosts.id, id));

  it("categoria: upsert pelo slug cria e depois renomeia a mesma linha", async () => {
    const created = await upsertCategory(db, {
      slug: "pagamentos",
      name_pt: "Pagamentos",
      name_en: "Payments",
    }, ACTOR);
    const renamed = await upsertCategory(db, {
      slug: "pagamentos",
      name_pt: "Pagamentos de agentes",
      name_en: "Agent payments",
    }, ACTOR);
    expect(renamed.id).toBe(created.id);
    expect(renamed).toMatchObject({
      slug: "pagamentos",
      namePt: "Pagamentos de agentes",
      nameEn: "Agent payments",
    });
    const rows = await db.select().from(blogCategories).where(eq(blogCategories.slug, "pagamentos"));
    expect(rows).toHaveLength(1);
  });

  it("categoria: entrada inválida é ValidationError", async () => {
    await expect(
      upsertCategory(db, { slug: "Com Maiúscula", name_pt: "Nome", name_en: "Name" }, ACTOR),
    ).rejects.toThrow(ValidationError);
    await expect(upsertCategory(db, { slug: "sem-nome" }, ACTOR)).rejects.toThrow(ValidationError);
  });

  it("categoria: lista com contagem de posts, total e publicados, inclusive zero", async () => {
    const full = await upsertCategory(db, { slug: "cheia", name_pt: "Cheia", name_en: "Full" }, ACTOR);
    await upsertCategory(db, { slug: "vazia", name_pt: "Vazia", name_en: "Empty" }, ACTOR);
    const ids: string[] = [];
    for (const n of [1, 2, 3]) {
      const { id } = await createPost(
        db,
        postInput(authorId, { title: `Post da categoria cheia ${n}`, category_id: full.id }),
        ACTOR,
      );
      ids.push(id);
    }
    await publish(ids[0]!);

    const list = await listCategories(db);
    expect(list.find((c) => c.slug === "cheia")).toMatchObject({ postCount: 3, publishedCount: 1 });
    expect(list.find((c) => c.slug === "vazia")).toMatchObject({ postCount: 0, publishedCount: 0 });
    const names = list.map((c) => c.namePt);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
  });

  it("categoria: apagar deixa os posts sem categoria; id inexistente falha", async () => {
    const category = await upsertCategory(db, {
      slug: "passageira",
      name_pt: "Passageira",
      name_en: "Passing",
    }, ACTOR);
    const { id } = await createPost(
      db,
      postInput(authorId, { title: "Post de categoria passageira", category_id: category.id }),
      ACTOR,
    );
    await deleteCategory(db, category.id, ACTOR);
    const [post] = await db.select().from(blogPosts).where(eq(blogPosts.id, id));
    expect(post?.categoryId).toBeNull();
    await expect(deleteCategory(db, category.id, ACTOR)).rejects.toThrow(NotFoundError);
    await expect(deleteCategory(db, "nao-e-uuid", ACTOR)).rejects.toThrow(NotFoundError);
  });

  it("autor: upsert pelo slug cria e depois atualiza a mesma linha, limpando o omitido", async () => {
    const created = await upsertAuthor(db, {
      slug: "lucas",
      name: "Lucas",
      bio_pt: "Bio",
      bio_en: "Bio en",
      avatar_url: "/media/autores/lucas.webp",
    }, ACTOR);
    expect(created).toMatchObject({ bioPt: "Bio", avatarUrl: "/media/autores/lucas.webp" });
    const updated = await upsertAuthor(db, { slug: "lucas", name: "Lucas G." }, ACTOR);
    expect(updated.id).toBe(created.id);
    expect(updated).toMatchObject({ name: "Lucas G.", bioPt: "", bioEn: "", avatarUrl: null });
    await expect(upsertAuthor(db, { slug: "x", name: "Curto" }, ACTOR)).rejects.toThrow(ValidationError);
  });

  it("autor: lista com contagem de posts", async () => {
    const busy = await upsertAuthor(db, { slug: "ocupada", name: "Ocupada" }, ACTOR);
    await upsertAuthor(db, { slug: "sem-posts", name: "Sem posts" }, ACTOR);
    const first = await createPost(
      db,
      postInput(busy.id, { title: "Primeiro post da autora ocupada" }),
      ACTOR,
    );
    await createPost(db, postInput(busy.id, { title: "Segundo post da autora ocupada" }), ACTOR);
    await publish(first.id);

    const list = await listAuthors(db);
    expect(list.find((a) => a.slug === "ocupada")).toMatchObject({
      postCount: 2,
      publishedCount: 1,
    });
    expect(list.find((a) => a.slug === "sem-posts")).toMatchObject({
      postCount: 0,
      publishedCount: 0,
    });
  });

  it("autor com post não é apagado: erro legível, e nada muda", async () => {
    const author = await upsertAuthor(db, { slug: "com-post", name: "Com post" }, ACTOR);
    const { id } = await createPost(
      db,
      postInput(author.id, { title: "Post que segura a autora" }),
      ACTOR,
    );
    const attempt = deleteAuthor(db, author.id, ACTOR);
    await expect(attempt).rejects.toThrow(AuthorInUseError);
    await expect(attempt).rejects.toThrow(/posts/);
    expect(await db.select().from(blogAuthors).where(eq(blogAuthors.id, author.id))).toHaveLength(1);
    const [post] = await db.select().from(blogPosts).where(eq(blogPosts.id, id));
    expect(post?.authorId).toBe(author.id);
  });

  it("autor sem post é apagado; id inexistente falha", async () => {
    const author = await upsertAuthor(db, { slug: "de-saida", name: "De saída" }, ACTOR);
    await deleteAuthor(db, author.id, ACTOR);
    expect(await db.select().from(blogAuthors).where(eq(blogAuthors.id, author.id))).toHaveLength(0);
    await expect(deleteAuthor(db, author.id, ACTOR)).rejects.toThrow(NotFoundError);
    await expect(deleteAuthor(db, MISSING, ACTOR)).rejects.toThrow(NotFoundError);
  });

  // These empty the queue the other tests may have filled, so they come last.
  const queued = () => db.select().from(jobs);
  const MINUTE = 60_000;

  it("categoria ou autor que nenhum post publicado usa: criar, renomear e apagar não pedem rebuild", async () => {
    await db.delete(jobs);
    const category = await upsertCategory(db, { slug: "fora-do-site", name_pt: "Fora", name_en: "Out" }, ACTOR, t0);
    await upsertCategory(db, { slug: "fora-do-site", name_pt: "Ainda fora", name_en: "Still out" }, ACTOR, t0);
    const author = await upsertAuthor(db, { slug: "fora-do-site", name: "Ninguém viu" }, ACTOR, t0);
    // A draft pointing at both changes nothing: the site only knows what is published.
    await createPost(
      db,
      postInput(author.id, { title: "Rascunho que usa os dois", category_id: category.id }),
      ACTOR,
    );
    await upsertCategory(db, { slug: "fora-do-site", name_pt: "Com rascunho", name_en: "Drafted" }, ACTOR, t0);
    await upsertAuthor(db, { slug: "fora-do-site", name: "Só rascunho" }, ACTOR, t0);
    await deleteCategory(db, category.id, ACTOR, t0);
    expect(await queued()).toHaveLength(0);
  });

  it("categoria usada por post publicado: renomear pede rebuild, e apagar também", async () => {
    const category = await upsertCategory(db, { slug: "no-site", name_pt: "No site", name_en: "Live" }, ACTOR, t0);
    const { id } = await createPost(
      db,
      postInput(authorId, { title: "Post publicado da categoria", category_id: category.id }),
      ACTOR,
    );
    await publish(id);
    await db.delete(jobs);

    await upsertCategory(db, { slug: "no-site", name_pt: "Renomeada", name_en: "Renamed" }, ACTOR, t0);
    let rows = await queued();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: "site-rebuild", status: "queued" });
    expect(rows[0]!.runAfter.getTime()).toBe(t0.getTime() + MINUTE);

    // Another minute, so the dedupe does not hide whether the delete asked too.
    const later = new Date(t0.getTime() + 5 * MINUTE);
    await deleteCategory(db, category.id, ACTOR, later);
    rows = await queued();
    expect(rows).toHaveLength(2);
    const [post] = await db.select().from(blogPosts).where(eq(blogPosts.id, id));
    expect(post).toMatchObject({ categoryId: null, status: "publicado" });
  });

  it("autor de post publicado: editar pede rebuild", async () => {
    const author = await upsertAuthor(db, { slug: "no-site", name: "Publicada" }, ACTOR, t0);
    const { id } = await createPost(
      db,
      postInput(author.id, { title: "Post publicado da autora" }),
      ACTOR,
    );
    await publish(id);
    await db.delete(jobs);

    await upsertAuthor(db, { slug: "no-site", name: "Publicada, com outro nome" }, ACTOR, t0);
    expect(await queued()).toHaveLength(1);
  });

  it("apagar autor não enfileira nada: quem pode ser apagado não aparece em post nenhum", async () => {
    const author = await upsertAuthor(db, { slug: "some-em-silencio", name: "Some" }, ACTOR, t0);
    await db.delete(jobs);
    await deleteAuthor(db, author.id, ACTOR);
    expect(await db.select().from(jobs)).toHaveLength(0);
  });

  const audit = async (slug: string) => {
    const rows = await db
      .select()
      .from(auditLog)
      .where(sql`${auditLog.payload}->>'slug' = ${slug}`)
      .orderBy(asc(auditLog.id));
    return rows.map((r) => ({ event: r.event, actor: r.actor, payload: r.payload }));
  };

  it("categoria: salvar e apagar ficam na auditoria, com quem fez", async () => {
    const slug = "auditada";
    const created = await upsertCategory(db, { slug, name_pt: "Auditada", name_en: "Audited" }, ACTOR);
    await upsertCategory(db, { slug, name_pt: "Renomeada", name_en: "Renamed" }, "outra@example.com");
    await deleteCategory(db, created.id, ACTOR);
    const payload = { id: created.id, slug };
    expect(await audit(slug)).toEqual([
      { event: "blog.category_saved", actor: ACTOR, payload },
      { event: "blog.category_saved", actor: "outra@example.com", payload },
      { event: "blog.category_deleted", actor: ACTOR, payload },
    ]);
  });

  it("autor: salvar e apagar ficam na auditoria, com quem fez", async () => {
    const slug = "auditado";
    const created = await upsertAuthor(db, { slug, name: "Auditado" }, ACTOR);
    await upsertAuthor(db, { slug, name: "Auditado, de novo" }, "outra@example.com");
    await deleteAuthor(db, created.id, "outra@example.com");
    const payload = { id: created.id, slug };
    expect(await audit(slug)).toEqual([
      { event: "blog.author_saved", actor: ACTOR, payload },
      { event: "blog.author_saved", actor: "outra@example.com", payload },
      { event: "blog.author_deleted", actor: "outra@example.com", payload },
    ]);
  });

  it("o que foi recusado não é auditado", async () => {
    const count = async () => (await db.select().from(auditLog)).length;
    const author = await upsertAuthor(db, { slug: "segura-post", name: "Segura post" }, ACTOR);
    await createPost(db, postInput(author.id, { title: "Post que segura o autor auditado" }), ACTOR);
    const before = await count();

    await expect(deleteAuthor(db, author.id, ACTOR)).rejects.toThrow(AuthorInUseError);
    await expect(deleteAuthor(db, MISSING, ACTOR)).rejects.toThrow(NotFoundError);
    await expect(deleteCategory(db, MISSING, ACTOR)).rejects.toThrow(NotFoundError);
    await expect(upsertCategory(db, { slug: "sem-nome" }, ACTOR)).rejects.toThrow(ValidationError);
    await expect(upsertAuthor(db, { slug: "x", name: "Curto" }, ACTOR)).rejects.toThrow(
      ValidationError,
    );
    expect(await count()).toBe(before);
  });
});

// This one breaks the schema on purpose, so it gets its own database.
describeDb("categorias e autores: transação", () => {
  let db: Db;
  let close: () => Promise<void>;
  beforeAll(async () => {
    ({ db, close } = await freshDb());
  });
  afterAll(async () => close());

  it("se a auditoria falha, nada é salvo nem apagado", async () => {
    const category = await upsertCategory(db, { slug: "fica", name_pt: "Fica", name_en: "Stays" }, ACTOR);
    const author = await upsertAuthor(db, { slug: "fica", name: "Fica" }, ACTOR);
    await db.execute(sql`alter table audit_log rename to audit_log_gone`);
    try {
      const attempts = [
        () => upsertCategory(db, { slug: "nova", name_pt: "Nova", name_en: "New" }, ACTOR),
        () => upsertCategory(db, { slug: "fica", name_pt: "Mudou", name_en: "Changed" }, ACTOR),
        () => deleteCategory(db, category.id, ACTOR),
        () => upsertAuthor(db, { slug: "novo", name: "Novo" }, ACTOR),
        () => upsertAuthor(db, { slug: "fica", name: "Mudou" }, ACTOR),
        () => deleteAuthor(db, author.id, ACTOR),
      ];
      for (const attempt of attempts) {
        const err = await attempt().then(
          () => null,
          (e: unknown) => e,
        );
        // 42P01 is undefined_table: the failure this test set up, and not some other one.
        expect(pgError(err)?.code).toBe("42P01");
      }
    } finally {
      await db.execute(sql`alter table audit_log_gone rename to audit_log`);
    }
    expect(await db.select().from(blogCategories)).toMatchObject([{ slug: "fica", namePt: "Fica" }]);
    expect(await db.select().from(blogAuthors)).toMatchObject([{ slug: "fica", name: "Fica" }]);
  });
});
