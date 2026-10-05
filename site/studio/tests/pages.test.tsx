// The server pages of the panel, rendered to HTML against the real cores and a real database.
// The build does not run on every machine (README, "Build"), so this is the closest a test gets
// to opening the screen: the page's own queries, the mapping to client rows and the markup, with
// only the guard, the environment and the router replaced.
import { eq } from "drizzle-orm";
import type { ReactNode } from "react";
import { prerender } from "react-dom/static";
import EditPostPage from "@/app/blog/[id]/page";
import PreviewPage from "@/app/blog/[id]/previa/page";
import AuthorsPage from "@/app/blog/autores/page";
import CategoriesPage from "@/app/blog/categorias/page";
import NewPostPage from "@/app/blog/novo/page";
import BlogPage from "@/app/blog/page";
import Home from "@/app/page";
import { createPost, createTranslation } from "@/blog/posts";
import { setPostStatus } from "@/blog/status";
import type { Db } from "@/db/client";
import { blogPosts } from "@/db/schema";
import { requireAdmin } from "@/lib/admin";
import { ACTOR, postInput, seedAuthor, seedCategory } from "./helpers/blog";
import { describeDb, freshDb } from "./helpers/db";

const shared = vi.hoisted(() => ({ db: undefined as unknown }));
vi.mock("@/db/client", async (original) => ({
  ...(await original<typeof import("@/db/client")>()),
  db: () => shared.db,
}));
vi.mock("@/lib/admin", () => ({ requireAdmin: vi.fn() }));
vi.mock("@/lib/env", () => ({ env: () => ({ PUBLISH_TZ: "America/Sao_Paulo" }) }));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
  useRouter: () => ({ refresh: () => {}, push: () => {} }),
  usePathname: () => "/blog",
}));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

type Query = Record<string, string | string[] | undefined>;

async function html(page: Promise<ReactNode>): Promise<string> {
  const { prelude } = await prerender(await page);
  // React separates adjacent text nodes with an empty comment; the assertions read the text.
  return (await new Response(prelude).text()).replaceAll("<!-- -->", "");
}
const blog = (query: Query = {}) => html(BlogPage({ searchParams: Promise.resolve(query) }));
const novo = (query: Query = {}) => html(NewPostPage({ searchParams: Promise.resolve(query) }));
const editor = (id: string) => html(EditPostPage({ params: Promise.resolve({ id }) }));
const preview = (id: string) => html(PreviewPage({ params: Promise.resolve({ id }) }));

