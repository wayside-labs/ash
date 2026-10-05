"use client";

import Link from "next/link";
import { type KeyboardEvent, useState } from "react";
import type { EditorField } from "@/blog/lib/field-error";
import { LANG_LABEL, type PostLang, otherLang } from "@/blog/lib/post-status";
import { UpsertPostSchema } from "@/blog/schemas";
import { Button } from "@/ui/button";
import { SelectField, TextAreaField, TextField } from "@/ui/field";
import { ImageDialog } from "./editor/image-dialog";

// Everything about a post that is not its title or its body. Plain values for the form; the
// editor turns them into the document the server takes ("" becomes null there).
export type PostSettingsValue = {
  categoryId: string;
  authorId: string;
  tags: string[];
  // What is typed in the tags field and not yet closed with Enter or a comma. Part of the value,
  // not private to the field, so the editor counts it as an unsaved change and commits it before
  // saving: a tag typed and followed by Ctrl+S must not be dropped.
  pendingTag: string;
  excerpt: string;
  coverUrl: string | null;
  coverAlt: string;
  featured: boolean;
  metaTitle: string;
  metaDescription: string;
};

// Turns the pending text into a tag. Through the schema's own tags field, so the chip shows the
// tag as the server will store it (trimmed, lower case, NFC, no duplicates) and a tag it would
// refuse is refused here, with its message. The server runs the same code again on save.
export function commitPendingTag(
  value: PostSettingsValue,
): { ok: true; value: PostSettingsValue } | { ok: false; error: string } {
  const raw = value.pendingTag.trim();
  if (!raw) return { ok: true, value: value.pendingTag ? { ...value, pendingTag: "" } : value };
  const parsed = UpsertPostSchema.shape.tags.safeParse([...value.tags, raw]);
  if (!parsed.success) {
    const message = parsed.error.issues[0]?.message ?? "";
    return {
      ok: false,
      error: /^(Tag só|No máximo)/.test(message) ? message : "Tag inválida: até 40 caracteres.",
    };
  }
  return { ok: true, value: { ...value, tags: parsed.data, pendingTag: "" } };
}

// The limits of UpsertPostSchema, for the counters. The server is who enforces them.
const MAX = { excerpt: 400, metaTitle: 70, metaDescription: 170, coverAlt: 160, tags: 12 };

function Counter({ used, max }: { used: number; max: number }) {
  return (
    <span className="font-mono tabular-nums">
      {used}/{max}
    </span>
  );
}

const SECTION = "space-y-4 border-t border-line pt-5 first:border-t-0 first:pt-0";
const HEADING = "text-xs font-medium uppercase tracking-wide text-muted";

