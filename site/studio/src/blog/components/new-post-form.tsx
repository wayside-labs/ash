"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import { createPost, createTranslation } from "@/blog/actions/posts";
import { LANG_LABEL, type PostLang, otherLang } from "@/blog/lib/post-status";
import { POST_LANGS } from "@/blog/schemas";
import { Button, buttonClass } from "@/ui/button";
import { SelectField, TextField } from "@/ui/field";
import { Notice } from "@/ui/notice";
import { useAction } from "@/ui/use-action";

export type TranslationSource = {
  id: string;
  title: string;
  lang: PostLang;
  authorId: string | null;
  categoryId: string | null;
};

// Same floor as UpsertPostSchema; the server checks again.
const MIN_TITLE = 8;

// The post is born here, before the editor opens (decision 2 of the M1b plan): title, language
// and author are enough for a draft with an address, and from then on every image has a post to
// belong to.
export function NewPostForm({
  authors,
  source,
}: {
  authors: readonly { id: string; name: string }[];
  // The post being translated, when the page came with ?traducao_de=<id>.
  source: TranslationSource | null;
}) {
  const router = useRouter();
  const { pending, error, run } = useAction();
  const [title, setTitle] = useState("");
  const [lang, setLang] = useState<PostLang>(source ? otherLang(source.lang) : "pt");
  const [authorId, setAuthorId] = useState(() => {
    const inherited = authors.find((author) => author.id === source?.authorId);
    return inherited?.id ?? (authors.length === 1 ? (authors[0]?.id ?? "") : "");
  });
  const [problems, setProblems] = useState<{ title?: string; author?: string }>({});

  function submit(event: FormEvent) {
    event.preventDefault();
    const found: { title?: string; author?: string } = {};
    if (title.trim().length < MIN_TITLE) {
      found.title = `O título precisa de pelo menos ${MIN_TITLE} caracteres.`;
    }
    if (!authorId) found.author = "Escolha quem assina o post.";
    setProblems(found);
    if (found.title || found.author) return;

    // The full document, as every upsert: what the editor fills in later starts empty. A
    // translation keeps the category of the original, which has a name in both languages.
    const document = {
      lang,
      title: title.trim(),
      excerpt: null,
      body_html: "",
      category_id: source?.categoryId ?? null,
      author_id: authorId,
      tags: [],
      featured: false,
      meta_title: null,
      meta_description: null,
      cover_url: null,
      cover_alt: null,
    };
    run(
      () => (source ? createTranslation(source.id, document) : createPost(document)),
      (created) => router.push(`/blog/${created.id}`),
      // "leave": the button stays dead while the editor loads. There is no way to delete a post,
      // so a second click here would leave a second draft behind for good.
      { after: "leave" },
    );
  }

  return (
    <form onSubmit={submit} noValidate className="surface-card space-y-5 p-6">
      {source ? (
        <div className="rounded-md border border-line bg-elevated px-3 py-2 text-sm">
          <p className="text-xs text-muted">Original, em {LANG_LABEL[source.lang].toLowerCase()}</p>
          <p className="mt-0.5 text-ink">{source.title}</p>
        </div>
      ) : null}
      <TextField
        label={source ? `Título em ${LANG_LABEL[lang].toLowerCase()}` : "Título"}
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        maxLength={160}
        autoFocus
        hint="O endereço do post no site sai do título e não muda depois. O título em si pode ser editado."
        error={problems.title}
        readOnly={pending}
      />
      <SelectField
        label="Idioma"
        value={lang}
        onChange={(event) => setLang(event.target.value as PostLang)}
        // A translation is, by definition, in the other language.
        disabled={pending || source !== null}
        hint={
          source
            ? "Fixo: a tradução é sempre no outro idioma."
            : "O idioma não muda depois de criado. A versão no outro idioma é um post à parte, criado por “Criar tradução”."
        }
      >
        {POST_LANGS.map((code) => (
          <option key={code} value={code}>
            {LANG_LABEL[code]}
          </option>
        ))}
      </SelectField>
      <SelectField
        label="Autor"
        value={authorId}
        onChange={(event) => setAuthorId(event.target.value)}
        error={problems.author}
        disabled={pending}
      >
        <option value="">Escolha…</option>
        {authors.map((author) => (
          <option key={author.id} value={author.id}>
            {author.name}
          </option>
        ))}
      </SelectField>
      {error ? <Notice tone="error">{error}</Notice> : null}
      <div className="flex flex-wrap justify-end gap-2">
        <Link href="/blog" className={buttonClass("ghost")}>
          Cancelar
        </Link>
        <Button type="submit" variant="primary" pending={pending}>
          {source ? "Criar tradução e abrir o editor" : "Criar rascunho e abrir o editor"}
        </Button>
      </div>
    </form>
  );
}
