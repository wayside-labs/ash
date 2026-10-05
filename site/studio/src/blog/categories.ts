import { and, asc, eq, getTableColumns, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { blogCategories, blogPosts } from "@/db/schema";
import { logAudit } from "@/lib/audit";
import { expectOne } from "@/lib/expect-rows";
import { NotFoundError, isUuid, parseInput } from "./errors";
import { enqueueSiteRebuild } from "./rebuild";
import { UpsertCategorySchema } from "./schemas";

export type CategoryRow = typeof blogCategories.$inferSelect;
export type CategoryWithCounts = CategoryRow & { postCount: number; publishedCount: number };

// The public payload lists only the categories of published posts (public.ts), so a category
// matters to the site exactly when one of them points at it.
async function isOnTheSite(db: Db, categoryId: string): Promise<boolean> {
  const rows = await db
    .select({ id: blogPosts.id })
    .from(blogPosts)
    .where(and(eq(blogPosts.categoryId, categoryId), eq(blogPosts.status, "publicado")))
    .limit(1);
  return rows.length > 0;
}

// The slug is the identity: saving an existing slug renames that category, and every post keeps
// pointing at it. The site is rebuilt only when a published post uses the category: a new one, or
// one that only drafts use, is not on the site yet.
export async function upsertCategory(
  db: Db,
  input: unknown,
  actor: string,
  now: Date = new Date(),
): Promise<CategoryRow> {
  const doc = parseInput(UpsertCategorySchema, input);
  const names = { namePt: doc.name_pt, nameEn: doc.name_en };
  return db.transaction(async (tx) => {
    const rows = await tx
      .insert(blogCategories)
      .values({ slug: doc.slug, ...names })
      .onConflictDoUpdate({ target: blogCategories.slug, set: names })
      .returning();
    const saved = expectOne(rows, "category upsert");
    // One event for create and rename: the upsert itself does not tell them apart.
    await logAudit(tx, {
      event: "blog.category_saved",
      actor,
      payload: { id: saved.id, slug: saved.slug },
    });
    if (await isOnTheSite(tx, saved.id)) await enqueueSiteRebuild(tx, now);
    return saved;
  });
}

// One grouped query; boringco loaded every published post and counted in JavaScript.
export async function listCategories(db: Db): Promise<CategoryWithCounts[]> {
  return db
    .select({
      ...getTableColumns(blogCategories),
      postCount: sql<number>`count(${blogPosts.id})::int`,
      publishedCount: sql<number>`(count(${blogPosts.id}) filter (where ${blogPosts.status} = 'publicado'))::int`,
    })
    .from(blogCategories)
    .leftJoin(blogPosts, eq(blogPosts.categoryId, blogCategories.id))
    .groupBy(blogCategories.id)
    .orderBy(asc(blogCategories.namePt), asc(blogCategories.slug));
}

// The posts stay, without a category (ON DELETE SET NULL).
export async function deleteCategory(
  db: Db,
  id: string,
  actor: string,
  now: Date = new Date(),
): Promise<void> {
  if (!isUuid(id)) throw new NotFoundError("Categoria não encontrada");
  await db.transaction(async (tx) => {
    // Asked before the delete: afterwards the posts no longer point here.
    const shown = await isOnTheSite(tx, id);
    const rows = await tx
      .delete(blogCategories)
      .where(eq(blogCategories.id, id))
      .returning({ id: blogCategories.id, slug: blogCategories.slug });
    const gone = rows[0];
    if (rows.length !== 1 || !gone) throw new NotFoundError("Categoria não encontrada");
    // The slug goes in because the row is gone: the id alone would name nothing.
    await logAudit(tx, { event: "blog.category_deleted", actor, payload: gone });
    if (shown) await enqueueSiteRebuild(tx, now);
  });
}