describeDb("páginas do painel", () => {
  let db: Db;
  let close: () => Promise<void>;
  beforeAll(async () => {
    ({ db, close } = await freshDb());
    shared.db = db;
  });
  afterAll(async () => close());
  beforeEach(() => {
    vi.mocked(requireAdmin).mockReset().mockResolvedValue({ email: ACTOR });
  });

  // The number a card or a tab shows, read from the markup next to its label: a count that is
  // merely somewhere on the page (or a "1" inside "11") does not satisfy these.
  const number = (out: string, pattern: RegExp, what: string): number => {
    const found = pattern.exec(out)?.[1];
    if (found === undefined) throw new Error(`no number found for ${what}`);
    return Number(found);
  };
  // The home card of a state: <a href=...><p>COUNT</p><p>LABEL</p>.
  const homeCounts = (out: string) =>
    Object.fromEntries(
      ["Rascunho", "Em revisão", "Aprovado", "Publicado", "Rejeitado"].map((label) => [
        label,
        number(out, new RegExp(`<p[^>]*>(\\d+)</p><p[^>]*>${label}</p>`), label),
      ]),
    );
  const homeScheduled = (out: string) => number(out, /Agendados <span[^>]*>(\d+)<\/span>/, "Agendados");
  // A tab or a filter pill: LABEL<span>COUNT</span></a>.
  const linkCount = (out: string, label: string) =>
    number(out, new RegExp(`>${label}<span[^>]*>(\\d+)</span></a>`), label);
  const tabCounts = (out: string) => ({
    posts: linkCount(out, "Posts"),
    revisao: linkCount(out, "Revisão"),
    agendados: linkCount(out, "Agendados"),
  });

  describe("banco vazio", () => {
    it("o início mostra zero em todo estado e o link do health", async () => {
      const out = await html(Home());
      expect(out).toContain(`Olá, ${ACTOR}`);
      expect(homeCounts(out)).toEqual({
        Rascunho: 0,
        "Em revisão": 0,
        Aprovado: 0,
        Publicado: 0,
        Rejeitado: 0,
      });
      expect(homeScheduled(out)).toBe(0);
      expect(out).not.toContain("com o horário vencido");
      expect(out).toContain('href="/api/health"');
      expect(out).toContain('href="/blog?view=revisao"');
      expect(out).toContain('href="/blog?status=publicado"');
    });

    it("/blog diz por onde começar, em cada aba, e as três abas mostram zero", async () => {
      const posts = await blog();
      expect(posts).toContain("Ainda não há nenhum post.");
      expect(tabCounts(posts)).toEqual({ posts: 0, revisao: 0, agendados: 0 });
      expect(await blog({ view: "revisao" })).toContain("Nada esperando revisão.");
      expect(await blog({ view: "agendados" })).toContain("Nenhum post agendado.");
    });

    it("/blog/novo sem autor manda cadastrar um, e não mostra o formulário", async () => {
      const out = await novo();
      expect(out).toContain("Ainda não há nenhum autor");
      expect(out).toContain('href="/blog/autores"');
      expect(out).not.toContain("<form");
    });

    it("categorias e autores vazios dizem o que fazer", async () => {
      expect(await html(CategoriesPage())).toContain("Nenhuma categoria ainda.");
      expect(await html(AuthorsPage())).toContain("Nenhum autor ainda.");
    });
  });

  describe("com posts", () => {
    const TITLES = {
      draft: "Rascunho em portugues numero um",
      review: "Esperando revisao numero dois",
      overdue: "Agendado e vencido numero tres",
      original: "Original com traducao numero quatro",
      translation: "Translation of number four here",
    };
    const ids = {} as Record<keyof typeof TITLES, string>;

    beforeAll(async () => {
      const authorId = await seedAuthor(db);
      const categoryId = await seedCategory(db);
      const create = async (title: string, extra: Record<string, unknown> = {}) =>
        (await createPost(db, postInput(authorId, { title, ...extra }), ACTOR)).id;

      ids.draft = await create(TITLES.draft, { category_id: categoryId });
      ids.review = await create(TITLES.review);
      await setPostStatus(db, { id: ids.review, action: "submit" }, ACTOR);
      ids.overdue = await create(TITLES.overdue);
      // Written straight to the table: the schema refuses a schedule in the past.
      await db
        .update(blogPosts)
        .set({ status: "aprovado", scheduledFor: new Date("2020-01-01T15:00:00.000Z") })
        .where(eq(blogPosts.id, ids.overdue));
      ids.original = await create(TITLES.original);
      ids.translation = (
        await createTranslation(
          db,
          ids.original,
          postInput(authorId, { lang: "en", title: TITLES.translation }),
          ACTOR,
        )
      ).id;
    });

    const shown = (out: string) =>
      Object.entries(TITLES)
        .filter(([, title]) => out.includes(title))
        .map(([key]) => key)
        .sort();
    const ALL = Object.keys(TITLES).sort();

    it("a aba de posts lista tudo, com categoria, autor e as contagens das abas", async () => {
      const out = await blog();
      expect(shown(out)).toEqual(ALL);
      expect(out).toContain("Categoria · Autora Teste");
      expect(out).toContain("Sem categoria · Autora Teste");
      // 12:00 in São Paulo, with the zone written out under the table.
      expect(out).toContain("01/01/2020 12:00");
      expect(out).toContain("(America/Sao_Paulo)");
      // Five posts in all, one in review, one approved with a date.
      expect(tabCounts(out)).toEqual({ posts: 5, revisao: 1, agendados: 1 });
      expect(linkCount(out, "Todos")).toBe(5);
      expect(
        ["Rascunho", "Em revisão", "Aprovado", "Publicado", "Rejeitado"].map((label) =>
          linkCount(out, label),
        ),
      ).toEqual([3, 1, 1, 0, 0]);
      // The same tab numbers whatever the tab or the filter: they count the whole blog.
      expect(tabCounts(await blog({ view: "agendados" }))).toEqual({ posts: 5, revisao: 1, agendados: 1 });
      const english = await blog({ lang: "en" });
      expect(tabCounts(english)).toEqual({ posts: 5, revisao: 1, agendados: 1 });
      // The state pills follow the language filter.
      expect(linkCount(english, "Todos")).toBe(1);
      expect(linkCount(english, "Rascunho")).toBe(1);
      expect(linkCount(english, "Aprovado")).toBe(0);
    });

    it("filtros de idioma e de estado, juntos e separados", async () => {
      expect(shown(await blog({ lang: "en" }))).toEqual(["translation"]);
      expect(shown(await blog({ status: "revisao" }))).toEqual(["review"]);
      expect(shown(await blog({ status: "aprovado" }))).toEqual(["overdue"]);
      expect(shown(await blog({ lang: "pt", status: "rascunho" }))).toEqual(["draft", "original"]);
      const none = await blog({ lang: "en", status: "aprovado" });
      expect(shown(none)).toEqual([]);
      expect(none).toContain("Nenhum post com este filtro.");
    });

    it("query string hostil cai no padrão, sem erro", async () => {
      const hostile: Query[] = [
        { view: "campanhas" },
        { view: ["revisao", "agendados"] },
        { status: "publicado' or 1=1 --", lang: "<script>" },
        { view: "__proto__", status: "constructor", lang: "toString" },
        { limit: "999999", page: "-1" },
      ];
      for (const query of hostile) {
        expect(shown(await blog(query)), JSON.stringify(query)).toEqual(ALL);
      }
    });

    it("Criar tradução só aparece no post que ainda não tem o outro idioma", async () => {
      const out = await blog();
      for (const key of ["draft", "review", "overdue"] as const) {
        expect(out, key).toContain(`/blog/novo?traducao_de=${ids[key]}`);
      }
      expect(out).not.toContain(`traducao_de=${ids.original}`);
      expect(out).not.toContain(`traducao_de=${ids.translation}`);
      // Still true when the sibling is filtered out of the list.
      expect(await blog({ lang: "pt" })).not.toContain(`traducao_de=${ids.original}`);
    });

    it("a aba de revisão mostra só o que está em revisão, com aprovar e rejeitar", async () => {
      const out = await blog({ view: "revisao" });
      expect(shown(out)).toEqual(["review"]);
      expect(out).toContain("Aprovar");
      expect(out).toContain("Rejeitar");
      // The filters of the posts tab do not apply here.
      expect(shown(await blog({ view: "revisao", lang: "en", status: "rascunho" }))).toEqual([
        "review",
      ]);
    });

    it("a aba de agendados mostra o horário no fuso do blog e marca o vencido", async () => {
      const out = await blog({ view: "agendados" });
      expect(shown(out)).toEqual(["overdue"]);
      expect(out).toContain("01/01/2020 12:00");
      expect(out).toContain("(America/Sao_Paulo)");
      expect(out).toContain("Atrasado: o horário já passou");
      for (const label of ["Reagendar", "Desagendar", "Publicar agora"]) {
        expect(out, label).toContain(label);
      }
    });

    it("o início conta por estado e avisa do agendado vencido", async () => {
      const out = await html(Home());
      expect(homeCounts(out)).toEqual({
        Rascunho: 3,
        "Em revisão": 1,
        Aprovado: 1,
        Publicado: 0,
        Rejeitado: 0,
      });
      expect(homeScheduled(out)).toBe(1);
      expect(out).toContain(">1 com o horário vencido");
    });

    it("/blog/novo mostra o formulário com os autores", async () => {
      const out = await novo();
      expect(out).toContain("<form");
      expect(out).toContain("Autora Teste");
      expect(out).toContain("Criar rascunho e abrir o editor");
    });

    it("/blog/novo?traducao_de: mostra o original e fixa o outro idioma", async () => {
      const out = await novo({ traducao_de: ids.draft });
      expect(out).toContain("Nova tradução para inglês");
      expect(out).toContain(TITLES.draft);
      expect(out).toContain("Criar tradução e abrir o editor");
    });

    it("/blog/novo?traducao_de de post que já tem tradução diz isso de saída, com o link, e não mostra o formulário", async () => {
      const fromOriginal = await novo({ traducao_de: ids.original });
      expect(fromOriginal).toContain("Este post já tem tradução");
      expect(fromOriginal).toContain(TITLES.translation);
      expect(fromOriginal).toContain(`href="/blog/${ids.translation}"`);
      expect(fromOriginal).not.toContain("<form");
      // And from the other side of the pair.
      const fromTranslation = await novo({ traducao_de: ids.translation });
      expect(fromTranslation).toContain(`href="/blog/${ids.original}"`);
      expect(fromTranslation).toContain("já tem a versão em português");
      expect(fromTranslation).not.toContain("<form");
    });

    it("/blog/novo?traducao_de de post que não existe, ou que não é um id, dá 404", async () => {
      const missing: Query[] = [
        { traducao_de: "99999999-9999-4999-8999-999999999999" },
        { traducao_de: "nao-e-uuid" },
        { traducao_de: "" },
        { traducao_de: [ids.draft, ids.review] },
      ];
      for (const query of missing) {
        await expect(novo(query), JSON.stringify(query)).rejects.toThrow("NEXT_NOT_FOUND");
      }
    });

    it("categorias e autores listam com a contagem de posts", async () => {
      const categories = await html(CategoriesPage());
      expect(categories).toContain("categoria-teste");
      // The whole cell, so "1 post" cannot be the tail of "11 posts" nor the head of "1 posts".
      expect(categories).toMatch(/>1 post<span[^>]*> · 0 publicados<\/span><\/td>/);
      const authors = await html(AuthorsPage());
      expect(authors).toContain("autora-teste");
      expect(authors).toMatch(/>5 posts<span[^>]*> · 0 publicados<\/span><\/td>/);
    });

    describe("o editor (/blog/[id])", () => {
      it("o Editar da lista e o destino depois de criar um post caem numa página que existe", async () => {
        const list = await blog();
        for (const key of Object.keys(TITLES) as (keyof typeof TITLES)[]) {
          // The link the list shows for this post...
          expect(list, key).toContain(`href="/blog/${ids[key]}"`);
          // ...and the page behind it, with the post in the form.
          const out = await editor(ids[key]);
          expect(out, key).toContain(`value="${TITLES[key]}"`);
          expect(out, key).toContain("Editar post");
        }
      });

      it("traz o estado, as ações dele, o endereço fixo e a prévia", async () => {
        const out = await editor(ids.draft);
        expect(out).toContain("Enviar para revisão");
        expect(out).toContain("Tudo salvo");
        expect(out).toContain("rascunho-em-portugues-numero-um");
        expect(out).toContain(`href="/blog/${ids.draft}/previa"`);
        // The category and the author of the post come selected.
        expect(out).toMatch(/<option value="[0-9a-f-]{36}" selected="">Categoria<\/option>/);
        expect(out).toMatch(/<option value="[0-9a-f-]{36}" selected="">Autora Teste<\/option>/);

        const review = await editor(ids.review);
        expect(review).toContain("Aprovar");
        expect(review).toContain("Rejeitar");
        expect(review).not.toContain("Enviar para revisão");

        const overdue = await editor(ids.overdue);
        expect(overdue).toContain("Reagendar");
        expect(overdue).toContain("01/01/2020 12:00");
        expect(overdue).toContain("(America/Sao_Paulo)");
      });

      it("a tradução irmã vira link; sem irmã, oferece criar", async () => {
        const original = await editor(ids.original);
        expect(original).toContain(`href="/blog/${ids.translation}"`);
        expect(original).toContain(TITLES.translation);
        expect(original).not.toContain("traducao_de=");
        const translation = await editor(ids.translation);
        expect(translation).toContain(`href="/blog/${ids.original}"`);
        const alone = await editor(ids.draft);
        expect(alone).toContain(`href="/blog/novo?traducao_de=${ids.draft}"`);
      });

      it("post que não existe, ou id que não é uuid, dá 404 no editor e na prévia", async () => {
        for (const id of ["99999999-9999-4999-8999-999999999999", "nao-e-uuid", "novo-post", "", "1"]) {
          await expect(editor(id), id).rejects.toThrow("NEXT_NOT_FOUND");
          await expect(preview(id), id).rejects.toThrow("NEXT_NOT_FOUND");
        }
      });
    });

    describe("a prévia (/blog/[id]/previa)", () => {
      const setBody = (id: string, bodyHtml: string, extra: Partial<typeof blogPosts.$inferInsert> = {}) =>
        db.update(blogPosts).set({ bodyHtml, ...extra }).where(eq(blogPosts.id, id));

      it("diz que é prévia, volta para o editor, e mostra título, resumo, sumário, tempo de leitura e os blocos especiais", async () => {
        await setBody(
          ids.draft,
          '<h2>Primeira seção</h2><p>Um parágrafo com <a href="/pt/blog/outro">link</a>.</p>{{cta:pitch}}<h3>Um detalhe</h3><p>Fim.</p><h2>Segunda seção</h2>{{mapa}}',
          {
            excerpt: "O resumo do post.",
            tags: ["produto"],
            coverUrl: "/media/posts/a/capa.webp",
            coverAlt: "A capa",
          },
        );
        const out = await preview(ids.draft);
        expect(out).toContain("Prévia");
        expect(out).toContain(`href="/blog/${ids.draft}"`);
        expect(out).toContain("Voltar ao editor");
        expect(out).toContain(`<h1 class="mt-2 text-3xl font-semibold leading-tight">${TITLES.draft}</h1>`);
        expect(out).toContain("O resumo do post.");
        expect(out).toContain("1 min de leitura");
        expect(out).toContain('<img src="/media/posts/a/capa.webp" alt="A capa"');
        // The table of contents links to the ids written into the headings.
        expect(out).toContain('<a href="#primeira-secao" class="text-accent underline">Primeira seção</a>');
        expect(out).toContain('<h2 id="primeira-secao">Primeira seção</h2>');
        expect(out).toContain('<h3 id="um-detalhe">Um detalhe</h3>');
        expect(out).toContain('href="#segunda-secao"');
        // Shortcodes are chips, by their Portuguese name, and never raw markers.
        expect(out).toContain("Bloco especial: CTA: pitch");
        expect(out).toContain("Bloco especial: Mapa do fluxo");
        expect(out).not.toContain("{{");
        expect(out).toContain('<a href="/pt/blog/outro">link</a>');
      });

      it("HTML hostil gravado direto no banco não chega à página sem passar pelo sanitizador", async () => {
        // Straight into the column, as psql or a restore would: nothing of the save path ran.
        await setBody(
          ids.review,
          [
            "<script>window.pwned = 1</script>",
            '<p onclick="steal()" style="position:fixed">texto <b>visível</b></p>',
            '<img src="x" onerror="steal()">',
            '<img src="https://evil.example/pixel.gif" alt="rastreador">',
            '<a href="javascript:steal()">clique</a>',
            '<a href="//evil.example/phish">protocolo relativo</a>',
            '<iframe src="https://evil.example"></iframe>',
            '<h2 id="titulo-do-autor" onmouseover="steal()">Seção</h2>',
            '<svg><script>steal()</script></svg><form action="https://evil.example"><input name="x"></form>',
            '<img src="/media/posts/a/b.webp" alt="nossa">',
          ].join(""),
          { title: "Um título com <b>marcação</b> & \"aspas\"", excerpt: "<img src=x onerror=steal()>" },
        );
        const out = await preview(ids.review);
        for (const forbidden of [
          "<script",
          "pwned",
          "onclick",
          "onerror=\"steal",
          "onmouseover",
          "steal()\"",
          "javascript:",
          "evil.example",
          "<iframe",
          "<svg",
          "<form",
          "<input",
          "position:fixed",
          "titulo-do-autor",
        ]) {
          expect(out, forbidden).not.toContain(forbidden);
        }
        // What is allowed is still there: the text, the link's words, our own image.
        expect(out).toContain("texto visível");
        expect(out).toContain("clique");
        expect(out).toContain('<img src="/media/posts/a/b.webp" alt="nossa" />');
        expect(out).toContain('<h2 id="secao">Seção</h2>');
        // The title and the excerpt are text: escaped by React, never markup.
        expect(out).toContain("Um título com &lt;b&gt;marcação&lt;/b&gt; &amp; &quot;aspas&quot;");
        expect(out).toContain("&lt;img src=x onerror=steal()&gt;");
      });

      it("shortcode dentro de parágrafo (linha que não veio pelo salvar) não corta o HTML no meio", async () => {
        await setBody(ids.overdue, "<p>antes {{cta:pitch}} depois</p><p>fim</p>");
        const out = await preview(ids.overdue);
        expect(out).toContain("<p>antes {{cta:pitch}} depois</p><p>fim</p>");
        expect(out).not.toContain("Bloco especial:");
      });

      it("post sem texto diz isso, e capa que não é do /media não vira imagem", async () => {
        await setBody(ids.original, "", { coverUrl: "https://evil.example/capa.png" });
        const out = await preview(ids.original);
        expect(out).toContain("Este post ainda não tem texto.");
        expect(out).not.toContain("evil.example");
        expect(out).not.toContain("<img");
      });
    });
  });

  it("sem admin, nenhuma página chega ao banco", async () => {
    vi.mocked(requireAdmin).mockRejectedValue(new Error("no admin"));
    const real = shared.db;
    shared.db = new Proxy(
      {},
      {
        get() {
          throw new Error("db touched");
        },
      },
    );
    try {
      const pages = [
        () => Home(),
        () => BlogPage({ searchParams: Promise.resolve({}) }),
        () => NewPostPage({ searchParams: Promise.resolve({}) }),
        () => CategoriesPage(),
        () => AuthorsPage(),
        () => EditPostPage({ params: Promise.resolve({ id: "99999999-9999-4999-8999-999999999999" }) }),
        () => PreviewPage({ params: Promise.resolve({ id: "99999999-9999-4999-8999-999999999999" }) }),
      ];
      for (const page of pages) await expect(page()).rejects.toThrow("no admin");
    } finally {
      shared.db = real;
    }
  });
});
