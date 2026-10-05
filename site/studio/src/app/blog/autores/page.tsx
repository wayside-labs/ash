import { listAuthors } from "@/blog/authors";
import { AuthorManager } from "@/blog/components/taxonomy-authors";
import { db } from "@/db/client";
import { requireAdmin } from "@/lib/admin";

export const dynamic = "force-dynamic";
export const metadata = { title: "Autores · Ash Studio" };

export default async function AuthorsPage() {
  await requireAdmin();
  // Plain fields only: the row's Date does not cross to a client component.
  const authors = (await listAuthors(db())).map((author) => ({
    id: author.id,
    slug: author.slug,
    name: author.name,
    bioPt: author.bioPt,
    bioEn: author.bioEn,
    avatarUrl: author.avatarUrl,
    postCount: author.postCount,
    publishedCount: author.publishedCount,
  }));

  return (
    <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
      <h1 className="text-2xl font-semibold">Autores</h1>
      <p className="mt-1 max-w-prose text-sm text-muted">
        Quem assina os posts. Cada autor tem um nome, uma bio por idioma e um endereço fixo. Um
        autor com posts não pode ser apagado: troque antes o autor desses posts.
      </p>
      <div className="mt-6">
        <AuthorManager authors={authors} />
      </div>
    </main>
  );
}
