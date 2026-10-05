// A server action answers with one message, already in Portuguese (errors.ts, parseInput). The
// editor shows it next to the field it is about when the message says which one, and at the top
// otherwise. Pure and import-free: the modules that write these messages are server-only.

export type EditorField =
  | "title"
  | "body"
  | "excerpt"
  | "category"
  | "author"
  | "tags"
  | "metaTitle"
  | "metaDescription"
  | "cover"
  | "coverAlt";

// The label parseInput puts in front of a generic message ("Resumo: no máximo 400 caracteres"),
// from FIELD_LABELS in errors.ts. Longest first: "Título de SEO" also starts with "Título".
const BY_LABEL: [string, EditorField][] = [
  ["Texto alternativo da capa", "coverAlt"],
  ["Descrição de SEO", "metaDescription"],
  ["Título de SEO", "metaTitle"],
  ["Categoria", "category"],
  ["Título", "title"],
  ["Resumo", "excerpt"],
  ["Corpo", "body"],
  ["Autor", "author"],
  ["Tags", "tags"],
  ["Capa", "cover"],
];

// Messages a schema or a core wrote whole, without the label prefix.
const BY_START: [string, EditorField][] = [
  ["Título muito curto", "title"],
  ["Corpo grande demais", "body"],
  ["Shortcode", "body"],
  ["Post sem corpo", "body"],
  ["Post aprovado ou publicado não pode ficar sem corpo", "body"],
  ["Tag só com", "tags"],
  ["No máximo 12 tags", "tags"],
  ["Autor não encontrado", "author"],
  ["Categoria não encontrada", "category"],
  ["Capa inválida", "cover"],
];

export function fieldForError(message: string): EditorField | null {
  for (const [label, field] of BY_LABEL) {
    if (message.startsWith(`${label}: `)) return field;
  }
  for (const [start, field] of BY_START) {
    if (message.startsWith(start)) return field;
  }
  return null;
}

// StalePostError's message (posts.ts). The editor treats this one apart: the admin's text is
// still on screen and must not be thrown away by a reflex reload. field-error.test.ts holds the
// two strings equal.
export const STALE_POST_MESSAGE = "Alguém salvou este post depois que você abriu. Recarregue.";
