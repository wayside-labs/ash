// No database here: the memo and the HTTP caching are logic around two injected functions. The
// same behaviour against real rows is in blog-public.test.ts.
import { GET } from "@/app/api/public/posts/route";
import {
  type PublicPayload,
  createPublicReader,
  getPublicPayload,
  readPublic,
} from "@/blog/public";
import type { Db } from "@/db/client";
import { db } from "@/db/client";
import { env } from "@/lib/env";

vi.mock("@/db/client", () => ({ db: vi.fn(() => ({})) }));
vi.mock("@/lib/env", () => ({ env: vi.fn() }));
vi.mock("@/blog/public", async (original) => ({
  ...(await original<typeof import("@/blog/public")>()),
  readPublic: vi.fn(),
}));

const fakeDb = {} as Db;
const payload = (title: string): PublicPayload => ({
  posts: [{ title } as PublicPayload["posts"][number]],
  categories: [],
  authors: [],
});

// The shape of the one query getPublicPayload makes, answered from memory: enough to exercise
// what it does with the rows.
function rowsDb(rows: Record<string, unknown>[]): Db {
  const chain = {
    from: () => chain,
    leftJoin: () => chain,
    where: () => chain,
    orderBy: async () => rows,
  };
  return { select: () => chain } as unknown as Db;
}
const row = (overrides: Record<string, unknown> = {}) => ({
  slug: "um-post",
  lang: "pt",
  translationGroup: "g1",
  title: "Um post",
  excerpt: null,
  bodyHtml: "<p>corpo</p>",
  tags: [],
  featured: false,
  coverUrl: null,
  coverAlt: null,
  metaTitle: null,
  metaDescription: null,
  publishedAt: new Date("2099-01-01T12:00:00Z"),
  updatedAt: new Date("2099-01-02T12:00:00Z"),
  categorySlug: "pagamentos",
  categoryNamePt: "Pagamentos",
  categoryNameEn: "Payments",
  authorSlug: "lucas",
  authorName: "Lucas",
  authorBioPt: "Bio",
  authorBioEn: "Bio en",
  authorAvatarUrl: "/media/autores/lucas.webp",
  ...overrides,
});

