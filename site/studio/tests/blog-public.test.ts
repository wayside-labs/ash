import { eq, sql } from "drizzle-orm";
import { GET } from "@/app/api/public/posts/route";
import { upsertAuthor } from "@/blog/authors";
import { upsertCategory } from "@/blog/categories";
import { MAX_BODY_HTML_LENGTH } from "@/blog/lib/body-content";
import { createPost, createTranslation, updatePost } from "@/blog/posts";
import {
  type PublicPayload,
  createPublicReader,
  getPublicPayload,
  publicFingerprint,
} from "@/blog/public";
import { rejectPost, setPostStatus } from "@/blog/status";
import { type Db, db as sharedDb } from "@/db/client";
import { blogAuthors, blogPosts } from "@/db/schema";
import { ACTOR, editInput, postInput } from "./helpers/blog";
import { describeDb, freshDb } from "./helpers/db";

vi.mock("@/db/client", async (original) => ({
  ...(await original<typeof import("@/db/client")>()),
  db: vi.fn(),
}));
// The route only wants the app version (it is part of the ETag).
vi.mock("@/lib/env", async (original) => ({
  ...(await original<typeof import("@/lib/env")>()),
  env: vi.fn(() => ({ APP_VERSION: "test" })),
}));

const t0 = new Date("2099-01-01T12:00:00Z");
const at = (ms: number) => new Date(t0.getTime() + ms);
const REVIEWER = "revisora@example.com";
const FEEDBACK = "Comentário interno da revisão que não pode vazar";

const POST_KEYS = [
  "author",
  "category",
  "coverAlt",
  "coverUrl",
  "excerpt",
  "featured",
  "html",
  "lang",
  "metaDescription",
  "metaTitle",
  "publishedAt",
  "readingMinutes",
  "slug",
  "tags",
  "title",
  "toc",
  "translationSlug",
  "updatedAt",
];