export function PostSettings({
  value,
  onChange,
  categories,
  authors,
  post,
  translation,
  errors,
  disabled = false,
}: {
  value: PostSettingsValue;
  onChange: (next: PostSettingsValue) => void;
  categories: readonly { id: string; namePt: string }[];
  authors: readonly { id: string; name: string }[];
  post: { id: string; slug: string; lang: PostLang };
  translation: { id: string; title: string; lang: PostLang } | null;
  // The server's message for a field, when its last answer named one (lib/field-error.ts).
  errors: Partial<Record<EditorField, string>>;
  disabled?: boolean;
}) {
  const draftTag = value.pendingTag;
  const [tagProblem, setTagProblem] = useState<string | null>(null);
  const [choosingCover, setChoosingCover] = useState(false);
  const set = (patch: Partial<PostSettingsValue>) => onChange({ ...value, ...patch });
  const setDraftTag = (pendingTag: string) => set({ pendingTag });

  function addTag() {
    const result = commitPendingTag(value);
    if (!result.ok) {
      setTagProblem(result.error);
      return;
    }
    setTagProblem(null);
    if (result.value !== value) onChange(result.value);
  }

  function tagKey(event: KeyboardEvent<HTMLInputElement>) {
    // Enter and comma close a tag; Enter must not reach a form around this field.
    if (event.key === "Enter" || event.key === ",") {
      event.preventDefault();
      addTag();
    }
  }

  return (
    <div className="space-y-5">
      <section className={SECTION} aria-labelledby="settings-organisation">
        <h2 id="settings-organisation" className={HEADING}>
          Organização
        </h2>
        <SelectField
          label="Categoria"
          value={value.categoryId}
          onChange={(event) => set({ categoryId: event.target.value })}
          error={errors.category}
          disabled={disabled}
        >
          <option value="">Sem categoria</option>
          {categories.map((category) => (
            <option key={category.id} value={category.id}>
              {category.namePt}
            </option>
          ))}
        </SelectField>
        <SelectField
          label="Autor"
          value={value.authorId}
          onChange={(event) => set({ authorId: event.target.value })}
          error={errors.author}
          disabled={disabled}
        >
          {/* Only for a post whose author is gone: there is always one to choose otherwise. */}
          {authors.some((author) => author.id === value.authorId) ? null : (
            <option value="">Escolha…</option>
          )}
          {authors.map((author) => (
            <option key={author.id} value={author.id}>
              {author.name}
            </option>
          ))}
        </SelectField>

        <div className="space-y-1.5">
          <TextField
            label="Tags"
            value={draftTag}
            onChange={(event) => setDraftTag(event.target.value)}
            onKeyDown={tagKey}
            onBlur={addTag}
            maxLength={40}
            hint={
              <>
                Enter ou vírgula fecha a tag. Letras, números, espaço e hífen.{" "}
                <Counter used={value.tags.length} max={MAX.tags} />
              </>
            }
            error={tagProblem ?? errors.tags}
            readOnly={disabled}
          />
          {value.tags.length > 0 ? (
            <ul className="flex flex-wrap gap-1.5" aria-label="Tags do post">
              {value.tags.map((tag) => (
                <li
                  key={tag}
                  className="inline-flex items-center gap-1 rounded-sm border border-line-strong bg-elevated py-0.5 pl-2 pr-1 text-xs text-ink"
                >
                  {tag}
                  <button
                    type="button"
                    aria-label={`Remover a tag ${tag}`}
                    disabled={disabled}
                    onClick={() => set({ tags: value.tags.filter((other) => other !== tag) })}
                    className="rounded-sm px-1 text-muted hover:text-ink"
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>

        <label className="flex items-start gap-2 text-sm text-ink">
          <input
            type="checkbox"
            checked={value.featured}
            onChange={(event) => set({ featured: event.target.checked })}
            disabled={disabled}
            className="mt-0.5 size-4 accent-settle"
          />
          <span>
            Destaque
            <span className="block text-xs text-muted">
              Marca o post para a área de destaques do blog.
            </span>
          </span>
        </label>
      </section>

      <section className={SECTION} aria-labelledby="settings-summary">
        <h2 id="settings-summary" className={HEADING}>
          Resumo e capa
        </h2>
        <TextAreaField
          label="Resumo"
          value={value.excerpt}
          onChange={(event) => set({ excerpt: event.target.value })}
          maxLength={MAX.excerpt}
          rows={4}
          hint={
            <>
              Aparece nas listas de posts. <Counter used={value.excerpt.length} max={MAX.excerpt} />
            </>
          }
          error={errors.excerpt}
          readOnly={disabled}
        />

        <div className="space-y-2">
          <p className="text-sm font-medium text-ink">Capa</p>
          {value.coverUrl ? (
            // A plain img: the file is ours (/media) and next/image is off (next.config.ts).
            <img
              src={value.coverUrl}
              alt={value.coverAlt}
              className="max-h-40 w-full rounded-md border border-line object-cover"
            />
          ) : (
            <p className="text-xs text-muted">Sem capa.</p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button size="sm" blocked={disabled} onClick={() => setChoosingCover(true)}>
              {value.coverUrl ? "Trocar capa" : "Escolher capa"}
            </Button>
            {value.coverUrl ? (
              <Button
                size="sm"
                variant="ghost"
                blocked={disabled}
                onClick={() => set({ coverUrl: null, coverAlt: "" })}
              >
                Remover capa
              </Button>
            ) : null}
          </div>
          {errors.cover ? (
            <p role="alert" className="text-xs text-deny">
              {errors.cover}
            </p>
          ) : null}
          {value.coverUrl ? (
            <TextField
              label="Texto alternativo da capa"
              value={value.coverAlt}
              onChange={(event) => set({ coverAlt: event.target.value })}
              maxLength={MAX.coverAlt}
              hint={
                <>
                  O que a capa mostra. <Counter used={value.coverAlt.length} max={MAX.coverAlt} />
                </>
              }
              error={errors.coverAlt}
              readOnly={disabled}
            />
          ) : null}
        </div>
      </section>

      <section className={SECTION} aria-labelledby="settings-seo">
        <h2 id="settings-seo" className={HEADING}>
          Buscadores (SEO)
        </h2>
        <TextField
          label="Título para buscadores"
          value={value.metaTitle}
          onChange={(event) => set({ metaTitle: event.target.value })}
          maxLength={MAX.metaTitle}
          hint={
            <>
              Vazio, vale o título do post.{" "}
              <Counter used={value.metaTitle.length} max={MAX.metaTitle} />
            </>
          }
          error={errors.metaTitle}
          readOnly={disabled}
        />
        <TextAreaField
          label="Descrição para buscadores"
          value={value.metaDescription}
          onChange={(event) => set({ metaDescription: event.target.value })}
          maxLength={MAX.metaDescription}
          rows={3}
          hint={
            <>
              Vazia, vale o resumo.{" "}
              <Counter used={value.metaDescription.length} max={MAX.metaDescription} />
            </>
          }
          error={errors.metaDescription}
          readOnly={disabled}
        />
      </section>

      <section className={SECTION} aria-labelledby="settings-address">
        <h2 id="settings-address" className={HEADING}>
          Endereço e idioma
        </h2>
        <dl className="space-y-1 text-sm">
          <div className="flex flex-wrap gap-x-2">
            <dt className="text-muted">Endereço (slug):</dt>
            <dd className="break-all font-mono text-xs leading-5 text-ink">{post.slug}</dd>
          </div>
          <div className="flex flex-wrap gap-x-2">
            <dt className="text-muted">Idioma:</dt>
            <dd className="text-ink">{LANG_LABEL[post.lang]}</dd>
          </div>
        </dl>
        <p className="text-xs text-muted">
          Os dois foram definidos quando o post nasceu e não mudam: estão no endereço público.
        </p>
        {translation ? (
          <p className="text-sm">
            <span className="text-muted">Versão em {LANG_LABEL[translation.lang].toLowerCase()}: </span>
            <Link href={`/blog/${translation.id}`} className="text-accent underline">
              {translation.title}
            </Link>
          </p>
        ) : (
          <p className="text-sm">
            <span className="text-muted">
              Ainda sem versão em {LANG_LABEL[otherLang(post.lang)].toLowerCase()}.{" "}
            </span>
            <Link href={`/blog/novo?traducao_de=${post.id}`} className="text-accent underline">
              Criar tradução
            </Link>
          </p>
        )}
      </section>

      <ImageDialog
        open={choosingCover}
        onClose={() => setChoosingCover(false)}
        owner={{ postId: post.id }}
        title="Capa do post"
        confirmLabel="Usar como capa"
        onChoose={(image) => set({ coverUrl: image.url, coverAlt: image.alt })}
      />
    </div>
  );
}
