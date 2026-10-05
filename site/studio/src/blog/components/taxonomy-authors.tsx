"use client";

import { type FormEvent, useState } from "react";
import { deleteAuthor, upsertAuthor } from "@/blog/actions/authors";
import { SHORT_SLUG_HELP, isShortSlug, suggestShortSlug } from "@/blog/lib/short-slug";
import { Button } from "@/ui/button";
import { ConfirmDialog } from "@/ui/confirm-dialog";
import { Dialog } from "@/ui/dialog";
import { TextAreaField, TextField } from "@/ui/field";
import { Notice } from "@/ui/notice";
import { type Action, useAction } from "@/ui/use-action";
import { ImageDialog } from "./editor/image-dialog";

export type AuthorView = {
  id: string;
  slug: string;
  name: string;
  bioPt: string;
  bioEn: string;
  avatarUrl: string | null;
  postCount: number;
  publishedCount: number;
};

const CELL = "px-4 py-3 align-top max-md:block max-md:px-0 max-md:py-1";
const LABELLED =
  "max-md:before:text-xs max-md:before:text-faint max-md:before:content-[attr(data-label)_':_']";
const HEAD = "px-4 py-3 font-medium";

type Problems = { name?: string; slug?: string };

// As with categories, the slug is the identity: an edit keeps it, a new one that collides
// renames. The upsert carries the whole document, so the avatar always goes back: the one chosen
// here, or the one that was already there.
function AuthorForm({
  action,
  editing,
  authors,
  onClose,
}: {
  action: Action;
  editing: AuthorView | null;
  authors: readonly AuthorView[];
  onClose: () => void;
}) {
  const { pending, error, run } = action;
  const [name, setName] = useState(editing?.name ?? "");
  const [slug, setSlug] = useState(editing?.slug ?? "");
  const [slugTyped, setSlugTyped] = useState(false);
  const [bioPt, setBioPt] = useState(editing?.bioPt ?? "");
  const [bioEn, setBioEn] = useState(editing?.bioEn ?? "");
  const [avatarUrl, setAvatarUrl] = useState(editing?.avatarUrl ?? null);
  const [choosingPhoto, setChoosingPhoto] = useState(false);
  const [problems, setProblems] = useState<Problems>({});

  const collision = editing ? undefined : authors.find((author) => author.slug === slug);

  function changeName(value: string) {
    setName(value);
    if (!editing && !slugTyped) setSlug(suggestShortSlug(value));
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    const found: Problems = {};
    if (name.trim().length < 1) found.name = "Dê um nome ao autor.";
    if (!isShortSlug(slug)) found.slug = SHORT_SLUG_HELP;
    setProblems(found);
    if (found.name || found.slug) return;
    run(
      () =>
        upsertAuthor({
          slug,
          name: name.trim(),
          bio_pt: bioPt.trim(),
          bio_en: bioEn.trim(),
          // A new author that collides renames the existing one, and keeps that one's photo.
          avatar_url: editing ? avatarUrl : (collision?.avatarUrl ?? null),
        }),
      onClose,
    );
  }

  const form = (
    <form onSubmit={submit} noValidate className="space-y-4">
      <TextField
        label="Nome"
        value={name}
        onChange={(event) => changeName(event.target.value)}
        maxLength={80}
        autoFocus
        error={problems.name}
        readOnly={pending}
      />
      <TextField
        label="Endereço (slug)"
        value={slug}
        onChange={(event) => {
          setSlugTyped(true);
          setSlug(event.target.value);
        }}
        maxLength={60}
        readOnly={editing !== null || pending}
        spellCheck={false}
        autoCapitalize="none"
        hint={
          editing
            ? "É o que identifica o autor e aparece no endereço da página dele; não muda. Salvar troca o nome, as bios e a foto, e os posts continuam ligados a ele."
            : "Aparece no endereço da página do autor e não muda depois. Sai do nome, mas você pode ajustar."
        }
        error={problems.slug}
      />
      <TextAreaField
        label="Bio em português"
        value={bioPt}
        onChange={(event) => setBioPt(event.target.value)}
        maxLength={600}
        rows={3}
        hint="Opcional. Até 600 caracteres."
        readOnly={pending}
      />
      <TextAreaField
        label="Bio em inglês"
        value={bioEn}
        onChange={(event) => setBioEn(event.target.value)}
        maxLength={600}
        rows={3}
        hint="Opcional. Até 600 caracteres."
        readOnly={pending}
      />

      <div className="space-y-1.5">
        <p className="text-sm font-medium text-ink">Foto</p>
        {editing ? (
          <div className="flex flex-wrap items-center gap-3">
            {avatarUrl ? (
              // A plain img: the file is ours (/media) and next/image is off (next.config.ts).
              <img
                src={avatarUrl}
                alt={`Foto de ${editing.name}`}
                className="size-14 rounded-lg border border-line object-cover"
              />
            ) : (
              <span className="text-xs text-muted">Sem foto.</span>
            )}
            <Button size="sm" blocked={pending} onClick={() => setChoosingPhoto(true)}>
              {avatarUrl ? "Trocar foto" : "Escolher foto"}
            </Button>
            {avatarUrl ? (
              <Button size="sm" variant="ghost" blocked={pending} onClick={() => setAvatarUrl(null)}>
                Remover foto
              </Button>
            ) : null}
          </div>
        ) : (
          // The file is stored under the author's id, and a new author has none yet.
          <p className="text-xs text-muted">
            A foto entra depois: crie o autor e abra “Editar” para escolher a imagem.
          </p>
        )}
        {editing && avatarUrl !== editing.avatarUrl ? (
          <p className="text-xs text-warning">A foto só muda de verdade quando você salvar.</p>
        ) : null}
      </div>

      {collision ? (
        <Notice tone="warning">
          Já existe um autor com este endereço: “{collision.name}”. Salvar vai trocar o nome e as
          bios dele, não criar outro.
        </Notice>
      ) : null}
      {error ? <Notice tone="error">{error}</Notice> : null}
      <div className="flex flex-wrap justify-end gap-2 pt-2">
        <Button variant="ghost" onClick={onClose} blocked={pending}>
          Cancelar
        </Button>
        <Button type="submit" variant="primary" pending={pending}>
          {editing ? "Salvar autor" : collision ? "Alterar o existente" : "Criar autor"}
        </Button>
      </div>
    </form>
  );

  // Outside the <form>: the image dialog has a form of its own, and a form inside a form is not
  // valid HTML (its submit would also reach this one).
  return (
    <>
      {form}
      {editing ? (
        <ImageDialog
          open={choosingPhoto}
          onClose={() => setChoosingPhoto(false)}
          owner={{ authorId: editing.id }}
          title="Foto do autor"
          confirmLabel="Usar esta foto"
          alt="none"
          onChoose={(image) => setAvatarUrl(image.url)}
        />
      ) : null}
    </>
  );
}

