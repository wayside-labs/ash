"use client";

import { type FormEvent, useState } from "react";
import { deleteCategory, upsertCategory } from "@/blog/actions/categories";
import { SHORT_SLUG_HELP, isShortSlug, suggestShortSlug } from "@/blog/lib/short-slug";
import { Button } from "@/ui/button";
import { ConfirmDialog } from "@/ui/confirm-dialog";
import { Dialog } from "@/ui/dialog";
import { TextField } from "@/ui/field";
import { Notice } from "@/ui/notice";
import { type Action, useAction } from "@/ui/use-action";

export type CategoryView = {
  id: string;
  slug: string;
  namePt: string;
  nameEn: string;
  postCount: number;
  publishedCount: number;
};

const MIN_NAME = 2;
const CELL = "px-4 py-3 align-top max-md:block max-md:px-0 max-md:py-1";
const LABELLED =
  "max-md:before:text-xs max-md:before:text-faint max-md:before:content-[attr(data-label)_':_']";
const HEAD = "px-4 py-3 font-medium";

type Problems = { namePt?: string; nameEn?: string; slug?: string };

// The slug is the identity (categories.ts): saving a slug that exists renames that category. So
// an edit keeps the slug fixed, and a new one that collides is told what it is about to do.
function CategoryForm({
  action,
  editing,
  categories,
  onClose,
}: {
  action: Action;
  editing: CategoryView | null;
  categories: readonly CategoryView[];
  onClose: () => void;
}) {
  const { pending, error, run } = action;
  const [namePt, setNamePt] = useState(editing?.namePt ?? "");
  const [nameEn, setNameEn] = useState(editing?.nameEn ?? "");
  const [slug, setSlug] = useState(editing?.slug ?? "");
  // Until the admin types in the slug field, it follows the Portuguese name.
  const [slugTyped, setSlugTyped] = useState(false);
  const [problems, setProblems] = useState<Problems>({});

  const collision = editing ? undefined : categories.find((category) => category.slug === slug);

  function changeNamePt(value: string) {
    setNamePt(value);
    if (!editing && !slugTyped) setSlug(suggestShortSlug(value));
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    const found: Problems = {};
    if (namePt.trim().length < MIN_NAME) found.namePt = "Dê um nome em português.";
    if (nameEn.trim().length < MIN_NAME) found.nameEn = "Dê um nome em inglês.";
    if (!isShortSlug(slug)) found.slug = SHORT_SLUG_HELP;
    setProblems(found);
    if (found.namePt || found.nameEn || found.slug) return;
    run(
      () => upsertCategory({ slug, name_pt: namePt.trim(), name_en: nameEn.trim() }),
      onClose,
    );
  }

  return (
    <form onSubmit={submit} noValidate className="space-y-4">
      <TextField
        label="Nome em português"
        value={namePt}
        onChange={(event) => changeNamePt(event.target.value)}
        maxLength={60}
        autoFocus
        error={problems.namePt}
        readOnly={pending}
      />
      <TextField
        label="Nome em inglês"
        value={nameEn}
        onChange={(event) => setNameEn(event.target.value)}
        maxLength={60}
        error={problems.nameEn}
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
            ? "É o que identifica a categoria e aparece no endereço das páginas; não muda. Salvar troca só os nomes, e os posts continuam ligados a ela."
            : "Aparece no endereço das páginas da categoria e não muda depois. Sai do nome, mas você pode ajustar."
        }
        error={problems.slug}
      />
      {collision ? (
        <Notice tone="warning">
          Já existe uma categoria com este endereço: “{collision.namePt}”. Salvar vai trocar o nome
          dela, não criar outra.
        </Notice>
      ) : null}
      {error ? <Notice tone="error">{error}</Notice> : null}
      <div className="flex flex-wrap justify-end gap-2 pt-2">
        <Button variant="ghost" onClick={onClose} blocked={pending}>
          Cancelar
        </Button>
        <Button type="submit" variant="primary" pending={pending}>
          {editing ? "Salvar nomes" : collision ? "Renomear a existente" : "Criar categoria"}
        </Button>
      </div>
    </form>
  );
}

function plural(count: number, one: string, many: string) {
  return `${count} ${count === 1 ? one : many}`;
}

export function CategoryManager({ categories }: { categories: readonly CategoryView[] }) {
  // "new", a category being edited, or closed.
  const [form, setForm] = useState<CategoryView | "new" | null>(null);
  const [deleting, setDeleting] = useState<CategoryView | null>(null);
  // Held here, above the dialogs, so each one knows when its request is running (no Esc then)
  // and the answer has a mounted place to land.
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
          Nova categoria
        </Button>
      </div>

      {categories.length === 0 ? (
        <div className="surface-card p-8 text-center text-sm text-muted">
          <p className="text-ink">Nenhuma categoria ainda.</p>
          <p className="mt-1">
            Categorias agrupam os posts no site. Crie a primeira em “Nova categoria”; um post pode
            ficar sem categoria.
          </p>
        </div>
      ) : (
        <div className="surface-card overflow-hidden">
          <table className="w-full text-left text-sm max-md:block">
            <thead className="border-b border-line text-xs text-faint max-md:sr-only">
              <tr>
                <th scope="col" className={HEAD}>
                  Nome em português
                </th>
                <th scope="col" className={HEAD}>
                  Nome em inglês
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
              {categories.map((category) => (
                <tr
                  key={category.id}
                  className="border-b border-line last:border-b-0 max-md:block max-md:px-4 max-md:py-3"
                >
                  <td className={`${CELL} font-medium text-ink`}>{category.namePt}</td>
                  <td className={`${CELL} ${LABELLED} text-muted`} data-label="Em inglês">
                    {category.nameEn}
                  </td>
                  <td
                    className={`${CELL} ${LABELLED} font-mono text-xs text-muted`}
                    data-label="Endereço"
                  >
                    {category.slug}
                  </td>
                  <td className={`${CELL} ${LABELLED} whitespace-nowrap text-muted`} data-label="Posts">
                    {plural(category.postCount, "post", "posts")}
                    <span className="text-faint">
                      {" "}
                      · {plural(category.publishedCount, "publicado", "publicados")}
                    </span>
                  </td>
                  <td className={CELL}>
                    <div className="flex flex-wrap gap-1.5 max-md:mt-2">
                      <Button
                        size="sm"
                        aria-label={`Editar: ${category.namePt}`}
                        onClick={() => setForm(category)}
                      >
                        Editar
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        aria-label={`Apagar: ${category.namePt}`}
                        onClick={() => setDeleting(category)}
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
        title={form === "new" || form === null ? "Nova categoria" : "Editar categoria"}
      >
        <CategoryForm
          action={save}
          editing={form === "new" ? null : form}
          categories={categories}
          onClose={closeForm}
        />
      </Dialog>

      <ConfirmDialog
        open={deleting !== null}
        title="Apagar categoria?"
        confirmLabel="Apagar"
        tone="danger"
        pending={remove.pending}
        error={remove.error}
        onConfirm={() => {
          if (deleting) remove.run(() => deleteCategory(deleting.id), () => setDeleting(null));
        }}
        onClose={stopDeleting}
      >
        {deleting ? (
          <>
            <span className="text-ink">{deleting.namePt}</span> deixa de existir.{" "}
            {deleting.postCount === 0
              ? "Nenhum post usa esta categoria."
              : `${plural(deleting.postCount, "post fica", "posts ficam")} sem categoria; os posts em si não são apagados.`}
          </>
        ) : null}
      </ConfirmDialog>
    </div>
  );
}
