// An upsert carries the full document: a field left out is a field cleared, never "keep what is
// there". Optional text comes out as null when empty or blank, so the database has one way of
// saying "empty"; the exceptions are the columns that are NOT NULL (body_html, bios), which come
// out as "".
import { z } from "zod";
import { MAX_BODY_HTML_LENGTH } from "./lib/body-content";
import { isMediaPath } from "./lib/image-rules";

// Kept apart from @/db/schema so a form can import these without pulling Drizzle into the
// client bundle; schemas.test.ts holds the two lists equal.
export const POST_LANGS = ["pt", "en"] as const;

// Same pattern as blog_categories_slug_chk and blog_authors_slug_chk.
const SHORT_SLUG_RE = /^[a-z0-9][a-z0-9-]{0,58}[a-z0-9]$/;
const shortSlug = z.string().regex(SHORT_SLUG_RE, "Slug inválido");

// Root-relative /media/... only: an absolute URL would bake a hostname into the row.
const mediaPath = (message: string) => z.string().max(300, message).refine(isMediaPath, message);

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((value) => value || null);

// Tags end up in URLs on the site, so the alphabet is closed: letters (accented ones included),
// digits, space and hyphen. NFC first, or the same word typed with a combining mark would be a
// different tag. It must start with a letter or digit: a tag of only hyphens would slugify to
// an empty URL segment.
const TAG_RE = /^[\p{L}\p{N}][\p{L}\p{N} -]*$/u;
const tag = z
  .string()
  .normalize("NFC")
  .trim()
  .toLowerCase()
  .min(1)
  .max(40)
  .regex(TAG_RE, "Tag só com letras, números, espaço e hífen");

// The slug is not here: it is derived from the title on create and never changes with an edit.
export const UpsertPostSchema = z.object({
  lang: z.enum(POST_LANGS),
  title: z.string().trim().min(8, "Título muito curto").max(160),
  excerpt: optionalText(400),
  // No minimum: a draft may be saved empty. approve is what demands a body (hasBodyContent).
  body_html: z.string().trim().max(MAX_BODY_HTML_LENGTH, "Corpo grande demais").default(""),
  category_id: z.uuid().nullable().default(null),
  author_id: z.uuid(),
  // Deduplicated after normalising, and the limit of 12 counts what is left.
  tags: z
    .array(tag)
    .max(100)
    .default([])
    .transform((tags) => [...new Set(tags)])
    .pipe(z.array(z.string()).max(12, "No máximo 12 tags")),
  featured: z.boolean().default(false),
  meta_title: optionalText(70),
  meta_description: optionalText(170),
  cover_url: mediaPath("Capa inválida").nullable().default(null),
  cover_alt: optionalText(160),
});

export type UpsertPostInput = z.infer<typeof UpsertPostSchema>;

// An update is the same full document plus the version it was written over: the updated_at the
// editor got when it opened the post (or from its last save or state change). Only the Z form, as
// Date.prototype.toISOString writes it. Not part of create, where there is no version yet.
export const UpdatePostSchema = UpsertPostSchema.extend({
  if_updated_at: z.iso.datetime(),
});

export type UpdatePostInput = z.infer<typeof UpdatePostSchema>;

export const UpsertCategorySchema = z.object({
  slug: shortSlug,
  name_pt: z.string().trim().min(2).max(60),
  name_en: z.string().trim().min(2).max(60),
});

export type UpsertCategoryInput = z.infer<typeof UpsertCategorySchema>;

export const UpsertAuthorSchema = z.object({
  slug: shortSlug,
  name: z.string().trim().min(1).max(80),
  bio_pt: z.string().trim().max(600).default(""),
  bio_en: z.string().trim().max(600).default(""),
  avatar_url: mediaPath("Avatar inválido").nullable().default(null),
});

export type UpsertAuthorInput = z.infer<typeof UpsertAuthorSchema>;

// reject is not here: it needs feedback and has RejectPostSchema.
export const POST_ACTIONS = [
  "submit",
  "approve",
  "reopen",
  "schedule",
  "unschedule",
  "publish",
  "unpublish",
] as const;

export type PostAction = (typeof POST_ACTIONS)[number];

// Twelve months: catches the typo that turns 2027 into 2077.
const MAX_AHEAD_MS = 365 * 24 * 3_600_000;

// The updated_at of the version the screen was showing when the button was clicked, in the same
// form as UpdatePostSchema's. With it, the transition is refused (StalePostError) when the post
// was saved or moved since: a reviewer does not approve, and nobody publishes, text that changed
// after their screen rendered. Every screen of the panel sends it. It is optional only for
// callers with no screen behind them (a script, a test walking the state machine), which then
// act on the row as it is.
const transitionToken = z.iso.datetime().optional();

export const SetPostStatusSchema = z
  .object({
    id: z.uuid(),
    action: z.enum(POST_ACTIONS),
    // Accepts only the Z form: the client converts the datetime-local value with localToIso.
    scheduled_for: z.iso.datetime().optional(),
    if_updated_at: transitionToken,
  })
  .superRefine((v, ctx) => {
    if (v.action !== "schedule") return;
    if (!v.scheduled_for) {
      ctx.addIssue({ code: "custom", path: ["scheduled_for"], message: "Escolha uma data." });
      return;
    }
    const when = new Date(v.scheduled_for).getTime();
    const now = Date.now();
    if (when <= now) {
      ctx.addIssue({
        code: "custom",
        path: ["scheduled_for"],
        // The name of the button on the screens.
        message: 'Data precisa ser no futuro. Para agora, use "Publicar agora".',
      });
    } else if (when > now + MAX_AHEAD_MS) {
      ctx.addIssue({
        code: "custom",
        path: ["scheduled_for"],
        message: "Data muito distante (máx. 12 meses).",
      });
    }
  });

export type SetPostStatusInput = z.infer<typeof SetPostStatusSchema>;

export const RejectPostSchema = z.object({
  id: z.uuid(),
  feedback: z.string().trim().min(5, "Explique o que precisa mudar").max(2000),
  if_updated_at: transitionToken,
});

export type RejectPostInput = z.infer<typeof RejectPostSchema>;