function plural(count: number, one: string, many: string) {
  return `${count} ${count === 1 ? one : many}`;
}

export function AuthorManager({ authors }: { authors: readonly AuthorView[] }) {
  const [form, setForm] = useState<AuthorView | "new" | null>(null);
  const [deleting, setDeleting] = useState<AuthorView | null>(null);
  // Above the dialogs: see taxonomy-categories.tsx.
  const save = useAction();
  const remove = useAction();

  const closeForm = () => {
    setForm(null);
    save.clearError();
  };
  const stopDeleting = () => {
    setDeleting(null);
    remove.clearError();
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button variant="primary" onClick={() => setForm("new")}>
          Novo autor
        </Button>
      </div>

      {authors.length === 0 ? (
        <div className="surface-card p-8 text-center text-sm text-muted">
          <p className="text-ink">Nenhum autor ainda.</p>
          <p className="mt-1">
            Todo post precisa de alguém que o assine. Crie o primeiro autor em “Novo autor” antes
            de escrever.
          </p>
        </div>
      ) : (
        <div className="surface-card overflow-hidden">
          <table className="w-full text-left text-sm max-md:block">
            <thead className="border-b border-line text-xs text-faint max-md:sr-only">
              <tr>
                <th scope="col" className={HEAD}>
                  Nome
                </th>
                <th scope="col" className={HEAD}>
                  Endereço (slug)
                </th>
                <th scope="col" className={HEAD}>
                  Posts
                </th>
                <th scope="col" className={HEAD}>
                  Ações
                </th>
              </tr>
            </thead>
            <tbody className="max-md:block">
              {authors.map((author) => (
                <tr
                  key={author.id}
                  className="border-b border-line last:border-b-0 max-md:block max-md:px-4 max-md:py-3"
                >
                  <td className={`${CELL} md:w-1/2`}>
                    <div className="flex items-start gap-3">
                      {author.avatarUrl ? (
                        <img
                          src={author.avatarUrl}
                          alt=""
                          className="size-9 shrink-0 rounded-md border border-line object-cover"
                        />
                      ) : null}
                      <div className="min-w-0">
                        <p className="font-medium text-ink">{author.name}</p>
                        {author.bioPt ? (
                          <p className="mt-0.5 line-clamp-2 text-xs text-muted">{author.bioPt}</p>
                        ) : (
                          <p className="mt-0.5 text-xs text-faint">Sem bio</p>
                        )}
                      </div>
                    </div>
                  </td>
                  <td
                    className={`${CELL} ${LABELLED} font-mono text-xs text-muted`}
                    data-label="Endereço"
                  >
                    {author.slug}
                  </td>
                  <td className={`${CELL} ${LABELLED} whitespace-nowrap text-muted`} data-label="Posts">
                    {plural(author.postCount, "post", "posts")}
                    <span className="text-faint">
                      {" "}
                      · {plural(author.publishedCount, "publicado", "publicados")}
                    </span>
                  </td>
                  <td className={CELL}>
                    <div className="flex flex-wrap gap-1.5 max-md:mt-2">
                      <Button
                        size="sm"
                        aria-label={`Editar: ${author.name}`}
                        onClick={() => setForm(author)}
                      >
                        Editar
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        aria-label={`Apagar: ${author.name}`}
                        onClick={() => setDeleting(author)}
                      >
                        Apagar
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Dialog
        open={form !== null}
        onClose={closeForm}
        dismissible={!save.pending}
        title={form === "new" || form === null ? "Novo autor" : "Editar autor"}
      >
        <AuthorForm
          action={save}
          editing={form === "new" ? null : form}
          authors={authors}
          onClose={closeForm}
        />
      </Dialog>

      {/* An author with posts cannot be deleted (the database refuses). The dialog then explains
          instead of offering a button that can only fail. The count is as fresh as the page; if
          a post arrived since, the server's refusal still shows in the confirmation. */}
      <Dialog
        open={deleting !== null && deleting.postCount > 0}
        onClose={stopDeleting}
        title="Este autor tem posts"
        footer={
          <Button variant="primary" onClick={stopDeleting}>
            Entendi
          </Button>
        }
      >
        {deleting ? (
          <p className="text-muted">
            <span className="text-ink">{deleting.name}</span> assina{" "}
            {plural(deleting.postCount, "post", "posts")}. Só dá para apagar um autor sem posts:
            abra cada post dele e troque o autor, depois volte aqui.
          </p>
        ) : null}
      </Dialog>
      <ConfirmDialog
        open={deleting !== null && deleting.postCount === 0}
        title="Apagar autor?"
        confirmLabel="Apagar"
        tone="danger"
        pending={remove.pending}
        error={remove.error}
        onConfirm={() => {
          if (deleting) remove.run(() => deleteAuthor(deleting.id), () => setDeleting(null));
        }}
        onClose={stopDeleting}
      >
        {deleting ? (
          <>
            <span className="text-ink">{deleting.name}</span> deixa de existir. Nenhum post é dele.
          </>
        ) : null}
      </ConfirmDialog>
    </div>
  );
}
