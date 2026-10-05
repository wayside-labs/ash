import { listCategories } from "@/blog/categories";
import { CategoryManager } from "@/blog/components/taxonomy-categories";
import { db } from "@/db/client";
import { requireAdmin } from "@/lib/admin";

export const dynamic = "force-dynamic";
export const metadata = { title: "Categorias · Ash Studio" };

export default async function CategoriesPage() {
  await requireAdmin();
  // Plain fields only: the row's Date does not cross to a client component.
  const categories = (await listCategories(db())).map((category) => ({
    id: category.id,
    slug: category.slug,
    namePt: category.namePt,
    nameEn: category.nameEn,
    postCount: category.postCount,
    publishedCount: category.publishedCount,
  }));

  return (
    <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
      <h1 className="text-2xl font-semibold">Categorias</h1>
      <p className="mt-1 max-w-prose text-sm text-muted">
        Agrupam os posts no site. Cada uma tem um nome por idioma e um endereço fixo. Mudar o nome
        de uma categoria que já aparece no site reconstrói o site.
      </p>
      <div className="mt-6">
        <CategoryManager categories={categories} />
      </div>
    </main>
  );
}
