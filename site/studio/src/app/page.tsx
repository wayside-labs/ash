import Link from "next/link";
import { blogHref } from "@/blog/lib/list-query";
import { POST_STATUSES, type PostStatus, STATUS_LABEL } from "@/blog/lib/post-status";
import { countPostsByStatus, countScheduled } from "@/blog/posts";
import { db } from "@/db/client";
import { requireAdmin } from "@/lib/admin";
import { buttonClass } from "@/ui/button";

export const dynamic = "force-dynamic";

// What each state is waiting for, in a line.
const NEXT_STEP: Record<PostStatus, string> = {
  rascunho: "sendo escritos",
  revisao: "esperando alguém aprovar ou rejeitar",
  aprovado: "prontos para publicar ou agendar",
  publicado: "no ar",
  rejeitado: "devolvidos com comentário",
};

// The review tab is where a post in review is acted on; the others are a filter of the list.
const hrefFor = (status: PostStatus) =>
  status === "revisao" ? blogHref({ view: "revisao" }) : blogHref({ status });

const CARD = "surface-card block h-full p-4 hover:border-line-strong";

export default async function Home() {
  const who = await requireAdmin();
  const database = db();
  const [counts, scheduled] = await Promise.all([
    countPostsByStatus(database),
    countScheduled(database),
  ]);
  const overdue = scheduled.overdue;

  return (
    <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
      <p className="text-sm text-muted">Ash Studio</p>
      <h1 className="mt-1 text-2xl font-semibold">Olá, {who.email}</h1>

      <section aria-labelledby="home-posts" className="mt-8">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <h2 id="home-posts" className="text-base font-medium">
            Posts por estado
          </h2>
          <Link href="/blog/novo" className={buttonClass("primary")}>
            Novo post
          </Link>
        </div>
        <ul className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {POST_STATUSES.map((status) => (
            <li key={status}>
              <Link href={hrefFor(status)} className={CARD}>
                <p className="font-mono text-2xl tabular-nums text-ink">{counts[status]}</p>
                <p className="mt-1 text-sm font-medium text-ink">{STATUS_LABEL[status]}</p>
                <p className="mt-0.5 text-xs text-muted">{NEXT_STEP[status]}</p>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="home-shortcuts" className="mt-8">
        <h2 id="home-shortcuts" className="text-base font-medium">
          Atalhos
        </h2>
        <ul className="mt-4 grid gap-3 sm:grid-cols-2">
          <li>
            <Link href={blogHref({ view: "agendados" })} className={CARD}>
              <p className="text-sm font-medium text-ink">
                Agendados{" "}
                <span className="font-mono tabular-nums text-muted">{scheduled.total}</span>
              </p>
              <p className={`mt-0.5 text-xs ${overdue > 0 ? "text-warning" : "text-muted"}`}>
                {overdue > 0
                  ? `${overdue} com o horário vencido: abra para ver o porquê.`
                  : "Posts aprovados que vão ao ar sozinhos, com dia e hora."}
              </p>
            </Link>
          </li>
          <li>
            <Link href="/blog" className={CARD}>
              <p className="text-sm font-medium text-ink">Todos os posts</p>
              <p className="mt-0.5 text-xs text-muted">
                A lista completa, com filtro de idioma e estado.
              </p>
            </Link>
          </li>
          <li>
            <Link href="/blog/categorias" className={CARD}>
              <p className="text-sm font-medium text-ink">Categorias</p>
              <p className="mt-0.5 text-xs text-muted">
                Criar, renomear e apagar os grupos de posts.
              </p>
            </Link>
          </li>
          <li>
            <Link href="/blog/autores" className={CARD}>
              <p className="text-sm font-medium text-ink">Autores</p>
              <p className="mt-0.5 text-xs text-muted">
                Quem assina os posts, com bio em cada idioma.
              </p>
            </Link>
          </li>
        </ul>
      </section>

      <section aria-labelledby="home-health" className="mt-8">
        <h2 id="home-health" className="text-base font-medium">
          Saúde do sistema
        </h2>
        <p className="mt-2 text-sm text-muted">
          Banco, publicador automático, fila de tarefas e reconstrução do site, em{" "}
          {/* A plain anchor: the answer is JSON, not a page of the app. */}
          <a className="font-mono text-settle underline" href="/api/health">
            /api/health
          </a>
          .
        </p>
      </section>
    </main>
  );
}
