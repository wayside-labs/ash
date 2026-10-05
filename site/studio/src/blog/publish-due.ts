// Reached by the worker bundle (esbuild): nothing imported here may pull in sharp or
// sanitize-html.
import { and, asc, eq, inArray, lte, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { blogPosts } from "@/db/schema";
import { logAudit } from "@/lib/audit";
import { hasBodyContent } from "./lib/body-content";
import { enqueueSiteRebuild } from "./rebuild";
import { bumpedUpdatedAt } from "./updated-at";

const STATEMENT_TIMEOUT_MS = 5_000;

export type DuePost = { id: string; slug: string; lang: "pt" | "en" };
// `refused` are posts whose date has passed and that were not published because the body is
// empty. They stay "aprovado" with their date, and come back here on every cycle until someone
// writes a body, reschedules, unschedules or publishes now.
export type PublishDueResult = { published: DuePost[]; refused: DuePost[] };

// approve and updatePost already keep an approved post from being empty; this is the same promise
// kept against a row that arrived some other way. "Empty" is hasBodyContent, not a string
// comparison: the editor's blank document is "<p></p>".
export function splitDue<T extends { bodyHtml: string }>(
  candidates: readonly T[],
): { publishable: T[]; refused: T[] } {
  const publishable: T[] = [];
  const refused: T[] = [];
  for (const post of candidates) (hasBodyContent(post.bodyHtml) ? publishable : refused).push(post);
  return { publishable, refused };
}

const brief = ({ id, slug, lang }: DuePost): DuePost => ({ id, slug, lang });

// A step of every worker cycle, not a queue job: a job would need something to enqueue it each
// minute, and that something would be this.
//
// The candidates are read FOR UPDATE, so two workers (or a tick and an admin clicking "publish")
// queue up on the row lock, and the second one re-reads rows that are no longer "aprovado" and
// finds nothing. The UPDATE repeats the status condition anyway: the lock is why it holds, the
// condition is what makes it safe to read.
// The schedule is cleared here for the same reason unpublish clears it: a published post that
// kept its date would go back up by itself after being unpublished.
export async function publishDue(db: Db, now: Date = new Date()): Promise<PublishDueResult> {
  return db.transaction(async (tx) => {
    // This runs before the queue in every cycle, so a row lock held elsewhere (an admin's save
    // stuck mid-transaction) must not stall the jobs behind it. SET LOCAL ends with the
    // transaction; the wait for a lock counts against it. The next cycle tries again.
    await tx.execute(sql`set local statement_timeout = ${sql.raw(String(STATEMENT_TIMEOUT_MS))}`);

    const candidates = await tx
      .select({
        id: blogPosts.id,
        slug: blogPosts.slug,
        lang: blogPosts.lang,
        bodyHtml: blogPosts.bodyHtml,
      })
      .from(blogPosts)
      .where(and(eq(blogPosts.status, "aprovado"), lte(blogPosts.scheduledFor, now)))
      // A fixed order: two workers that each need several of these rows take the locks in the
      // same sequence, so neither can hold one the other is waiting for.
      .orderBy(asc(blogPosts.id))
      .for("update");
    if (candidates.length === 0) return { published: [], refused: [] };

    const { publishable, refused } = splitDue(candidates);
    if (publishable.length === 0) return { published: [], refused: refused.map(brief) };

    const published = await tx
      .update(blogPosts)
      .set({
        status: "publicado",
        // First publication only (decision 2). ISO + cast: postgres-js cannot bind a raw Date
        // inside a sql`` template (see jobs/queue.ts).
        publishedAt: sql`coalesce(${blogPosts.publishedAt}, ${now.toISOString()}::timestamptz)`,
        scheduledFor: null,
        // Not a plain `now`: an editor that opened the post before this must have its save
        // refused as stale, and that takes a token that moved (updated-at.ts).
        updatedAt: bumpedUpdatedAt(now),
      })
      .where(
        and(
          inArray(
            blogPosts.id,
            publishable.map((p) => p.id),
          ),
          eq(blogPosts.status, "aprovado"),
        ),
      )
      .returning({ id: blogPosts.id, slug: blogPosts.slug, lang: blogPosts.lang });

    for (const post of published) {
      // No actor: nobody clicked. `scheduled` tells this row from a manual publish.
      await logAudit(tx, {
        event: "blog.post_published",
        payload: { postId: post.id, slug: post.slug, lang: post.lang, scheduled: true },
      });
    }
    if (published.length > 0) await enqueueSiteRebuild(tx, now);
    return { published, refused: refused.map(brief) };
  });
}

// What the worker registers. A refused post is not an error of the cycle, but it must not be
// silent either, and it repeats every cycle while the post is there.
//
// Two destinations, on purpose. The warning carries the count only: it goes to the heartbeat's
// last_error (worker/cycle.ts) and from there to /api/health, which anything on the Docker
// network can read, and the slug of an unpublished post is a title nobody announced yet. Which
// posts they are goes to the worker's log.
export async function publishDueTick(
  db: Db,
  now: Date,
  log: (line: string) => void = console.error,
): Promise<{ warning: string } | undefined> {
  const { refused } = await publishDue(db, now);
  if (refused.length === 0) return undefined;
  log(JSON.stringify({ at: "publish-due", refused: refused.map((p) => `${p.lang}/${p.slug}`) }));
  return {
    warning: `${refused.length} scheduled post(s) past due and not published: empty body`,
  };
}
