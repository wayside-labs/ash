import type { z } from "zod";

// The errors an admin can do something about. Their message is Portuguese and goes to the screen
// as is; anything that is not a BlogError is a bug or an outage and must stay a 500.
export class BlogError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class ValidationError extends BlogError {}

export class NotFoundError extends BlogError {}

// The post changed between the moment this screen read it and this write: another admin saved,
// or moved it to another state. Nothing was written; going on would silently drop their work, or
// act on text that is no longer the one on screen. Thrown by a save (posts.ts) and by a
// transition that came with a token (status.ts).
export class StalePostError extends BlogError {
  constructor() {
    super("Alguém salvou este post depois que você abriu. Recarregue.");
  }
}

// What the admin calls each field. Keyed by the first path segment of the input documents in
// schemas.ts (the same key means the same thing in all of them).
const FIELD_LABELS: Record<string, string> = {
  id: "Post",
  action: "Ação",
  lang: "Idioma",
  title: "Título",
  excerpt: "Resumo",
  body_html: "Corpo",
  category_id: "Categoria",
  author_id: "Autor",
  tags: "Tags",
  featured: "Destaque",
  meta_title: "Título de SEO",
  meta_description: "Descrição de SEO",
  cover_url: "Capa",
  cover_alt: "Texto alternativo da capa",
  scheduled_for: "Data",
  if_updated_at: "Versão do post",
  feedback: "Comentário",
  slug: "Slug",
  name: "Nome",
  name_pt: "Nome (pt)",
  name_en: "Nome (en)",
  bio_pt: "Bio (pt)",
  bio_en: "Bio (en)",
  avatar_url: "Avatar",
};

// Marks a message as written by ptIssue below, so parseInput knows it still lacks the field
// name. A message the schema wrote itself ("Título muito curto") never carries it.
const GENERIC = "\u0000";

const plural = (n: unknown, one: string, many: string) => `${String(n)} ${n === 1 ? one : many}`;

// zod's default messages are English and reach the screen through parseInput. This is the
// per-parse error map: it only speaks when the schema gave no message of its own.
function ptIssue(issue: {
  code?: string;
  input?: unknown;
  origin?: string;
  minimum?: unknown;
  maximum?: unknown;
}): string {
  const size = (limit: unknown) =>
    issue.origin === "string"
      ? plural(limit, "caractere", "caracteres")
      : issue.origin === "array"
        ? plural(limit, "item", "itens")
        : String(limit);
  switch (issue.code) {
    case "invalid_type":
      return `${GENERIC}${issue.input === undefined ? "obrigatório" : "valor inválido"}`;
    case "too_big":
      return `${GENERIC}no máximo ${size(issue.maximum)}`;
    case "too_small":
      return `${GENERIC}no mínimo ${size(issue.minimum)}`;
    default:
      return `${GENERIC}valor inválido`;
  }
}

export function parseInput<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const parsed = schema.safeParse(input, { error: ptIssue });
  if (parsed.success) return parsed.data;
  const issue = parsed.error.issues[0];
  if (!issue) throw new ValidationError("Dados inválidos");
  if (!issue.message.startsWith(GENERIC)) throw new ValidationError(issue.message);
  const text = issue.message.slice(GENERIC.length);
  const field = issue.path[0];
  if (field === undefined) throw new ValidationError("Dados inválidos");
  throw new ValidationError(`${FIELD_LABELS[String(field)] ?? String(field)}: ${text}`);
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// An id that is not a uuid would reach Postgres as a cast error (22P02), which is a 500 for what
// is just a row that does not exist.
export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

export const UNIQUE_VIOLATION = "23505";
export const FK_VIOLATION = "23503";

// drizzle wraps the driver's error (DrizzleQueryError.cause), and a transaction may wrap it once
// more: the SQLSTATE and the constraint are somewhere down the cause chain. The name is what
// tells a server error from a socket one: Node's EPIPE or EPERM are five capitals too, and would
// pass for a SQLSTATE.
export function pgError(err: unknown): { code: string; constraint: string | null } | null {
  let current: unknown = err;
  for (let depth = 0; depth < 5 && current instanceof Error; depth++) {
    const candidate = current as Error & { code?: unknown; constraint_name?: unknown };
    if (candidate.name === "PostgresError" && typeof candidate.code === "string") {
      return {
        code: candidate.code,
        constraint:
          typeof candidate.constraint_name === "string" ? candidate.constraint_name : null,
      };
    }
    current = current.cause;
  }
  return null;
}
