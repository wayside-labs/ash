CREATE TABLE "blog_authors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"bio_pt" text DEFAULT '' NOT NULL,
	"bio_en" text DEFAULT '' NOT NULL,
	"avatar_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "blog_authors_slug_unique" UNIQUE("slug"),
	CONSTRAINT "blog_authors_slug_chk" CHECK ("blog_authors"."slug" ~ '^[a-z0-9][a-z0-9-]{0,58}[a-z0-9]$')
);
--> statement-breakpoint
CREATE TABLE "blog_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name_pt" text NOT NULL,
	"name_en" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "blog_categories_slug_unique" UNIQUE("slug"),
	CONSTRAINT "blog_categories_slug_chk" CHECK ("blog_categories"."slug" ~ '^[a-z0-9][a-z0-9-]{0,58}[a-z0-9]$')
);
--> statement-breakpoint
CREATE TABLE "blog_posts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"lang" text NOT NULL,
	"translation_group" uuid DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"excerpt" text,
	"body_html" text DEFAULT '' NOT NULL,
	"category_id" uuid,
	"author_id" uuid,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"status" text DEFAULT 'rascunho' NOT NULL,
	"featured" boolean DEFAULT false NOT NULL,
	"cover_url" text,
	"cover_alt" text,
	"feedback" text,
	"meta_title" text,
	"meta_description" text,
	"scheduled_for" timestamp with time zone,
	"published_at" timestamp with time zone,
	"created_by" text,
	"updated_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "blog_posts_slug_chk" CHECK ("blog_posts"."slug" ~ '^[a-z0-9][a-z0-9-]{0,118}[a-z0-9]$'),
	CONSTRAINT "blog_posts_lang_chk" CHECK ("blog_posts"."lang" in ('pt','en')),
	CONSTRAINT "blog_posts_status_chk" CHECK ("blog_posts"."status" in ('rascunho','revisao','aprovado','publicado','rejeitado')),
	CONSTRAINT "blog_posts_published_chk" CHECK ("blog_posts"."status" <> 'publicado' or "blog_posts"."published_at" is not null)
);
--> statement-breakpoint
ALTER TABLE "blog_posts" ADD CONSTRAINT "blog_posts_category_id_blog_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."blog_categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blog_posts" ADD CONSTRAINT "blog_posts_author_id_blog_authors_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."blog_authors"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "blog_posts_lang_slug_idx" ON "blog_posts" USING btree ("lang","slug");--> statement-breakpoint
CREATE UNIQUE INDEX "blog_posts_translation_lang_idx" ON "blog_posts" USING btree ("translation_group","lang");--> statement-breakpoint
CREATE INDEX "blog_posts_published_idx" ON "blog_posts" USING btree ("status","published_at" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "blog_posts_category_idx" ON "blog_posts" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "blog_posts_tags_idx" ON "blog_posts" USING gin ("tags");