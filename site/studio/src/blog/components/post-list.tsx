"use client";

import Link from "next/link";
import { useState } from "react";
import { setPostStatus } from "@/blog/actions/status";
import { formatDate, formatDateTime } from "@/blog/lib/format-date";
import { blogHref } from "@/blog/lib/list-query";
import type { PostRowView } from "@/blog/lib/list-rows";
import { LANG_LABEL, rowActions } from "@/blog/lib/post-status";
import type { PostAction } from "@/blog/schemas";
import { Button, buttonClass } from "@/ui/button";
import { ConfirmDialog } from "@/ui/confirm-dialog";
import { Notice } from "@/ui/notice";
import { StatusBadge } from "@/ui/status-badge";
import { useAction } from "@/ui/use-action";
import { ScheduleDialog } from "./schedule-dialog";

// Below `lg` the table becomes a stack of cards: each row a block, each cell a line that says
// what it is (the header row is only read by screen readers there). The label ends in ": " so
// the line reads "Idioma: Português", to the eye and to a screen reader alike.
const CELL = "px-4 py-3 align-top max-lg:block max-lg:px-0 max-lg:py-1";
const LABELLED =
  "max-lg:before:text-xs max-lg:before:text-faint max-lg:before:content-[attr(data-label)_':_']";
const HEAD = "px-4 py-3 font-medium";

// Publishing and unpublishing change the public site; they ask first.
type Asking = "publish" | "unpublish" | "schedule" | null;

