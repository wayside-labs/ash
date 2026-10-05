import { notFound } from "next/navigation";
import { listAuthors } from "@/blog/authors";
import { listCategories } from "@/blog/categories";
import { type EditorPost, PostEditor } from "@/blog/components/editor/post-editor";
import { zoneLabel } from "@/blog/lib/format-date";
import { getPost, getTranslationSibling } from "@/blog/posts";
import { db } from "@/db/client";
import { requireAdmin } from "@/lib/admin";
import { env } from "@/lib/env";

export const dynamic = "force-dynamic";
export const metadata = { title: "Editar post · Ash Studio" };

export default async function EditPostPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const { id } = await params;
  const database = db();
  // getPost answers null for an id that is not a uuid, so "novo-post" in the URL is a 404 and
  // not a cast error.
  const row = await getPost(database, id);
  if (!row) notFound();

  const [categories, authors, sibling] = await Promise.all([
    listCategories(database),
    listAuthors(database),
    getTranslationSibling(database, row),
  ]);
  const tz = env().PUBLISH_TZ;

  // Plain values only: a Date does not cross to a client component, and the editor has no use
  // for the columns left out.
  const post: EditorPost = {
    id: row.id,
    slug: row.slug,
    lang: row.lang,
    status: row.status,
    title: row.title,
    bodyHtml: row.bodyHtml,
    excerpt: row.excerpt,
    categoryId: row.categoryId,
    authorId: row.authorId,
    tags: row.tags,
    featured: row.featured,
    metaTitle: row.metaTitle,
    metaDescription: row.metaDescription,
    coverUrl: row.coverUrl,
    coverAlt: row.coverAlt,
    feedback: row.feedback,
    scheduledFor: row.scheduledFor?.toISOString() ?? null,
    updatedAt: row.updatedAt.toISOString(),
  };

  return (
    // The key is the post: going from one post to its translation is a new editor, with its own
    // text and its own token, not the old one handed new props.
    <PostEditor
      key={post.id}
      post={post}
      categories={categories.map(({ id: categoryId, namePt }) => ({ id: categoryId, namePt }))}
      authors={authors.map(({ id: authorId, name }) => ({ id: authorId, name }))}
      translation={sibling ? { id: sibling.id, title: sibling.title, lang: sibling.lang } : null}
      tz={tz}
      zone={zoneLabel(tz)}
    />
  );
}