// publishDue-free: each test builds what it needs and reads the whole payload, so the tables
// start empty every time; one migration for the block.
describeDb("API pública de posts", () => {
  let db: Db;
  let close: () => Promise<void>;
  let authorId: string;
  let categoryId: string;
  let counter = 0;
  const logged: unknown[] = [];
  const log = (entry: unknown) => void logged.push(entry);

  beforeAll(async () => {
    ({ db, close } = await freshDb());
  });
  afterAll(async () => close());
  beforeEach(async () => {
    await db.execute(sql`truncate blog_posts, blog_categories, blog_authors, audit_log, jobs cascade`);
    logged.length = 0;
    ({ id: authorId } = await upsertAuthor(db, {
      slug: "lucas",
      name: "Lucas",
      bio_pt: "Bio em português",
      bio_en: "Bio in English",
      avatar_url: "/media/autores/lucas.webp",
    }, ACTOR));
    ({ id: categoryId } = await upsertCategory(db, {
      slug: "pagamentos",
      name_pt: "Pagamentos",
      name_en: "Payments",
    }, ACTOR));
    vi.mocked(sharedDb).mockReset().mockReturnValue(db);
  });

  const draft = async (overrides: Record<string, unknown> = {}) => {
    counter += 1;
    return createPost(
      db,
      postInput(authorId, { title: `Post público número ${counter}`, ...overrides }),
      ACTOR,
    );
  };
  const publish = async (id: string, when: Date = t0) => {
    await setPostStatus(db, { id, action: "submit" }, ACTOR, when);
    await setPostStatus(db, { id, action: "approve" }, REVIEWER, when);
    await setPostStatus(db, { id, action: "publish" }, REVIEWER, when);
  };
  const published = async (overrides: Record<string, unknown> = {}, when: Date = t0) => {
    const post = await draft(overrides);
    await publish(post.id, when);
    return post;
  };
  const payload = () => getPublicPayload(db, log);
  const bySlug = (p: PublicPayload, slug: string) => p.posts.find((post) => post.slug === slug);

  it("o post publicado sai inteiro: corpo com âncoras, sumário, leitura, categoria, autor, capa", async () => {
    const { slug } = await published({
      title: "Como um agente paga sem a chave",
      excerpt: "Resumo do post",
      body_html: "<h2>Primeira seção</h2><p>texto</p><h3>Detalhe</h3><p>mais</p>{{mapa}}",
      category_id: categoryId,
      tags: ["Solana", "agentes"],
      featured: true,
      meta_title: "Título de SEO",
      meta_description: "Descrição de SEO",
      cover_url: "/media/posts/novo/capa.webp",
      cover_alt: "Capa",
    });
    const out = await payload();
    expect(out.posts).toHaveLength(1);
    expect(out.posts[0]).toEqual({
      slug,
      lang: "pt",
      title: "Como um agente paga sem a chave",
      excerpt: "Resumo do post",
      html: '<h2 id="primeira-secao">Primeira seção</h2><p>texto</p><h3 id="detalhe">Detalhe</h3><p>mais</p>{{mapa}}',
      toc: [
        { id: "primeira-secao", text: "Primeira seção", level: 2 },
        { id: "detalhe", text: "Detalhe", level: 3 },
      ],
      readingMinutes: 1,
      category: { slug: "pagamentos", namePt: "Pagamentos", nameEn: "Payments" },
      tags: ["solana", "agentes"],
      author: { slug: "lucas", name: "Lucas" },
      coverUrl: "/media/posts/novo/capa.webp",
      coverAlt: "Capa",
      metaTitle: "Título de SEO",
      metaDescription: "Descrição de SEO",
      featured: true,
      publishedAt: t0.toISOString(),
      // submit, approve and publish all ran at t0, and every write moves updated_at by at least a
      // millisecond (it is the token of the stale-edit check).
      updatedAt: new Date(t0.getTime() + 2).toISOString(),
      translationSlug: null,
    });
    expect(out.categories).toEqual([{ slug: "pagamentos", namePt: "Pagamentos", nameEn: "Payments" }]);
    expect(out.authors).toEqual([
      {
        slug: "lucas",
        name: "Lucas",
        bioPt: "Bio em português",
        bioEn: "Bio in English",
        avatarUrl: "/media/autores/lucas.webp",
      },
    ]);
  });

  // The second half of boringco's blog-cover-rascunho: a manual post is born a draft and the
  // public listing does not show it.
  it("rascunho com capa não vaza para o público; depois de publicado, aparece com a capa", async () => {
    const { id, slug } = await draft({
      title: "Post de teste com capa pública",
      cover_url: "/media/posts/novo/capa.webp",
      cover_alt: "Capa de teste",
    });
    const before = await payload();
    expect(bySlug(before, slug)).toBeUndefined();
    expect(JSON.stringify(before)).not.toContain("Post de teste com capa pública");

    await publish(id);
    expect(bySlug(await payload(), slug)).toMatchObject({
      coverUrl: "/media/posts/novo/capa.webp",
      coverAlt: "Capa de teste",
    });
  });

  it("só o que está publicado: nenhum outro estado aparece, nem pelo título", async () => {
    const titles = {
      rascunho: "Só rascunho, jamais público",
      revisao: "Em revisão, jamais público",
      aprovado: "Aprovado e agendado, ainda não público",
      rejeitado: "Rejeitado, jamais público",
      despublicado: "Despublicado, não é mais público",
    };
    await draft({ title: titles.rascunho });
    const review = await draft({ title: titles.revisao });
    await setPostStatus(db, { id: review.id, action: "submit" }, ACTOR, t0);
    const approved = await draft({ title: titles.aprovado });
    await setPostStatus(db, { id: approved.id, action: "submit" }, ACTOR, t0);
    await setPostStatus(db, { id: approved.id, action: "approve" }, REVIEWER, t0);
    const rejected = await draft({ title: titles.rejeitado });
    await setPostStatus(db, { id: rejected.id, action: "submit" }, ACTOR, t0);
    await rejectPost(db, { id: rejected.id, feedback: FEEDBACK }, REVIEWER, t0);
    const gone = await published({ title: titles.despublicado });
    await setPostStatus(db, { id: gone.id, action: "unpublish" }, REVIEWER, t0);
    const live = await published({ title: "O único post que está no ar" });

    const out = await payload();
    expect(out.posts.map((p) => p.slug)).toEqual([live.slug]);
    const text = JSON.stringify(out);
    for (const title of Object.values(titles)) expect(text).not.toContain(title);
  });

  it("nada interno no payload: sem e-mail de admin, sem feedback, sem ids, e só as chaves previstas", async () => {
    const { id } = await draft({ title: "Post que foi rejeitado e depois publicado" });
    await setPostStatus(db, { id, action: "submit" }, ACTOR, t0);
    await rejectPost(db, { id, feedback: FEEDBACK }, REVIEWER, t0);
    await setPostStatus(db, { id, action: "reopen" }, ACTOR, t0);
    await publish(id);
    // approve clears the feedback; put it back, so the test is about what the API selects.
    await db.update(blogPosts).set({ feedback: FEEDBACK }).where(eq(blogPosts.id, id));
    const [stored] = await db.select().from(blogPosts).where(eq(blogPosts.id, id));

    const out = await payload();
    expect(out.posts).toHaveLength(1);
    expect(Object.keys(out.posts[0]!).sort()).toEqual(POST_KEYS);
    expect(Object.keys(out).sort()).toEqual(["authors", "categories", "posts"]);

    const text = JSON.stringify(out);
    for (const secret of [
      ACTOR,
      REVIEWER,
      "example.com",
      FEEDBACK,
      "feedback",
      "createdBy",
      "updatedBy",
      "created_by",
      "updated_by",
      "scheduledFor",
      id,
      stored!.translationGroup,
      authorId,
      categoryId,
    ]) {
      expect(text, secret).not.toContain(secret);
    }
  });

  it("o corpo é sanitizado de novo ao servir, e depois ganha as âncoras", async () => {
    const { id, slug } = await published({ title: "Post cuja linha foi mexida por fora" });
    // A row changed behind the app's back (psql, a restore, an older allowlist).
    const tampered =
      '<h2 id="escolhido-pelo-autor" onclick="x()">Seção</h2>' +
      '<p>oi<script>alert(1)</script><img src="https://evil.example/pixel.gif"></p>' +
      '<p><a href="javascript:alert(1)">link</a><img src="/media/posts/novo/ok.webp" alt="ok"></p>';
    await db.update(blogPosts).set({ bodyHtml: tampered }).where(eq(blogPosts.id, id));

    const post = bySlug(await payload(), slug)!;
    expect(post.html).toBe(
      '<h2 id="secao">Seção</h2><p>oi</p><p><a>link</a><img src="/media/posts/novo/ok.webp" alt="ok" /></p>',
    );
    expect(post.toc).toEqual([{ id: "secao", text: "Seção", level: 2 }]);
    for (const bad of ["script", "onclick", "evil.example", "javascript:", "escolhido-pelo-autor"]) {
      expect(post.html, bad).not.toContain(bad);
    }
  });

  it("post cujo corpo o sanitizador recusa é pulado e registrado; o resto é servido", async () => {
    const good = await published({ title: "Post bom que continua no ar" });
    const bad = await published({ title: "Post com corpo grande demais na linha" });
    const translation = await createTranslation(
      db,
      bad.id,
      postInput(authorId, { lang: "en", title: "Translation of the oversized post" }),
      ACTOR,
    );
    await publish(translation.id);
    await db
      .update(blogPosts)
      .set({ bodyHtml: "x".repeat(MAX_BODY_HTML_LENGTH + 1) })
      .where(eq(blogPosts.id, bad.id));

    const out = await payload();
    expect(out.posts.map((p) => p.slug).sort()).toEqual([good.slug, translation.slug].sort());
    // The translation must not point at a post that is not in the payload.
    expect(bySlug(out, translation.slug)?.translationSlug).toBeNull();
    expect(logged).toHaveLength(1);
    expect(logged[0]).toMatchObject({ at: "public", skipped: bad.slug, lang: "pt" });
  });

  it("translationSlug só aponta para tradução que também está publicada", async () => {
    const pt = await published({ title: "Post original em português no ar" });
    const en = await createTranslation(
      db,
      pt.id,
      postInput(authorId, { lang: "en", title: "The original post, in English" }),
      ACTOR,
    );
    const alone = await published({ title: "Post sem tradução nenhuma" });

    // The translation exists but is a draft.
    let out = await payload();
    expect(bySlug(out, pt.slug)?.translationSlug).toBeNull();
    expect(bySlug(out, en.slug)).toBeUndefined();

    await publish(en.id);
    out = await payload();
    expect(bySlug(out, pt.slug)?.translationSlug).toBe(en.slug);
    expect(bySlug(out, en.slug)?.translationSlug).toBe(pt.slug);
    expect(bySlug(out, en.slug)?.lang).toBe("en");
    expect(bySlug(out, alone.slug)?.translationSlug).toBeNull();

    await setPostStatus(db, { id: en.id, action: "unpublish" }, REVIEWER, t0);
    out = await payload();
    expect(bySlug(out, pt.slug)?.translationSlug).toBeNull();
    expect(bySlug(out, en.slug)).toBeUndefined();
  });

  it("mais novo primeiro, pela data da primeira publicação", async () => {
    const older = await published({ title: "Post publicado primeiro" }, at(-3_600_000));
    const newer = await published({ title: "Post publicado depois" }, t0);
    const middle = await published({ title: "Post publicado no meio" }, at(-60_000));
    expect((await payload()).posts.map((p) => p.slug)).toEqual([newer.slug, middle.slug, older.slug]);
  });

  it("post sem categoria sai com category null; corpo longo conta os minutos", async () => {
    const { slug } = await published({
      title: "Post longo e sem categoria",
      body_html: `<p>${"palavra ".repeat(450)}</p>`,
    });
    expect(bySlug(await payload(), slug)).toMatchObject({ category: null, readingMinutes: 3 });
  });

  it("sem posts: tudo vazio, não erro; categoria e autor sem post publicado não aparecem", async () => {
    // beforeEach created one category and one author, and nothing is published.
    expect(await payload()).toEqual({ posts: [], categories: [], authors: [] });
  });

  it("categoria sem uso e autor que só tem rascunho não vazam", async () => {
    await upsertCategory(db, { slug: "segredo-futuro", name_pt: "Linha nova", name_en: "New line" }, ACTOR);
    const hidden = await upsertAuthor(db, { slug: "contratada-em-sigilo", name: "Pessoa Sigilosa" }, ACTOR);
    // A draft by the hidden author, in the hidden category.
    const unused = await upsertCategory(db, {
      slug: "so-rascunhos",
      name_pt: "Só rascunhos",
      name_en: "Drafts only",
    }, ACTOR);
    await createPost(
      db,
      postInput(hidden.id, { title: "Rascunho da pessoa sigilosa", category_id: unused.id }),
      ACTOR,
    );
    await published({ title: "Post público de verdade", category_id: categoryId });

    const out = await payload();
    expect(out.categories.map((c) => c.slug)).toEqual(["pagamentos"]);
    expect(out.authors.map((a) => a.slug)).toEqual(["lucas"]);
    const text = JSON.stringify(out);
    for (const secret of ["segredo-futuro", "Linha nova", "so-rascunhos", "Sigilosa", "sigilo"]) {
      expect(text, secret).not.toContain(secret);
    }
  });

  it("capa e avatar que não são /media saem como null", async () => {
    const { id, slug } = await published({ title: "Post com capa trocada por fora" });
    // What the schema would refuse, written straight to the tables.
    await db
      .update(blogPosts)
      .set({ coverUrl: "https://evil.example/pixel.gif" })
      .where(eq(blogPosts.id, id));
    await db
      .update(blogAuthors)
      .set({ avatarUrl: "//evil.example/a.webp" })
      .where(eq(blogAuthors.id, authorId));
    let out = await payload();
    expect(bySlug(out, slug)?.coverUrl).toBeNull();
    expect(out.authors[0]?.avatarUrl).toBeNull();
    expect(JSON.stringify(out)).not.toContain("evil.example");

    for (const bad of ["/media/../etc/passwd", "javascript:alert(1)", "/outro/caminho.webp", ""]) {
      await db.update(blogPosts).set({ coverUrl: bad }).where(eq(blogPosts.id, id));
      out = await payload();
      expect(bySlug(out, slug)?.coverUrl, bad).toBeNull();
    }
  });

  it("marcação em título, resumo e cabeçalho sai como texto puro, e nunca solta dentro do html", async () => {
    const title = 'Como usar <script>alert(1)</script> e <img src=x onerror=alert(1)> sem medo';
    const { slug } = await published({
      title,
      excerpt: "Resumo com </script><script>alert(2)</script>",
      meta_title: "<b>SEO</b>",
      cover_url: "/media/posts/novo/capa.webp",
      cover_alt: '"><img src=x onerror=alert(3)>',
      tags: ["solana"],
      body_html:
        "<h2>Seção sobre &lt;script&gt; e &lt;img onerror=x&gt;</h2><p>texto &lt;script&gt;alert(4)&lt;/script&gt;</p>",
    });
    const post = bySlug(await payload(), slug)!;
    // The text fields are the author's characters, untouched: escaping is the consumer's job.
    expect(post.title).toBe(title);
    expect(post.excerpt).toBe("Resumo com </script><script>alert(2)</script>");
    expect(post.metaTitle).toBe("<b>SEO</b>");
    expect(post.coverAlt).toBe('"><img src=x onerror=alert(3)>');
    expect(post.toc).toEqual([
      { id: "secao-sobre-script-e-img-onerror-x", text: "Seção sobre <script> e <img onerror=x>", level: 2 },
    ]);
    // The one HTML field never carries live markup the sanitizer does not allow.
    expect(post.html).not.toMatch(/<script/i);
    expect(post.html).not.toMatch(/<img[^>]*onerror/i);
    expect(post.html).not.toContain("onerror=x>");
    expect(post.html).toContain("&lt;script&gt;");
  });

  it("banco igual: duas leituras sanitizam uma vez; uma edição invalida", async () => {
    const { id } = await published({ title: "Post lido duas vezes sem mudar" });
    const build = vi.fn((d: Db) => getPublicPayload(d, log));
    // ttlMs: 0 so every read asks the database; the two-second window has its own tests.
    const read = createPublicReader({ build, ttlMs: 0 });

    const first = await read(db);
    const second = await read(db);
    expect(build).toHaveBeenCalledTimes(1);
    expect(second.fingerprint).toBe(first.fingerprint);
    expect(second.payload).toBe(first.payload);

    await updatePost(
      db,
      id,
      await editInput(db, id, authorId, { title: "Post editado depois da primeira leitura" }),
      ACTOR,
      at(60_000),
    );
    const third = await read(db);
    expect(build).toHaveBeenCalledTimes(2);
    expect(third.fingerprint).not.toBe(first.fingerprint);
    expect(third.payload.posts[0]?.title).toBe("Post editado depois da primeira leitura");
  });

  it("a impressão digital muda com o que é público, e só com isso", async () => {
    const { id } = await published({
      title: "Post que ancora a impressão digital",
      category_id: categoryId,
    });
    const other = await published({ title: "Segundo post publicado, sem categoria" });
    const seen = new Set<string>([await publicFingerprint(db)]);
    // Asking again changes nothing.
    expect(seen.has(await publicFingerprint(db))).toBe(true);

    const visible: Record<string, () => Promise<unknown>> = {
      "categoria em uso renomeada": () =>
        upsertCategory(db, { slug: "pagamentos", name_pt: "Renomeada", name_en: "Renamed" }, ACTOR),
      "autor em uso editado": () => upsertAuthor(db, { slug: "lucas", name: "Lucas G." }, ACTOR),
      "post publicado editado": async () =>
        updatePost(db, id, await editInput(db, id, authorId, { title: "Título público trocado" }), ACTOR, at(60_000)),
      despublicar: () => setPostStatus(db, { id: other.id, action: "unpublish" }, REVIEWER, at(120_000)),
      "publicar de novo": () =>
        setPostStatus(db, { id: other.id, action: "publish" }, REVIEWER, at(180_000)),
    };
    for (const [label, change] of Object.entries(visible)) {
      await change();
      const next = await publicFingerprint(db);
      expect(seen.has(next), label).toBe(false);
      seen.add(next);
    }

    // Nothing below is public, so none of it may move the fingerprint (and with it the ETag
    // anyone can read): saving drafts must not be observable from outside.
    const current = await publicFingerprint(db);
    const rascunho = await draft({ title: "Um rascunho novo não aparece" });
    const hidden: Record<string, () => Promise<unknown>> = {
      "rascunho novo": async () => {},
      "rascunho editado": async () =>
        updatePost(db, rascunho.id, await editInput(db, rascunho.id, authorId, { title: "Rascunho editado de novo" }), ACTOR, at(240_000)),
      "rascunho enviado para revisão": () =>
        setPostStatus(db, { id: rascunho.id, action: "submit" }, ACTOR, at(300_000)),
      "categoria sem uso criada": () =>
        upsertCategory(db, { slug: "nova-categoria", name_pt: "Nova", name_en: "New" }, ACTOR),
      "categoria sem uso renomeada": () =>
        upsertCategory(db, { slug: "nova-categoria", name_pt: "Outra", name_en: "Other" }, ACTOR),
      "autor sem post publicado criado": () =>
        upsertAuthor(db, { slug: "autora-nova", name: "Autora nova" }, ACTOR),
    };
    for (const [label, change] of Object.entries(hidden)) {
      await change();
      expect(await publicFingerprint(db), label).toBe(current);
    }
  });

  it("duas escritas com o mesmo updated_at ainda mudam a impressão digital (xmin)", async () => {
    const { id } = await published({ title: "Post escrito duas vezes no mesmo instante" });
    const before = await publicFingerprint(db);
    const [stored] = await db.select().from(blogPosts).where(eq(blogPosts.id, id));

    // Same updated_at to the microsecond, as two saves in one millisecond would leave it, or a
    // fix made in psql that did not touch the column.
    await db
      .update(blogPosts)
      .set({ bodyHtml: "<p>outro corpo, mesma data</p>" })
      .where(eq(blogPosts.id, id));
    const [after] = await db.select().from(blogPosts).where(eq(blogPosts.id, id));
    expect(after!.updatedAt).toEqual(stored!.updatedAt);
    expect(await publicFingerprint(db)).not.toBe(before);

    // And the reader built on it serves the new body.
    const read = createPublicReader({ build: (d) => getPublicPayload(d, log), ttlMs: 0 });
    expect((await read(db)).payload.posts[0]?.html).toBe("<p>outro corpo, mesma data</p>");
  });

  it("rota: 200 com ETag, e 304 quando a ETag volta sem nada ter mudado", async () => {
    const { slug } = await published({ title: "Post servido pela rota pública" });
    const url = "https://pub.example/api/public/posts";
    const res = await GET(new Request(url));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("public, max-age=60, s-maxage=60");
    const body = (await res.json()) as PublicPayload;
    expect(body.posts.map((p) => p.slug)).toEqual([slug]);

    const etag = res.headers.get("etag") as string;
    const again = await GET(new Request(url, { headers: { "if-none-match": etag } }));
    expect(again.status).toBe(304);

    await published({ title: "Outro post, publicado depois da ETag" });
    // The route's reader keeps the fingerprint for two seconds.
    await new Promise((resolve) => setTimeout(resolve, 2_100));
    const changed = await GET(new Request(url, { headers: { "if-none-match": etag } }));
    expect(changed.status).toBe(200);
    expect(((await changed.json()) as PublicPayload).posts).toHaveLength(2);
  });
});
