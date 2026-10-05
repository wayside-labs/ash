import { eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { blogAuthors, blogCategories, blogPosts } from "@/db/schema";
import { expectOne } from "@/lib/expect-rows";

export const ACTOR = "admin@example.com";

export async function seedAuthor(db: Db, slug = "autora-teste"): Promise<string> {
  const rows = await db
    .insert(blogAuthors)
    .values({ slug, name: "Autora Teste" })
    .returning({ id: blogAuthors.id });
  return expectOne(rows, "seed author").id;
}

export async function seedCategory(db: Db, slug = "categoria-teste"): Promise<string> {
  const rows = await db
    .insert(blogCategories)
    .values({ slug, namePt: "Categoria", nameEn: "Category" })
    .returning({ id: blogCategories.id });
  return expectOne(rows, "seed category").id;
}

export function postInput(authorId: string, overrides: Record<string, unknown> = {}) {
  return {
    lang: "pt",
    title: "Um post de teste qualquer",
    body_html: "<h2>Uma seção</h2><p>corpo</p>",
    author_id: authorId,
    ...overrides,
  };
}

// What an editor that has just opened the post would send: the document plus the token of the
// version it read. For a post that does not exist the token is a valid instant that matches
// nothing, so the test reaches the lookup instead of stopping at the schema.
export async function editInput(
  db: Db,
  id: string,
  authorId: string,
  overrides: Record<string, unknown> = {},
) {
  const [row] = await db
    .select({ updatedAt: blogPosts.updatedAt })
    .from(blogPosts)
    .where(eq(blogPosts.id, id));
  return postInput(authorId, {
    if_updated_at: (row?.updatedAt ?? new Date(0)).toISOString(),
    ...overrides,
  });
}