function PostRow({ post, tz, zone }: { post: PostRowView; tz: string; zone: string }) {
  const { pending, error, run, clearError, isRunning } = useAction();
  const [asking, setAsking] = useState<Asking>(null);
  const actions = rowActions(post);

  // Every transition carries the version this row was rendered from: if the post was saved or
  // moved since, the server refuses, and nobody publishes text that changed behind the list.
  const act = (action: PostAction) =>
    run(
      () => setPostStatus({ id: post.id, action, if_updated_at: post.updatedAt }),
      () => setAsking(null),
      { key: action },
    );
  const stopAsking = () => {
    setAsking(null);
    clearError();
  };
  // The spinner goes on the button that was clicked; the rest of the row only stops answering.
  const state = (action: PostAction) => ({
    pending: isRunning(action),
    blocked: pending && !isRunning(action),
  });
  // Twenty rows have twenty "Editar": the name of each control says which post it is about.
  const named = (label: string) => `${label}: ${post.title}`;

  return (
    <tr className="border-b border-line last:border-b-0 max-lg:block max-lg:px-4 max-lg:py-3">
      <td className={`${CELL} lg:w-full`}>
        <p className="font-medium text-ink">{post.title}</p>
        <p className="mt-0.5 text-xs text-muted">
          {post.categoryName ?? "Sem categoria"} · {post.authorName ?? "Sem autor"}
        </p>
        {post.status === "aprovado" && post.scheduledFor ? (
          <p className={`mt-1 text-xs ${post.overdue ? "text-warning" : "text-muted"}`}>
            {post.overdue ? "Agendamento vencido: " : "Agendado para "}
            <span className="font-mono tabular-nums">{formatDateTime(post.scheduledFor, tz)}</span>
          </p>
        ) : null}
        {/* Whenever there is one, not only while rejected: reopening keeps the comment on purpose
            (status.ts), so the author fixes the draft with it in sight. Approval clears it. */}
        {post.feedback ? (
          <p className="mt-1 text-xs text-muted">
            <span className={post.status === "rejeitado" ? "text-deny" : "text-warning"}>
              Comentário da última rejeição:
            </span>{" "}
            {post.feedback}
          </p>
        ) : null}
      </td>
      <td className={`${CELL} ${LABELLED} whitespace-nowrap text-muted`} data-label="Idioma">
        {LANG_LABEL[post.lang]}
      </td>
      <td className={`${CELL} ${LABELLED}`} data-label="Estado">
        <StatusBadge status={post.status} />
      </td>
      <td
        className={`${CELL} ${LABELLED} whitespace-nowrap font-mono text-xs tabular-nums text-muted`}
        data-label="Atualizado em"
      >
        {formatDateTime(post.updatedAt, tz)}
      </td>
      <td
        className={`${CELL} ${LABELLED} whitespace-nowrap font-mono text-xs tabular-nums text-muted`}
        data-label="No ar desde"
      >
        {post.status === "publicado" && post.publishedAt ? formatDate(post.publishedAt, tz) : "—"}
      </td>
      <td className={`${CELL} lg:min-w-72`}>
        <div className="flex flex-wrap gap-1.5 max-lg:mt-2">
          <Link
            href={`/blog/${post.id}`}
            aria-label={named("Editar")}
            className={buttonClass("secondary", "sm")}
          >
            Editar
          </Link>
          {actions.includes("submit") ? (
            <Button
              size="sm"
              variant="primary"
              aria-label={named("Enviar para revisão")}
              {...state("submit")}
              onClick={() => act("submit")}
            >
              Enviar para revisão
            </Button>
          ) : null}
          {post.status === "revisao" ? (
            <Link
              href={blogHref({ view: "revisao" })}
              aria-label={named("Ver na revisão")}
              className={buttonClass("ghost", "sm")}
            >
              Ver na revisão
            </Link>
          ) : null}
          {actions.includes("publish") ? (
            <Button
              size="sm"
              variant="primary"
              aria-label={named("Publicar agora")}
              blocked={pending}
              onClick={() => setAsking("publish")}
            >
              Publicar agora
            </Button>
          ) : null}
          {actions.includes("schedule") ? (
            <Button
              size="sm"
              aria-label={named(post.scheduledFor ? "Reagendar" : "Agendar")}
              blocked={pending}
              onClick={() => setAsking("schedule")}
            >
              {post.scheduledFor ? "Reagendar" : "Agendar"}
            </Button>
          ) : null}
          {actions.includes("unschedule") ? (
            <Button
              size="sm"
              aria-label={named("Desagendar")}
              {...state("unschedule")}
              onClick={() => act("unschedule")}
            >
              Desagendar
            </Button>
          ) : null}
          {actions.includes("unpublish") ? (
            <Button
              size="sm"
              aria-label={named("Despublicar")}
              blocked={pending}
              onClick={() => setAsking("unpublish")}
            >
              Despublicar
            </Button>
          ) : null}
          {actions.includes("reopen") ? (
            <Button
              size="sm"
              aria-label={named("Reabrir")}
              {...state("reopen")}
              onClick={() => act("reopen")}
            >
              Reabrir
            </Button>
          ) : null}
          {post.hasTranslation ? null : (
            <Link
              href={`/blog/novo?traducao_de=${post.id}`}
              aria-label={named("Criar tradução")}
              className={buttonClass("ghost", "sm")}
            >
              Criar tradução
            </Link>
          )}
        </div>
        {/* While a dialog is open the error is shown inside it, where the admin is looking. */}
        {error && asking === null ? (
          <Notice tone="error" className="mt-2">
            {error}
          </Notice>
        ) : null}

        <ConfirmDialog
          open={asking === "publish"}
          title="Publicar agora?"
          confirmLabel="Publicar agora"
          pending={pending}
          error={error}
          onConfirm={() => act("publish")}
          onClose={stopAsking}
        >
          <span className="text-ink">{post.title}</span> entra no site público em{" "}
          {LANG_LABEL[post.lang].toLowerCase()} assim que o site for reconstruído, o que leva
          alguns minutos.
          {post.scheduledFor ? " O agendamento deste post é cancelado." : ""}
        </ConfirmDialog>
        <ConfirmDialog
          open={asking === "unpublish"}
          title="Despublicar?"
          confirmLabel="Despublicar"
          tone="danger"
          pending={pending}
          error={error}
          onConfirm={() => act("unpublish")}
          onClose={stopAsking}
        >
          <span className="text-ink">{post.title}</span> sai do site público e o link dele deixa
          de funcionar. O post volta para “Aprovado” e pode ser publicado de novo, no mesmo
          endereço.
        </ConfirmDialog>
        <ScheduleDialog
          open={asking === "schedule"}
          onClose={stopAsking}
          post={post}
          tz={tz}
          zone={zone}
        />
      </td>
    </tr>
  );
}

export function PostList({
  posts,
  tz,
  zone,
}: {
  posts: readonly PostRowView[];
  // PUBLISH_TZ, and its name written out; both come from the server page.
  tz: string;
  zone: string;
}) {
  return (
    <div className="surface-card overflow-hidden">
      <table className="w-full text-left text-sm max-lg:block">
        <thead className="border-b border-line text-xs text-faint max-lg:sr-only">
          <tr>
            <th scope="col" className={HEAD}>
              Título
            </th>
            <th scope="col" className={HEAD}>
              Idioma
            </th>
            <th scope="col" className={HEAD}>
              Estado
            </th>
            <th scope="col" className={HEAD}>
              Atualizado em
            </th>
            <th scope="col" className={HEAD}>
              No ar desde
            </th>
            <th scope="col" className={HEAD}>
              Ações
            </th>
          </tr>
        </thead>
        <tbody className="max-lg:block">
          {posts.map((post) => (
            <PostRow key={post.id} post={post} tz={tz} zone={zone} />
          ))}
        </tbody>
      </table>
      <p className="border-t border-line px-4 py-2 text-xs text-faint">
        Horários no fuso do blog: {zone}.
      </p>
    </div>
  );
}
