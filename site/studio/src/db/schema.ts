import { sql } from "drizzle-orm";
import {
  bigserial,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const ts = (name: string) => timestamp(name, { withTimezone: true });

export const auditLog = pgTable(
  "audit_log",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    event: text("event").notNull(),
    actor: text("actor"),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [index("audit_log_event_idx").on(t.event, t.createdAt)],
);

export const JOB_STATUS = ["queued", "running", "done", "dead"] as const;

export const jobs = pgTable(
  "jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    kind: text("kind").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    status: text("status", { enum: JOB_STATUS }).notNull().default("queued"),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(3),
    runAfter: ts("run_after").notNull().defaultNow(),
    lockedUntil: ts("locked_until"),
    lastError: text("last_error"),
    // null means "no dedupe". A key is unique only while its job is queued or running, i.e. it
    // reads "an identical job is already queued or running"; once done or dead it can be enqueued
    // again.
    dedupeKey: text("dedupe_key"),
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("jobs_dedupe_active_idx")
      .on(t.dedupeKey)
      .where(sql`${t.status} in ('queued','running')`),
    index("jobs_ready_idx").on(t.status, t.runAfter),
    check("jobs_status_chk", sql`${t.status} in ('queued','running','done','dead')`),
    check("jobs_attempts_chk", sql`${t.attempts} >= 0 and ${t.maxAttempts} >= 1`),
  ],
);

export const workerHeartbeat = pgTable("worker_heartbeat", {
  worker: text("worker").primaryKey(),
  beatAt: ts("beat_at").notNull(),
  lastCycleMs: integer("last_cycle_ms").notNull(),
  lastError: text("last_error"),
});

// Two characters minimum and no leading or trailing hyphen; the caps (60, 120) are boringco's.
export const blogCategories = pgTable(
  "blog_categories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    slug: text("slug").notNull().unique(),
    namePt: text("name_pt").notNull(),
    nameEn: text("name_en").notNull(),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [check("blog_categories_slug_chk", sql`${t.slug} ~ '^[a-z0-9][a-z0-9-]{0,58}[a-z0-9]$'`)],
);

// A table instead of boringco's array in code: there the post stored the author's name, so a
// rename orphaned every post.
export const blogAuthors = pgTable(
  "blog_authors",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    slug: text("slug").notNull().unique(),
    name: text("name").notNull(),
    bioPt: text("bio_pt").notNull().default(""),
    bioEn: text("bio_en").notNull().default(""),
    avatarUrl: text("avatar_url"),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [check("blog_authors_slug_chk", sql`${t.slug} ~ '^[a-z0-9][a-z0-9-]{0,58}[a-z0-9]$'`)],
);

// The AI states (pauta, gerando, lint_falhou) arrive with M2, by migration.
export const POST_STATUS = ["rascunho", "revisao", "aprovado", "publicado", "rejeitado"] as const;
export const POST_LANG = ["pt", "en"] as const;

export const blogPosts = pgTable(
  "blog_posts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    slug: text("slug").notNull(),
    lang: text("lang", { enum: POST_LANG }).notNull(),
    // Translations of one post share this id; a post without translations is a group of one.
    translationGroup: uuid("translation_group").notNull().defaultRandom(),
    title: text("title").notNull(),
    excerpt: text("excerpt"),
    bodyHtml: text("body_html").notNull().default(""),
    categoryId: uuid("category_id").references(() => blogCategories.id, { onDelete: "set null" }),
    // restrict, unlike the category: a deleted author must not silently blank published posts.
    authorId: uuid("author_id").references(() => blogAuthors.id, { onDelete: "restrict" }),
    tags: text("tags").array().notNull().default(sql`'{}'::text[]`),
    status: text("status", { enum: POST_STATUS }).notNull().default("rascunho"),
    featured: boolean("featured").notNull().default(false),
    // Root-relative (/media/...), so the public hostname is never baked into a row.
    coverUrl: text("cover_url"),
    coverAlt: text("cover_alt"),
    feedback: text("feedback"),
    metaTitle: text("meta_title"),
    metaDescription: text("meta_description"),
    scheduledFor: ts("scheduled_for"),
    // Date of the first publication: unpublishing keeps it, so the date and the URL stay stable.
    publishedAt: ts("published_at"),
    createdBy: text("created_by"),
    updatedBy: text("updated_by"),
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("blog_posts_lang_slug_idx").on(t.lang, t.slug),
    uniqueIndex("blog_posts_translation_lang_idx").on(t.translationGroup, t.lang),
    index("blog_posts_published_idx").on(t.status, t.publishedAt.desc().nullsFirst()),
    index("blog_posts_category_idx").on(t.categoryId),
    index("blog_posts_tags_idx").using("gin", t.tags),
    check("blog_posts_slug_chk", sql`${t.slug} ~ '^[a-z0-9][a-z0-9-]{0,118}[a-z0-9]$'`),
    check("blog_posts_lang_chk", sql`${t.lang} in ('pt','en')`),
    check(
      "blog_posts_status_chk",
      sql`${t.status} in ('rascunho','revisao','aprovado','publicado','rejeitado')`,
    ),
    // A published post always has its date: the public listing sorts by it.
    check(
      "blog_posts_published_chk",
      sql`${t.status} <> 'publicado' or ${t.publishedAt} is not null`,
    ),
  ],
);