describe("getPublicPayload sobre as linhas da consulta", () => {
  it("categorias e autores são só os dos posts servidos, sem repetição e em ordem", async () => {
    const out = await getPublicPayload(
      rowsDb([
        row({ slug: "a" }),
        row({ slug: "b", translationGroup: "g2" }),
        row({
          slug: "c",
          translationGroup: "g3",
          categorySlug: "agentes",
          categoryNamePt: "Agentes",
          categoryNameEn: "Agents",
          authorSlug: "ana",
          authorName: "Ana",
          authorBioPt: "",
          authorBioEn: "",
          authorAvatarUrl: null,
        }),
        row({ slug: "d", translationGroup: "g4", categorySlug: null, categoryNamePt: null, categoryNameEn: null }),
      ]),
    );
    expect(out.categories).toEqual([
      { slug: "agentes", namePt: "Agentes", nameEn: "Agents" },
      { slug: "pagamentos", namePt: "Pagamentos", nameEn: "Payments" },
    ]);
    expect(out.authors).toEqual([
      { slug: "ana", name: "Ana", bioPt: "", bioEn: "", avatarUrl: null },
      { slug: "lucas", name: "Lucas", bioPt: "Bio", bioEn: "Bio en", avatarUrl: "/media/autores/lucas.webp" },
    ]);
    expect(out.posts.find((p) => p.slug === "d")?.category).toBeNull();
  });

  it("post pulado não leva sua categoria nem seu autor para o payload", async () => {
    const logged: unknown[] = [];
    const out = await getPublicPayload(
      rowsDb([
        row({
          slug: "quebrado",
          bodyHtml: "x".repeat(300_001),
          categorySlug: "so-dele",
          categoryNamePt: "Só dele",
          categoryNameEn: "Only his",
          authorSlug: "so-dele",
          authorName: "Autor só dele",
        }),
      ]),
      (entry) => void logged.push(entry),
    );
    expect(out).toEqual({ posts: [], categories: [], authors: [] });
    expect(logged).toHaveLength(1);
  });

  it("capa e avatar que não são /media saem como null", async () => {
    for (const bad of [
      "https://evil.example/pixel.gif",
      "//evil.example/a.webp",
      "/media/../etc/passwd",
      "javascript:alert(1)",
      "/outro/caminho.webp",
      "",
    ]) {
      const out = await getPublicPayload(rowsDb([row({ coverUrl: bad, authorAvatarUrl: bad })]));
      expect(out.posts[0]?.coverUrl, bad).toBeNull();
      expect(out.authors[0]?.avatarUrl, bad).toBeNull();
    }
    const ok = await getPublicPayload(rowsDb([row({ coverUrl: "/media/posts/novo/capa.webp" })]));
    expect(ok.posts[0]?.coverUrl).toBe("/media/posts/novo/capa.webp");
  });

  it("marcação em título e cabeçalho sai como texto puro, e nunca solta dentro do html", async () => {
    const title = "Como usar <script>alert(1)</script> e <img src=x onerror=alert(1)>";
    const out = await getPublicPayload(
      rowsDb([
        row({
          title,
          excerpt: "Resumo com </script><script>alert(2)</script>",
          coverAlt: '"><img src=x onerror=alert(3)>',
          bodyHtml:
            "<h2>Seção sobre &lt;script&gt; e &lt;img onerror=x&gt;</h2>" +
            "<p>texto<script>alert(4)</script><img src=x onerror=alert(5)></p>",
        }),
      ]),
    );
    const post = out.posts[0]!;
    // The text fields are the author's characters, untouched: escaping is the consumer's job.
    expect(post.title).toBe(title);
    expect(post.excerpt).toBe("Resumo com </script><script>alert(2)</script>");
    expect(post.coverAlt).toBe('"><img src=x onerror=alert(3)>');
    expect(post.toc).toEqual([
      { id: "secao-sobre-script-e-img-onerror-x", text: "Seção sobre <script> e <img onerror=x>", level: 2 },
    ]);
    // The one HTML field carries no markup the sanitizer does not allow.
    expect(post.html).not.toMatch(/<script/i);
    expect(post.html).not.toMatch(/onerror=alert/i);
    expect(post.html).not.toMatch(/<img/i);
    expect(post.html).toContain("&lt;script&gt;");
  });

  it("nenhuma chave além das previstas, mesmo se a consulta trouxer colunas a mais", async () => {
    const out = await getPublicPayload(
      rowsDb([row({ createdBy: "admin@example.com", feedback: "interno", id: "uuid" })]),
    );
    expect(JSON.stringify(out)).not.toContain("admin@example.com");
    expect(JSON.stringify(out)).not.toContain("interno");
    expect(Object.keys(out.posts[0]!)).not.toContain("id");
  });
});

