import { and, asc, desc, eq, getTableColumns, isNotNull, like, ne, or, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { type POST_LANG, POST_STATUS, blogPosts } from "@/db/schema";
import { logAudit } from "@/lib/audit";
import { expectOne } from "@/lib/expect-rows";
import {
  BlogError,
  FK_VIOLATION,
  NotFoundError,
  StalePostError,
  UNIQUE_VIOLATION,
  ValidationError,
  isUuid,
  parseInput,
  pgError,
} from "./errors";
import { hasBodyContent } from "./lib/body-content";
import { postSlug } from "./lib/post-slug";
import { BodyTooLargeError, sanitizePostHtml } from "./lib/sanitize";
import { validateShortcodes } from "./lib/shortcodes";
import { enqueueSiteRebuild } from "./rebuild";
import { UpdatePostSchema, type UpsertPostInput, UpsertPostSchema } from "./schemas";

export type PostStatus = (typeof POST_STATUS)[number];
export type PostLang = (typeof POST_LANG)[number];
export type PostRow = typeof blogPosts.$inferSelect;
export type PostListItem = Omit<PostRow, "bodyHtml">;
// updatedAt (ISO) is the token the editor sends back as if_updated_at on its next save.
export type CreatedPost = { id: string; slug: string; updatedAt: string };
export type UpdatedPost = { id: string; slug: string; status: PostStatus; updatedAt: string };

export class TranslationExistsError extends BlogError {
  constructor(lang: string) {
    super(`Este post já tem versão em "${lang}".`);
  }
}

// Every attempt lost the slug to a concurrent save of the same title. Nothing was written, and
// saving again starts from a fresh lookup.
export class SlugBusyError extends BlogError {
  constructor() {
    super("Outro post com o mesmo título foi salvo ao mesmo tempo. Tente de novo.");
  }
}

// Lives in errors.ts, because status.ts throws it too; re-exported for the code that already
// takes it from here.
export { StalePostError };

// Sanitize, validate shortcodes, in this order: the shortcode check expects sanitized HTML. What
// comes out is what gets stored. withToc is not here on purpose: heading ids are written when
// serving.
function prepare(doc: UpsertPostInput) {

  let bodyHtml: string;
  try {
    bodyHtml = sanitizePostHtml(doc.body_html);
  } catch (err) {
    if (err instanceof BodyTooLargeError) throw new ValidationError("Corpo grande demais");
    throw err;
  }

  const shortcodes = validateShortcodes(bodyHtml);
  if (shortcodes.unknown.length > 0) {
    throw new ValidationError(`Shortcodes desconhecidos: ${shortcodes.unknown.join(", ")}`);
  }
  if (shortcodes.inline.length > 0) {
    throw new ValidationError(
      `Shortcode precisa ficar sozinho, fora de parágrafo: ${shortcodes.inline.join(", ")}`,
    );
  }

  return {
    lang: doc.lang,
    columns: {
      title: doc.title,
      excerpt: doc.excerpt,
      bodyHtml,
      categoryId: doc.category_id,
      authorId: doc.author_id,
      tags: doc.tags,
      featured: doc.featured,
      metaTitle: doc.meta_title,
      metaDescription: doc.meta_description,
      coverUrl: doc.cover_url,
      coverAlt: doc.cover_alt,
    },
  };
}

type PostColumns = ReturnType<typeof prepare>["columns"];

// An author or category id that points at nothing is the form's stale select, not an outage.
function readable(err: unknown): unknown {
  const pg = pgError(err);
  if (pg?.code !== FK_VIOLATION) return err;
  if (pg.constraint === "blog_posts_author_id_blog_authors_id_fk") {
    return new ValidationError("Autor não encontrado");
  }
  if (pg.constraint === "blog_posts_category_id_blog_categories_id_fk") {
    return new ValidationError("Categoria não encontrada");
  }
  return err;
}

const SLUG_MAX = 120;
// Room for "-" and up to five digits, so a suffixed slug still passes blog_posts_slug_chk.
const SUFFIX_ROOM = 6;

async function freeSlug(db: Db, lang: PostLang, base: string): Promise<string> {
  const stem = base.slice(0, SLUG_MAX - SUFFIX_ROOM).replace(/-+$/, "");
  // Slugs are [a-z0-9-], so the stem carries no LIKE wildcard.
  const rows = await db
    .select({ slug: blogPosts.slug })
    .from(blogPosts)
    .where(
      and(eq(blogPosts.lang, lang), or(eq(blogPosts.slug, base), like(blogPosts.slug, `${stem}-%`))),
    );
  const taken = new Set(rows.map((r) => r.slug));
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) {
    const candidate = `${stem}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}

const SLUG_ATTEMPTS = 5;

// The lookup and the insert are two statements, so two saves of the same title can pick the same
// slug; the unique index decides, and the loser looks again.
//
// One transaction per attempt, never one around the loop: a 23505 aborts the transaction it
// happens in, so a retry inside the same one would fail with 25P02 and the loop could not
// succeed. The attempt's transaction is what ties the audit row to the insert: a lost attempt
// rolls back whole and leaves no trace.
async function insertPost(
  db: Db,
  lang: PostLang,
  columns: PostColumns,
  actor: string,
  translationGroup?: string,
): Promise<CreatedPost> {
  const base = postSlug(columns.title);
  for (let attempt = 0; attempt < SLUG_ATTEMPTS; attempt++) {
    const slug = await freeSlug(db, lang, base);
    try {
      return await db.transaction(async (tx) => {
        const rows = await tx
          .insert(blogPosts)
          .values({
            ...columns,
            lang,
            slug,
            status: "rascunho",
            createdBy: actor,
            updatedBy: actor,
            ...(translationGroup ? { translationGroup } : {}),
          })
          .returning({
            id: blogPosts.id,
            slug: blogPosts.slug,
            updatedAt: blogPosts.updatedAt,
          });
        const created = expectOne(rows, "post insert");
        await logAudit(tx, {
          event: "blog.post_created",
          actor,
          payload: { postId: created.id, slug: created.slug, lang },
        });
        return { ...created, updatedAt: created.updatedAt.toISOString() };
      });
    } catch (err) {
      const pg = pgError(err);
      if (pg?.code === UNIQUE_VIOLATION && pg.constraint === "blog_posts_lang_slug_idx") continue;
      if (pg?.code === UNIQUE_VIOLATION && pg.constraint === "blog_posts_translation_lang_idx") {
        throw new TranslationExistsError(lang);
      }
      throw readable(err);
    }
  }
  throw new SlugBusyError();
}

export async function createPost(db: Db, input: unknown, actor: string): Promise<CreatedPost> {
  const { lang, columns } = prepare(parseInput(UpsertPostSchema, input));
  return insertPost(db, lang, columns, actor);
}

// The new post is a document of its own (the translated title gives the slug); what links it to
// the source is only the translation group.
export async function createTranslation(
  db: Db,
  sourceId: string,
  input: unknown,
  actor: string,
): Promise<CreatedPost> {
  if (!isUuid(sourceId)) throw new NotFoundError("Post não encontrado");
  const { lang, columns } = prepare(parseInput(UpsertPostSchema, input));
  const [source] = await db
    .select({ lang: blogPosts.lang, translationGroup: blogPosts.translationGroup })
    .from(blogPosts)
    .where(eq(blogPosts.id, sourceId));
  if (!source) throw new NotFoundError("Post não encontrado");
  if (source.lang === lang) throw new TranslationExistsError(lang);
  return insertPost(db, lang, columns, actor, source.translationGroup);
}

// The slug and the language stay as they were born: both are in the public URL.
//
// The input carries `if_updated_at`, the updated_at of the version the editor was working on, and
// the save is refused (StalePostError) when the row has moved since. The comparison is between
// two millisecond instants, on purpose. Postgres keeps microseconds and a JS Date does not: the
// token is always a Date that came from this column (a page's read, or the updatedAt of a result
// here or in status.ts), so it is the stored value truncated to the millisecond, and the row read
// below goes through the same truncation. Comparing in SQL against the raw column would refuse
// every save over a row whose updated_at has microseconds, such as one fresh from defaultNow().
// What makes milliseconds enough is that every write here and in status.ts moves updated_at by
// at least one of them, even when the clock did not move.
export async function updatePost(
  db: Db,
  id: string,
  input: unknown,
  actor: string,
  now: Date = new Date(),
): Promise<UpdatedPost> {
  if (!isUuid(id)) throw new NotFoundError("Post não encontrado");
  const doc = parseInput(UpdatePostSchema, input);
  const { lang, columns } = prepare(doc);
  const expected = Date.parse(doc.if_updated_at);
  try {
    return await db.transaction(async (tx) => {
      // The lock is what makes the check hold: of two saves with the same token, the second
      // waits here and then reads what the first one committed.
      const [current] = await tx
        .select({ status: blogPosts.status, lang: blogPosts.lang, updatedAt: blogPosts.updatedAt })
        .from(blogPosts)
        .where(eq(blogPosts.id, id))
        .for("update");
      if (!current) throw new NotFoundError("Post não encontrado");
      if (current.updatedAt.getTime() !== expected) throw new StalePostError();
      if (current.lang !== lang) throw new ValidationError("O idioma de um post não muda.");
      // approve demands a body; an edit afterwards must not undo that.
      const live = current.status === "aprovado" || current.status === "publicado";
      if (live && !hasBodyContent(columns.bodyHtml)) {
        throw new ValidationError("Post aprovado ou publicado não pode ficar sem corpo.");
      }

      // Never the same millisecond twice: a save must change the token it was accepted with.
      const updatedAt = new Date(Math.max(now.getTime(), current.updatedAt.getTime() + 1));
      const rows = await tx
        .update(blogPosts)
        .set({ ...columns, updatedBy: actor, updatedAt })
        .where(eq(blogPosts.id, id))
        .returning({ id: blogPosts.id, slug: blogPosts.slug, status: blogPosts.status });
      const updated = expectOne(rows, "post update");
      // The status is in the payload because an edit means something else at each one: a
      // published post changed on the site, a draft did not.
      await logAudit(tx, {
        event: "blog.post_updated",
        actor,
        payload: { postId: updated.id, slug: updated.slug, lang, status: updated.status },
      });
      if (updated.status === "publicado") await enqueueSiteRebuild(tx, now);
      return { ...updated, updatedAt: updatedAt.toISOString() };
    });
  } catch (err) {
    throw readable(err);
  }
}

export async function getPost(db: Db, id: string): Promise<PostRow | null> {
  if (!isUuid(id)) return null;
  const [row] = await db.select().from(blogPosts).where(eq(blogPosts.id, id));
  return row ?? null;
}

const { bodyHtml: _body, ...LIST_COLUMNS } = getTableColumns(blogPosts);

// No pagination yet: a list shows the newest LIST_LIMIT_DEFAULT and the counts say how many
// there are in all. The cap is what keeps a query string from asking for the whole table.
export const LIST_LIMIT_DEFAULT = 200;
export const LIST_LIMIT_MAX = 500;

function listLimit(limit: number | undefined): number {
  if (limit === undefined) return LIST_LIMIT_DEFAULT;
  if (!Number.isInteger(limit) || limit < 1 || limit > LIST_LIMIT_MAX) {
    throw new ValidationError(`Limite da lista: um número inteiro de 1 a ${LIST_LIMIT_MAX}.`);
  }
  return limit;
}

// Without the body: a list of posts must not carry up to 300 kB per row.
export async function listPosts(
  db: Db,
  filter: { status?: PostStatus; lang?: PostLang; limit?: number } = {},
): Promise<PostListItem[]> {
  const limit = listLimit(filter.limit);
  return db
    .select(LIST_COLUMNS)
    .from(blogPosts)
    .where(
      and(
        filter.status ? eq(blogPosts.status, filter.status) : undefined,
        filter.lang ? eq(blogPosts.lang, filter.lang) : undefined,
      ),
    )
    .orderBy(desc(blogPosts.createdAt), desc(blogPosts.id))
    .limit(limit);
}

// The posts publishDue is going to pick up: approved, with a date. Soonest first, which is the
// order they will go up in, and one that already passed (refused for an empty body) comes on top.
export async function listScheduled(
  db: Db,
  filter: { lang?: PostLang; limit?: number } = {},
): Promise<PostListItem[]> {
  const limit = listLimit(filter.limit);
  return db
    .select(LIST_COLUMNS)
    .from(blogPosts)
    .where(
      and(
        eq(blogPosts.status, "aprovado"),
        isNotNull(blogPosts.scheduledFor),
        filter.lang ? eq(blogPosts.lang, filter.lang) : undefined,
      ),
    )
    .orderBy(asc(blogPosts.scheduledFor), asc(blogPosts.id))
    .limit(limit);
}

// How many posts listScheduled would list, and how many of those are past their date (the ones
// publishDue refused for an empty body, or has not reached yet). A count, for the screens that
// only show the number.
export async function countScheduled(
  db: Db,
  now: Date = new Date(),
): Promise<{ total: number; overdue: number }> {
  const [row] = await db
    .select({
      total: sql<number>`count(*)::int`,
      // ISO + cast: postgres-js cannot bind a raw Date inside a sql`` template (jobs/queue.ts).
      overdue: sql<number>`(count(*) filter (where ${blogPosts.scheduledFor} <= ${now.toISOString()}::timestamptz))::int`,
    })
    .from(blogPosts)
    .where(and(eq(blogPosts.status, "aprovado"), isNotNull(blogPosts.scheduledFor)));
  return { total: row?.total ?? 0, overdue: row?.overdue ?? 0 };
}

// The translation groups that already hold both languages. (group, lang) is unique, so more than
// one row in a group is more than one language. One grouped query over the whole table: a list
// asks this to know which rows can still get a translation, and the sibling of a row may be
// outside the list's filter or limit.
export async function listTranslatedGroups(db: Db): Promise<Set<string>> {
  const rows = await db
    .select({ group: blogPosts.translationGroup })
    .from(blogPosts)
    .groupBy(blogPosts.translationGroup)
    .having(sql`count(*) > 1`);
  return new Set(rows.map((row) => row.group));
}

export type TranslationSibling = { id: string; title: string; lang: PostLang; status: PostStatus };

// The other-language version of a post, when it exists.
export async function getTranslationSibling(
  db: Db,
  post: { id: string; translationGroup: string },
): Promise<TranslationSibling | null> {
  const [row] = await db
    .select({
      id: blogPosts.id,
      title: blogPosts.title,
      lang: blogPosts.lang,
      status: blogPosts.status,
    })
    .from(blogPosts)
    .where(and(eq(blogPosts.translationGroup, post.translationGroup), ne(blogPosts.id, post.id)))
    .limit(1);
  return row ?? null;
}

// Every state is in the answer, with zero for the ones no post is in: the tabs show a number for
// each. One grouped query, not capped by the list limit.
export async function countPostsByStatus(
  db: Db,
  filter: { lang?: PostLang } = {},
): Promise<Record<PostStatus, number>> {
  const rows = await db
    .select({ status: blogPosts.status, count: sql<number>`count(*)::int` })
    .from(blogPosts)
    .where(filter.lang ? eq(blogPosts.lang, filter.lang) : undefined)
    .groupBy(blogPosts.status);
  const counts = Object.fromEntries(POST_STATUS.map((status) => [status, 0])) as Record<
    PostStatus,
    number
  >;
  for (const row of rows) counts[row.status] = row.count;
  return counts;
}
