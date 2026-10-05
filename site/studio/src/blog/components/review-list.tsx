"use client";

import Link from "next/link";
import { useState } from "react";
import { setPostStatus } from "@/blog/actions/status";
import { formatDateTime } from "@/blog/lib/format-date";
import type { PostRowView } from "@/blog/lib/list-rows";
import { LANG_LABEL } from "@/blog/lib/post-status";
import { Button, buttonClass } from "@/ui/button";
import { Notice } from "@/ui/notice";
import { useAction } from "@/ui/use-action";
import { RejectDialog } from "./reject-dialog";

function ReviewItem({ post, tz }: { post: PostRowView; tz: string }) {
  const { pending, error, run } = useAction();
  const [rejecting, setRejecting] = useState(false);
  const named = (label: string) => `${label}: ${post.title}`;

  return (
    <li className="surface-card p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1 basis-80">
          <h2 className="font-medium text-ink">{post.title}</h2>
          <p className="mt-1 text-xs text-muted">
            {LANG_LABEL[post.lang]} · {post.authorName ?? "Sem autor"} ·{" "}
            {post.categoryName ?? "Sem categoria"} · atualizado em{" "}
            <span className="font-mono tabular-nums">{formatDateTime(post.updatedAt, tz)}</span>
          </p>
          {post.excerpt ? <p className="mt-2 text-sm text-muted">{post.excerpt}</p> : null}
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            href={`/blog/${post.id}`}
            aria-label={named("Abrir no editor")}
            className={buttonClass("secondary", "sm")}
          >
            Abrir no editor
          </Link>
          <Button
            size="sm"
            aria-label={named("Rejeitar")}
            blocked={pending}
            onClick={() => setRejecting(true)}
          >
            Rejeitar
          </Button>
          <Button
            size="sm"
            variant="primary"
            aria-label={named("Aprovar")}
            pending={pending}
            // With the version this item was rendered from: a text edited after the list opened
            // is not the text the reviewer read, and the server refuses to approve it.
            onClick={() =>
              run(() =>
                setPostStatus({ id: post.id, action: "approve", if_updated_at: post.updatedAt }),
              )
            }
          >
            Aprovar
          </Button>
        </div>
      </div>
      {error ? (
        <Notice tone="error" className="mt-3">
          {error}
        </Notice>
      ) : null}
      <RejectDialog open={rejecting} onClose={() => setRejecting(false)} post={post} />
    </li>
  );
}

// Only posts in "revisao" come here (the page asks for that state alone).
export function ReviewList({ posts, tz }: { posts: readonly PostRowView[]; tz: string }) {
  return (
    <ul className="space-y-3">
      {posts.map((post) => (
        <ReviewItem key={post.id} post={post} tz={tz} />
      ))}
    </ul>
  );
}
