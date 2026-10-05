import { ValidationError, parseInput, pgError } from "./errors";
import { UpsertAuthorSchema, UpsertCategorySchema, UpsertPostSchema } from "./schemas";

const AUTHOR = "00000000-0000-4000-8000-000000000000";

function postgresError(code: string, constraint?: string): Error {
  const err = new Error("boom") as Error & { code: string; constraint_name?: string };
  err.name = "PostgresError";
  err.code = code;
  if (constraint) err.constraint_name = constraint;
  return err;
}

describe("pgError", () => {
  it("acha o erro do Postgres no fim da cadeia de causas", () => {
    const wrapped = new Error("Failed query", {
      cause: new Error("tx", { cause: postgresError("23505", "blog_posts_lang_slug_idx") }),
    });
    expect(pgError(wrapped)).toEqual({ code: "23505", constraint: "blog_posts_lang_slug_idx" });
    expect(pgError(postgresError("23503"))).toEqual({ code: "23503", constraint: null });
  });

  it("erro de rede com código de cinco letras não é erro do Postgres", () => {
    for (const code of ["EPIPE", "EPERM", "ENXIO"]) {
      const err = Object.assign(new Error("write EPIPE"), { code });
      expect(pgError(err), code).toBeNull();
      expect(pgError(new Error("wrapped", { cause: err })), code).toBeNull();
    }
  });

  it("o que não é erro devolve null", () => {
    expect(pgError(null)).toBeNull();
    expect(pgError("23505")).toBeNull();
    expect(pgError(new Error("plain"))).toBeNull();
  });
});

describe("parseInput", () => {
  const message = (run: () => unknown): string => {
    try {
      run();
    } catch (err) {
      expect(err).toBeInstanceOf(ValidationError);
      return (err as Error).message;
    }
    throw new Error("did not throw");
  };
  const post = (overrides: Record<string, unknown>) => () =>
    parseInput(UpsertPostSchema, {
      lang: "pt",
      title: "Um título de tamanho bom",
      author_id: AUTHOR,
      ...overrides,
    });

  it("mensagem que o schema já escreveu passa como está", () => {
    expect(message(post({ title: "curto" }))).toBe("Título muito curto");
  });

  it("mensagem padrão do zod sai em português, com o nome do campo", () => {
    expect(message(post({ title: "x".repeat(161) }))).toBe("Título: no máximo 160 caracteres");
    expect(message(post({ title: undefined }))).toBe("Título: obrigatório");
    expect(message(post({ excerpt: "x".repeat(401) }))).toBe("Resumo: no máximo 400 caracteres");
    expect(message(post({ author_id: "nao-e-uuid" }))).toBe("Autor: valor inválido");
    expect(message(post({ lang: "fr" }))).toBe("Idioma: valor inválido");
    expect(message(post({ featured: "sim" }))).toBe("Destaque: valor inválido");
    expect(message(post({ tags: ["x".repeat(41)] }))).toBe("Tags: no máximo 40 caracteres");
  });

  it("vale para categoria e autor também", () => {
    expect(
      message(() => parseInput(UpsertCategorySchema, { slug: "ok", name_pt: "a", name_en: "Name" })),
    ).toBe("Nome (pt): no mínimo 2 caracteres");
    expect(message(() => parseInput(UpsertAuthorSchema, { slug: "ok", name: "" }))).toBe(
      "Nome: no mínimo 1 caractere",
    );
  });

  it("nenhuma mensagem sai em inglês para as entradas ruins mais comuns", () => {
    const bad: Array<() => unknown> = [
      post({ title: 7 }),
      post({ tags: "nao-e-lista" }),
      post({ meta_title: "x".repeat(71) }),
      post({ meta_description: "x".repeat(171) }),
      post({ cover_alt: "x".repeat(161) }),
      post({ category_id: "x" }),
      () => parseInput(UpsertPostSchema, null),
      () => parseInput(UpsertPostSchema, "texto"),
    ];
    for (const run of bad) {
      expect(message(run)).not.toMatch(/\b(expected|Invalid|Too|received|string|input)\b/);
    }
  });
});
