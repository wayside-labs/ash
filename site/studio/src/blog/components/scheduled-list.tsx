"use client";

import Link from "next/link";
import { useState } from "react";
import { setPostStatus } from "@/blog/actions/status";
import { formatDateTime } from "@/blog/lib/format-date";
import type { PostRowView } from "@/blog/lib/list-rows";
import { LANG_LABEL } from "@/blog/lib/post-status";
import { Button, buttonClass } from "@/ui/button";
import { ConfirmDialog } from "@/ui/confirm-dialog";
import { Notice } from "@/ui/notice";
import { useAction } from "@/ui/use-action";
import { ScheduleDialog } from "./schedule-dialog";

type Asking = "publish" | "schedule" | null;

function ScheduledItem({ post, tz, zone }: { post: PostRowView; tz: string; zone: string }) {
  const { pending, error, run, clearError, isRunning } = useAction();
  const [asking, setAsking] = useState<Asking>(null);
  const stopAsking = () => {
    setAsking(null);
    clearError();
  };
  const named = (label: string) => `${label}: ${post.title}`;

  return (
    <li className="surface-card p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1 basis-80">
          <h2 className="font-medium text-ink">{post.title}</h2>
          <p className="mt-1 text-xs text-muted">
            {LANG_LABEL[post.lang]} · {post.authorName ?? "Sem autor"} ·{" "}
            {post.categoryName ?? "Sem categoria"}
          </p>
          <p className="mt-2 text-sm text-ink">
            {post.overdue ? "Deveria ter ido ao ar em " : "Vai ao ar em "}
            <span className="font-mono tabular-nums">{formatDateTime(post.scheduledFor, tz)}</span>
            <span className="text-muted"> · {zone}</span>
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            href={`/blog/${post.id}`}
            aria-label={named("Editar")}
            className={buttonClass("secondary", "sm")}
          >
            Editar
          </Link>
          <Button
            size="sm"
            aria-label={named("Reagendar")}
            blocked={pending}
            onClick={() => setAsking("schedule")}
          >
            Reagendar
          </Button>
          <Button
            size="sm"
            aria-label={named("Desagendar")}
            pending={isRunning("unschedule")}
            blocked={pending && !isRunning("unschedule")}
            onClick={() =>
              run(
                () =>
                  setPostStatus({
                    id: post.id,
                    action: "unschedule",
                    if_updated_at: post.updatedAt,
                  }),
                undefined,
                { key: "unschedule" },
              )
            }
          >
            Desagendar
          </Button>
          <Button
            size="sm"
            variant="primary"
            aria-label={named("Publicar agora")}
            blocked={pending}
            onClick={() => setAsking("publish")}
          >
            Publicar agora
          </Button>
        </div>
      </div>
      {post.overdue ? (
        // The worker publishes within a minute of the date, except a post with no text: that
        // one stays here, approved and dated, and keeps the health check red (publish-due.ts).
        <Notice tone="warning" className="mt-3">
          Atrasado: o horário já passou e o post não foi ao ar. Se ele continuar aqui por mais de
          alguns minutos, é porque está sem texto, e o sistema não publica post vazio. Escreva o
          texto, reagende, desagende ou publique agora.
        </Notice>
      ) : null}
      {error && asking === null ? (
        <Notice tone="error" className="mt-3">
          {error}
        </Notice>
      ) : null}

      <ConfirmDialog
        open={asking === "publish"}
        title="Publicar agora?"
        confirmLabel="Publicar agora"
        pending={pending}
        error={error}
        onConfirm={() =>
          // With the version this item was rendered from, as every transition of the lists.
          run(
            () => setPostStatus({ id: post.id, action: "publish", if_updated_at: post.updatedAt }),
            () => setAsking(null),
            { key: "publish" },
          )
        }
        onClose={stopAsking}
      >
        <span className="text-ink">{post.title}</span> entra no site público sem esperar o horário
        agendado, assim que o site for reconstruído (alguns minutos).
      </ConfirmDialog>
      <ScheduleDialog
        open={asking === "schedule"}
        onClose={stopAsking}
        post={post}
        tz={tz}
        zone={zone}
      />
    </li>
  );
}

// Approved posts with a date, soonest first (listScheduled); an overdue one comes on top.
export function ScheduledList({
  posts,
  tz,
  zone,
}: {
  posts: readonly PostRowView[];
  tz: string;
  zone: string;
}) {
  return (
    <ul className="space-y-3">
      {posts.map((post) => (
        <ScheduledItem key={post.id} post={post} tz={tz} zone={zone} />
      ))}
    </ul>
  );
}