describe("memo da leitura pública", () => {
  // A clock the test moves by hand; ttlMs: 0 means "ask the fingerprint every time".
  const clock = () => {
    let time = 1_000_000;
    return { now: () => time, advance: (ms: number) => void (time += ms) };
  };

  it("banco igual: o payload é montado e serializado uma vez só", async () => {
    const build = vi.fn(async () => payload("a"));
    const fingerprint = vi.fn(async () => "f1");
    const read = createPublicReader({ build, fingerprint, ttlMs: 0 });
    const first = await read(fakeDb);
    const second = await read(fakeDb);
    const third = await read(fakeDb);
    expect(build).toHaveBeenCalledTimes(1);
    expect(fingerprint).toHaveBeenCalledTimes(3);
    expect(third).toEqual({
      fingerprint: "f1",
      payload: payload("a"),
      json: JSON.stringify(payload("a")),
    });
    // The very same objects: nothing was rebuilt or serialised again.
    expect(second).toBe(first);
    expect(third).toBe(first);
  });

  it("mudou a impressão digital: monta de novo, e só uma vez para a nova", async () => {
    let current = "f1";
    const build = vi.fn(async () => payload(current));
    const read = createPublicReader({ build, fingerprint: async () => current, ttlMs: 0 });
    expect((await read(fakeDb)).payload.posts[0]?.title).toBe("f1");
    current = "f2";
    expect(await read(fakeDb)).toMatchObject({ fingerprint: "f2", payload: payload("f2") });
    expect((await read(fakeDb)).json).toBe(JSON.stringify(payload("f2")));
    expect(build).toHaveBeenCalledTimes(2);
  });

  it("a impressão digital vale por dois segundos: uma enxurrada de pedidos custa uma consulta", async () => {
    const time = clock();
    const fingerprint = vi.fn(async () => "f1");
    const build = vi.fn(async () => payload("a"));
    const read = createPublicReader({ build, fingerprint, now: time.now });
    for (let i = 0; i < 50; i++) {
      await read(fakeDb);
      time.advance(30);
    }
    // 50 requests over 1.5 s.
    expect(fingerprint).toHaveBeenCalledTimes(1);
    expect(build).toHaveBeenCalledTimes(1);

    time.advance(500);
    await read(fakeDb);
    expect(fingerprint).toHaveBeenCalledTimes(2);
    expect(build).toHaveBeenCalledTimes(1);
  });

  it("uma edição aparece assim que os dois segundos passam, não antes", async () => {
    const time = clock();
    let current = "f1";
    const read = createPublicReader({
      build: async () => payload(current),
      fingerprint: async () => current,
      now: time.now,
    });
    expect((await read(fakeDb)).fingerprint).toBe("f1");
    current = "f2";
    time.advance(1_999);
    expect((await read(fakeDb)).fingerprint).toBe("f1");
    time.advance(1);
    expect(await read(fakeDb)).toMatchObject({ fingerprint: "f2", payload: payload("f2") });
  });

  it("relógio que anda para trás não congela a impressão digital", async () => {
    const time = clock();
    const fingerprint = vi.fn(async () => "f1");
    const read = createPublicReader({ build: async () => payload("a"), fingerprint, now: time.now });
    await read(fakeDb);
    time.advance(-60_000);
    await read(fakeDb);
    expect(fingerprint).toHaveBeenCalledTimes(2);
  });

  it("pedidos simultâneos dividem a mesma consulta e a mesma montagem", async () => {
    let release: (value: PublicPayload) => void = () => {};
    const build = vi.fn(() => new Promise<PublicPayload>((resolve) => void (release = resolve)));
    const fingerprint = vi.fn(async () => "f1");
    const read = createPublicReader({ build, fingerprint });
    const all = Promise.all([read(fakeDb), read(fakeDb), read(fakeDb)]);
    await new Promise((r) => setTimeout(r, 10));
    release(payload("a"));
    const results = await all;
    expect(fingerprint).toHaveBeenCalledTimes(1);
    expect(build).toHaveBeenCalledTimes(1);
    expect(results.every((r) => r === results[0])).toBe(true);
  });

  it("montagem que falha não fica guardada: o pedido seguinte tenta de novo", async () => {
    const build = vi
      .fn<(db: Db) => Promise<PublicPayload>>()
      .mockRejectedValueOnce(new Error("db down"))
      .mockResolvedValueOnce(payload("a"));
    const read = createPublicReader({ build, fingerprint: async () => "f1" });
    await expect(read(fakeDb)).rejects.toThrow("db down");
    expect((await read(fakeDb)).payload).toEqual(payload("a"));
    expect(build).toHaveBeenCalledTimes(2);
  });

  it("falha na impressão digital sobe, não fica guardada, e não serve o payload antigo", async () => {
    const time = clock();
    const fingerprint = vi
      .fn<(db: Db) => Promise<string>>()
      .mockResolvedValueOnce("f1")
      .mockRejectedValueOnce(new Error("db down"))
      .mockResolvedValueOnce("f1");
    const build = vi.fn(async () => payload("a"));
    const read = createPublicReader({ build, fingerprint, now: time.now });
    await read(fakeDb);
    time.advance(2_000);
    await expect(read(fakeDb)).rejects.toThrow("db down");
    // Inside what would have been the TTL of the failed answer: it asks again.
    time.advance(10);
    expect((await read(fakeDb)).fingerprint).toBe("f1");
    expect(fingerprint).toHaveBeenCalledTimes(3);
    expect(build).toHaveBeenCalledTimes(1);
  });
});

