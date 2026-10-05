import { and, asc, eq, getTableColumns, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { blogAuthors, blogPosts } from "@/db/schema";
import { logAudit } from "@/lib/audit";
import { expectOne } from "@/lib/expect-rows";
import { BlogError, FK_VIOLATION, NotFoundError, isUuid, parseInput, pgError } from "./errors";
import { enqueueSiteRebuild } from "./rebuild";
import { UpsertAuthorSchema } from "./schemas";

export type AuthorRow = typeof blogAuthors.$inferSelect;
export type AuthorWithCounts = AuthorRow & { postCount: number; publishedCount: number };

export class AuthorInUseError extends BlogError {
  constructor() {
    super("Este autor tem posts. Troque o autor desses posts antes de apagar.");
  }
}

// The slug is the identity, as in categories.ts. The upsert carries the full document: a bio or
// avatar left out is cleared. As there, the site is rebuilt only when a published post is by this
// author: the public payload lists no one else.
export async function upsertAuthor(
  db: Db,
  input: unknown,
  actor: string,
  now: Date = new Date(),
): Promise<AuthorRow> {
  const doc = parseInput(UpsertAuthorSchema, input);
  const fields = { name: doc.name, bioPt: doc.bio_pt, bioEn: doc.bio_en, avatarUrl: doc.avatar_url };
  return db.transaction(async (tx) => {
    const rows = await tx
      .insert(blogAuthors)
      .values({ slug: doc.slug, ...fields })
      .onConflictDoUpdate({ target: blogAuthors.slug, set: fields })
      .returning();
    const saved = expectOne(rows, "author upsert");
    await logAudit(tx, {
      event: "blog.author_saved",
      actor,
      payload: { id: saved.id, slug: saved.slug },
    });
    const published = await tx
      .select({ id: blogPosts.id })
      .from(blogPosts)
      .where(and(eq(blogPosts.authorId, saved.id), eq(blogPosts.status, "publicado")))
      .limit(1);
    if (published.length > 0) await enqueueSiteRebuild(tx, now);
    return saved;
  });
}

export async function listAuthors(db: Db): Promise<AuthorWithCounts[]> {
  return db
    .select({
      ...getTableColumns(blogAuthors),
      postCount: sql<number>`count(${blogPosts.id})::int`,
      publishedCount: sql<number>`(count(${blogPosts.id}) filter (where ${blogPosts.status} = 'publicado'))::int`,
    })
    .from(blogAuthors)
    .leftJoin(blogPosts, eq(blogPosts.authorId, blogAuthors.id))
    .groupBy(blogAuthors.id)
    .orderBy(asc(blogAuthors.name), asc(blogAuthors.slug));
}

// No rebuild: an author that can be deleted has no post at all, and the public payload lists
// only the authors of published posts, so the site never showed this one.
export async function deleteAuthor(db: Db, id: string, actor: string): Promise<void> {
  if (!isUuid(id)) throw new NotFoundError("Autor não encontrado");
  try {
    await db.transaction(async (tx) => {
      const rows = await tx
        .delete(blogAuthors)
        .where(eq(blogAuthors.id, id))
        .returning({ id: blogAuthors.id, slug: blogAuthors.slug });
      const gone = rows[0];
      if (rows.length !== 1 || !gone) throw new NotFoundError("Autor não encontrado");
      // The slug goes in because the row is gone: the id alone would name nothing.
      await logAudit(tx, { event: "blog.author_deleted", actor, payload: gone });
    });
  } catch (err) {
    // ON DELETE RESTRICT on blog_posts.author_id: the database is what decides, so a post saved
    // a moment ago still counts. Nothing else in this transaction has a foreign key.
    if (pgError(err)?.code === FK_VIOLATION) throw new AuthorInUseError();
    throw err;
  }
}
