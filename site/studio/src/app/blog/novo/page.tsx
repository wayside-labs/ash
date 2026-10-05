import Link from "next/link";
import { notFound } from "next/navigation";
import { listAuthors } from "@/blog/authors";
import { NewPostForm, type TranslationSource } from "@/blog/components/new-post-form";
import { LANG_LABEL, otherLang } from "@/blog/lib/post-status";
import { getPost, getTranslationSibling } from "@/blog/posts";
import { db } from "@/db/client";
import { requireAdmin } from "@/lib/admin";
import { Notice } from "@/ui/notice";

export const dynamic = "force-dynamic";
export const metadata = { title: "Novo post · Ash Studio" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function NewPostPage({ searchParams }: { searchParams: SearchParams }) {
  await requireAdmin();
  const database = db();
  const sourceId = (await searchParams).traducao_de;

  let source: TranslationSource | null = null;
  if (sourceId !== undefined) {
    // A repeated parameter or an id that names nothing: there is no post to translate.
    const post = typeof sourceId === "string" ? await getPost(database, sourceId) : null;
    if (!post) notFound();
    // Said before the form is filled in, not after: createTranslation would refuse it anyway.
    const existing = await getTranslationSibling(database, post);
    if (existing) {
      return (
        <main className="mx-auto max-w-2xl px-4 py-8 sm:px-6">
          <p className="text-sm">
            <Link href="/blog" className="text-muted hover:text-ink">
              ← Blog
            </Link>
          </p>
          <h1 className="mt-2 text-2xl font-semibold">Este post já tem tradução</h1>
          <div className="surface-card mt-6 space-y-3 p-6 text-sm text-muted">
            <p>
              <span className="text-ink">{post.title}</span> já tem a versão em{" "}
              {LANG_LABEL[existing.lang].toLowerCase()}:
            </p>
            <p className="text-ink">{existing.title}</p>
            <p>
              <Link href={`/blog/${existing.id}`} className="text-accent underline">
                Abrir a tradução no editor
              </Link>
            </p>
          </div>
        </main>
      );
    }
    source = {
      id: post.id,
      title: post.title,
      lang: post.lang,
      authorId: post.authorId,
      categoryId: post.categoryId,
    };
  }

  const authors = (await listAuthors(database)).map(({ id, name }) => ({ id, name }));

  return (
    <main className="mx-auto max-w-2xl px-4 py-8 sm:px-6">
      <p className="text-sm">
        <Link href="/blog" className="text-muted hover:text-ink">
          ← Blog
        </Link>
      </p>
      <h1 className="mt-2 text-2xl font-semibold">
        {source ? `Nova tradução para ${LANG_LABEL[otherLang(source.lang)].toLowerCase()}` : "Novo post"}
      </h1>
      <p className="mt-1 text-sm text-muted">
        {source
          ? "A tradução é um post à parte, ligado ao original: tem título, texto e endereço próprios, e passa pela revisão como qualquer outro."
          : "Três respostas e o rascunho existe. O texto, a capa, a categoria e o resto ficam no editor, que abre em seguida."}
      </p>

      <div className="mt-6">
        {authors.length === 0 ? (
          <Notice tone="warning">
            Ainda não há nenhum autor, e todo post precisa de um.{" "}
            <Link href="/blog/autores" className="underline">
              Cadastre o primeiro autor
            </Link>{" "}
            e volte aqui.
          </Notice>
        ) : (
          <NewPostForm authors={authors} source={source} />
        )}
      </div>
    </main>
  );
}
