import { type SQL, and, eq, isNotNull, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { blogPosts } from "@/db/schema";
import { logAudit } from "@/lib/audit";
import { BlogError, StalePostError, ValidationError, parseInput } from "./errors";
import { hasBodyContent } from "./lib/body-content";
import type { PostLang, PostStatus } from "./posts";
import { enqueueSiteRebuild } from "./rebuild";
import { type PostAction, RejectPostSchema, SetPostStatusSchema } from "./schemas";
import { bumpedUpdatedAt } from "./updated-at";

// The conditional UPDATE matched no row: someone else moved the post first, the screen was stale,
// or the post does not exist. Nothing was written.
export class LostTransitionError extends BlogError {
  constructor(
    readonly postId: string,
    readonly expected: PostStatus,
    message = `O post não está mais em "${expected}" (ou não existe). Recarregue a página.`,
  ) {
    super(message);
  }
}

// The post is where the action expects it, but has no date to take away. A LostTransitionError
// all the same (nothing was written, the screen is stale), with a message that does not claim
// the post left a state it is still in.
export class NotScheduledError extends LostTransitionError {
  constructor(postId: string) {
    super(postId, "aprovado", "Este post não está agendado. Recarregue a página.");
  }
}

type Transition = {
  from: PostStatus;
  to: PostStatus;
  event: string;
  rebuild?: true;
  // A condition on the row beyond its state, checked by the same conditional UPDATE, and the
  // error for a post that is in the right state and fails only this.
  only?: { where: SQL; lost: (postId: string) => LostTransitionError };
};

// Written, not ported: in boringco a manual post had no way out of rascunho.
const MACHINE: Record<PostAction | "reject", Transition> = {
  submit: { from: "rascunho", to: "revisao", event: "blog.post_submitted" },
  approve: { from: "revisao", to: "aprovado", event: "blog.post_approved" },
  reject: { from: "revisao", to: "rejeitado", event: "blog.post_rejected" },
  reopen: { from: "rejeitado", to: "rascunho", event: "blog.post_reopened" },
  schedule: { from: "aprovado", to: "aprovado", event: "blog.post_scheduled" },
  // Without the date condition, a second click (or a click on a stale screen) would write an
  // audit row saying a schedule was removed when there was none.
  unschedule: {
    from: "aprovado",
    to: "aprovado",
    event: "blog.post_unscheduled",
    only: { where: isNotNull(blogPosts.scheduledFor), lost: (id) => new NotScheduledError(id) },
  },
  publish: { from: "aprovado", to: "publicado", event: "blog.post_published", rebuild: true },
  unpublish: { from: "publicado", to: "aprovado", event: "blog.post_unpublished", rebuild: true },
};

// updatedAt is the editor's token for its next save (updatePost's if_updated_at): a transition
// moves updated_at, so without it an open editor would be refused as stale after its own click.
export type TransitionResult = {
  id: string;
  slug: string;
  lang: PostLang;
  status: PostStatus;
  updatedAt: string;
};

// postgres-js cannot bind a raw Date inside a sql`` template (see jobs/queue.ts).
const iso = (d: Date) => d.toISOString();

type Patch = Partial<Pick<typeof blogPosts.$inferInsert, "scheduledFor" | "feedback">> & {
  publishedAt?: ReturnType<typeof sql>;
};

// One transaction per transition: the state change, its audit row and (when the site is
// affected) the rebuild job commit together or not at all.
//
// `token` is the caller's if_updated_at (schemas.ts). With it, the UPDATE also demands that the
// row is still the version the caller saw. Milliseconds on both sides, as in updatePost: the
// token came out of a JS Date, which dropped the microseconds Postgres keeps.
async function transition(
  db: Db,
  action: PostAction | "reject",
  id: string,
  actor: string,
  now: Date,
  token: string | undefined,
  patch: Patch,
  payload: Record<string, unknown> = {},
  guard?: (tx: Db) => Promise<void>,
): Promise<TransitionResult> {
  const { from, to, event, rebuild, only } = MACHINE[action];
  const sameVersion = token
    ? sql`date_trunc('milliseconds', ${blogPosts.updatedAt}) = ${token}::timestamptz`
    : undefined;
  return db.transaction(async (tx) => {
    if (guard) await guard(tx);
    const rows = await tx
      .update(blogPosts)
      // Every transition moves the editor's token (updated-at.ts).
      .set({ ...patch, status: to, updatedBy: actor, updatedAt: bumpedUpdatedAt(now) })
      .where(and(eq(blogPosts.id, id), eq(blogPosts.status, from), only?.where, sameVersion))
      .returning({
        id: blogPosts.id,
        slug: blogPosts.slug,
        lang: blogPosts.lang,
        status: blogPosts.status,
        updatedAt: blogPosts.updatedAt,
      });
    const moved = rows[0];
    if (rows.length !== 1 || !moved) {
      // Which condition failed decides the message. Same transaction, so each of these reads is
      // of the row the UPDATE just did not match. In order: the state (the screen is stale in
      // the plainest way), then the action's own condition, and only then the version, which is
      // the one left when the row is where the action expects it.
      const [inState] = await tx
        .select({ id: blogPosts.id })
        .from(blogPosts)
        .where(and(eq(blogPosts.id, id), eq(blogPosts.status, from)));
      if (!inState) throw new LostTransitionError(id, from);
      if (only) {
        const [fits] = await tx
          .select({ id: blogPosts.id })
          .from(blogPosts)
          .where(and(eq(blogPosts.id, id), eq(blogPosts.status, from), only.where));
        if (!fits) throw only.lost(id);
      }
      if (sameVersion) throw new StalePostError();
      throw new LostTransitionError(id, from);
    }
    await logAudit(tx, {
      event,
      actor,
      payload: { postId: moved.id, slug: moved.slug, lang: moved.lang, ...payload },
    });
    if (rebuild) await enqueueSiteRebuild(tx, now);
    return { ...moved, updatedAt: moved.updatedAt.toISOString() };
  });
}

export async function setPostStatus(
  db: Db,
  input: unknown,
  actor: string,
  now: Date = new Date(),
): Promise<TransitionResult> {
  const {
    id,
    action,
    scheduled_for,
    if_updated_at: token,
  } = parseInput(SetPostStatusSchema, input);

  switch (action) {
    case "submit":
    case "reopen":
      // reopen keeps the feedback: the author fixes the draft with the note in front of them.
      return transition(db, action, id, actor, now, token, {});
    case "approve":
      return transition(db, action, id, actor, now, token, { feedback: null }, {}, async (tx) => {
        // The lock holds the body still between this read and the UPDATE below.
        const [post] = await tx
          .select({ bodyHtml: blogPosts.bodyHtml })
          .from(blogPosts)
          .where(and(eq(blogPosts.id, id), eq(blogPosts.status, MACHINE.approve.from)))
          .for("update");
        if (post && !hasBodyContent(post.bodyHtml)) {
          throw new ValidationError("Post sem corpo: escreva o texto antes de aprovar.");
        }
      });
    case "schedule": {
      // The schema already refused a schedule without a date; this narrows the type.
      if (!scheduled_for) throw new ValidationError("Escolha uma data.");
      return transition(
        db,
        action,
        id,
        actor,
        now,
        token,
        { scheduledFor: new Date(scheduled_for) },
        { scheduledFor: scheduled_for },
      );
    }
    case "unschedule":
      // The way out for a scheduled post that should not go up by itself (publish-due.ts).
      return transition(db, action, id, actor, now, token, { scheduledFor: null });
    case "publish":
      // First publication only: unpublish keeps the date, so a republish keeps date and URL.
      return transition(db, action, id, actor, now, token, {
        scheduledFor: null,
        publishedAt: sql`coalesce(${blogPosts.publishedAt}, ${iso(now)}::timestamptz)`,
      });
    case "unpublish":
      // Clearing the schedule is the point: in boringco an unpublished post that still carried
      // its date went back up by itself on the next tick.
      return transition(db, action, id, actor, now, token, { scheduledFor: null });
  }
}

export async function rejectPost(
  db: Db,
  input: unknown,
  actor: string,
  now: Date = new Date(),
): Promise<TransitionResult> {
  const { id, feedback, if_updated_at: token } = parseInput(RejectPostSchema, input);
  return transition(db, "reject", id, actor, now, token, { feedback });
}
