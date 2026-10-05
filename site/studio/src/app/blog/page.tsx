import Link from "next/link";
import type { ReactNode } from "react";
import { listAuthors } from "@/blog/authors";
import { listCategories } from "@/blog/categories";
import { PostList } from "@/blog/components/post-list";
import { ReviewList } from "@/blog/components/review-list";
import { ScheduledList } from "@/blog/components/scheduled-list";
import { zoneLabel } from "@/blog/lib/format-date";
import { type BlogQuery, blogHref, parseBlogQuery } from "@/blog/lib/list-query";
import { toPostRows } from "@/blog/lib/list-rows";
import { LANG_LABEL, POST_STATUSES, STATUS_LABEL } from "@/blog/lib/post-status";
import {
  LIST_LIMIT_DEFAULT,
  countPostsByStatus,
  countScheduled,
  listPosts,
  listScheduled,
  listTranslatedGroups,
} from "@/blog/posts";
import { POST_LANGS } from "@/blog/schemas";
import { db } from "@/db/client";
import { requireAdmin } from "@/lib/admin";
import { env } from "@/lib/env";
import { buttonClass } from "@/ui/button";
import { Tabs } from "@/ui/tabs";

export const dynamic = "force-dynamic";
export const metadata = { title: "Blog · Ash Studio" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const sum = (counts: Record<string, number>) =>
  Object.values(counts).reduce((total, count) => total + count, 0);

function Empty({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="surface-card p-10 text-center text-sm text-muted">
      <p className="text-base text-ink">{title}</p>
      <div className="mx-auto mt-2 max-w-prose leading-relaxed">{children}</div>
    </div>
  );
}

async function PostsView({ query, tz, zone }: { query: BlogQuery; tz: string; zone: string }) {
  const database = db();
  const [posts, counts, translated, categories, authors] = await Promise.all([
    listPosts(database, {
      ...(query.status ? { status: query.status } : {}),
      ...(query.lang ? { lang: query.lang } : {}),
    }),
    countPostsByStatus(database, query.lang ? { lang: query.lang } : {}),
    // Over the whole table, not the list: the sibling of a row may be outside the filter.
    listTranslatedGroups(database),
    listCategories(database),
    listAuthors(database),
  ]);
  const rows = toPostRows(posts, { categories, authors, translated, now: new Date() });
  const total = sum(counts);
  const matching = query.status ? counts[query.status] : total;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        <div className="flex items-center gap-2">
          <span className="text-xs text-faint">Idioma</span>
          <Tabs
            variant="pills"
            label="Filtrar por idioma"
            items={[
              { href: blogHref({ ...query, lang: null }), label: "Todos", current: !query.lang },
              ...POST_LANGS.map((lang) => ({
                href: blogHref({ ...query, lang }),
                label: LANG_LABEL[lang],
                current: query.lang === lang,
              })),
            ]}
          />
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-faint">Estado</span>
          <Tabs
            variant="pills"
            label="Filtrar por estado"
            items={[
              {
                href: blogHref({ ...query, status: null }),
                label: "Todos",
                count: total,
                current: !query.status,
              },
              ...POST_STATUSES.map((status) => ({
                href: blogHref({ ...query, status }),
                label: STATUS_LABEL[status],
                count: counts[status],
                current: query.status === status,
              })),
            ]}
          />
        </div>
      </div>

      {rows.length === 0 ? (
        query.lang || query.status ? (
          <Empty title="Nenhum post com este filtro.">
            <Link href={blogHref({})} className="text-accent underline">
              Ver todos os posts
            </Link>
          </Empty>
        ) : (
          <Empty title="Ainda não há nenhum post.">
            Comece por{" "}
            <Link href="/blog/novo" className="text-accent underline">
              Novo post
            </Link>
            : você dá o título, escolhe o idioma e o autor, e o editor abre com um rascunho.
          </Empty>
        )
      ) : (
        <PostList posts={rows} tz={tz} zone={zone} />
      )}
      {matching > rows.length ? (
        <p className="text-xs text-faint">
          Mostrando os {rows.length} posts mais recentes de {matching}. Use os filtros para chegar
          aos mais antigos (a lista mostra até {LIST_LIMIT_DEFAULT} por vez).
        </p>
      ) : null}
    </div>
  );
}

async function ReviewView({ tz }: { tz: string }) {
  const database = db();
  const [posts, categories, authors] = await Promise.all([
    listPosts(database, { status: "revisao" }),
    listCategories(database),
    listAuthors(database),
  ]);
  if (posts.length === 0) {
    return (
      <Empty title="Nada esperando revisão.">
        Um rascunho chega aqui quando alguém clica em “Enviar para revisão” na lista de posts ou
        no editor. Aprovado, ele pode ser publicado ou agendado; rejeitado, volta para quem
        escreveu com o seu comentário.
      </Empty>
    );
  }
  // hasTranslation is not shown on this tab, so the group lookup is skipped.
  const rows = toPostRows(posts, { categories, authors, translated: new Set(), now: new Date() });
  return <ReviewList posts={rows} tz={tz} />;
}

async function ScheduledView({ tz, zone }: { tz: string; zone: string }) {
  const database = db();
  const [posts, categories, authors] = await Promise.all([
    listScheduled(database),
    listCategories(database),
    listAuthors(database),
  ]);
  if (posts.length === 0) {
    return (
      <Empty title="Nenhum post agendado.">
        Para agendar, aprove o post e use “Agendar” na lista de posts: ele vai ao ar sozinho no
        dia e na hora escolhidos, no fuso do blog ({zone}).
      </Empty>
    );
  }
  const rows = toPostRows(posts, { categories, authors, translated: new Set(), now: new Date() });
  return <ScheduledList posts={rows} tz={tz} zone={zone} />;
}

export default async function BlogPage({ searchParams }: { searchParams: SearchParams }) {
  await requireAdmin();
  const query = parseBlogQuery(await searchParams);
  const tz = env().PUBLISH_TZ;
  const zone = zoneLabel(tz);
  const database = db();
  const [counts, scheduled] = await Promise.all([
    countPostsByStatus(database),
    countScheduled(database),
  ]);

  return (
    <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Blog</h1>
          <p className="mt-1 text-sm text-muted">
            Rascunho, revisão, aprovação e publicação dos posts do site.
          </p>
        </div>
        <Link href="/blog/novo" className={buttonClass("primary")}>
          Novo post
        </Link>
      </div>

      <div className="mt-6">
        <Tabs
          label="Seções do blog"
          items={[
            {
              href: blogHref({ view: "posts" }),
              label: "Posts",
              count: sum(counts),
              current: query.view === "posts",
            },
            {
              href: blogHref({ view: "revisao" }),
              label: "Revisão",
              count: counts.revisao,
              current: query.view === "revisao",
            },
            {
              href: blogHref({ view: "agendados" }),
              label: "Agendados",
              count: scheduled.total,
              current: query.view === "agendados",
            },
          ]}
        />
      </div>

      <div className="mt-6">
        {query.view === "posts" ? <PostsView query={query} tz={tz} zone={zone} /> : null}
        {query.view === "revisao" ? <ReviewView tz={tz} /> : null}
        {query.view === "agendados" ? <ScheduledView tz={tz} zone={zone} /> : null}
      </div>
    </main>
  );
}