describe("rota GET /api/public/posts: cache HTTP", () => {
  const get = (headers: Record<string, string> = {}) =>
    GET(new Request("https://pub.example/api/public/posts", { headers }));
  const serve = (fingerprint: string, version = "v1") => {
    vi.mocked(env).mockReturnValue({ APP_VERSION: version } as ReturnType<typeof env>);
    vi.mocked(readPublic).mockResolvedValue({
      fingerprint,
      payload: payload("a"),
      // Deliberately not what JSON.stringify(payload) gives: the route must send this string.
      json: '{"posts":[{"title":"a"}],"categories":[],"authors":[],"marca":"json guardado"}',
    });
  };

  beforeEach(() => {
    vi.mocked(readPublic).mockReset();
    vi.mocked(env).mockReset();
    vi.mocked(db).mockClear();
  });

  it("200 com ETag forte, cache de um minuto no navegador e na CDN, e nosniff", async () => {
    serve("f1");
    const res = await get();
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("public, max-age=60, s-maxage=60");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("content-type")).toMatch(/^application\/json/);
    expect(res.headers.get("etag")).toMatch(/^"[A-Za-z0-9_-]{32}"$/);
    // The stored string goes out as is: no second serialisation per request.
    expect(await res.text()).toBe(
      '{"posts":[{"title":"a"}],"categories":[],"authors":[],"marca":"json guardado"}',
    );
  });

  it("If-None-Match igual: 304 sem corpo, com os mesmos cabeçalhos de cache", async () => {
    serve("f1");
    const etag = (await get()).headers.get("etag") as string;
    for (const header of [etag, `W/${etag}`, `"outra", ${etag}`, "*"]) {
      const res = await get({ "if-none-match": header });
      expect(res.status, header).toBe(304);
      expect(await res.text()).toBe("");
      expect(res.headers.get("etag")).toBe(etag);
      expect(res.headers.get("cache-control")).toBe("public, max-age=60, s-maxage=60");
    }
  });

  it("If-None-Match diferente, ou vazio, recebe o corpo", async () => {
    serve("f1");
    expect((await get({ "if-none-match": '"velha"' })).status).toBe(200);
    expect((await get({ "if-none-match": "" })).status).toBe(200);
  });

  it("a ETag muda quando os dados mudam e quando a versão do app muda", async () => {
    serve("f1", "v1");
    const a = (await get()).headers.get("etag");
    serve("f1", "v1");
    expect((await get()).headers.get("etag")).toBe(a);
    serve("f2", "v1");
    const b = (await get()).headers.get("etag");
    serve("f1", "v2");
    const c = (await get()).headers.get("etag");
    expect(new Set([a, b, c]).size).toBe(3);
    // The old tag no longer matches after an edit.
    serve("f2", "v1");
    expect((await get({ "if-none-match": a as string })).status).toBe(200);
  });

  it("falha na leitura: 503 sem cache, sem ETag e sem detalhe do erro", async () => {
    vi.mocked(env).mockReturnValue({ APP_VERSION: "v1" } as ReturnType<typeof env>);
    vi.mocked(readPublic).mockRejectedValue(
      new Error("connect ECONNREFUSED postgres://studio:hunter2@db:5432/studio"),
    );
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const res = await get();
      expect(res.status).toBe(503);
      expect(res.headers.get("cache-control")).toBe("no-store");
      expect(res.headers.get("etag")).toBeNull();
      expect(res.headers.get("x-content-type-options")).toBe("nosniff");
      const text = await res.text();
      expect(text).not.toContain("hunter2");
      expect(JSON.parse(text)).toEqual({ error: "unavailable" });
    } finally {
      errors.mockRestore();
    }
  });
});
