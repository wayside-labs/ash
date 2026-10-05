import type { Db } from "@/db/client";
import { BlogError, NotFoundError, StalePostError, ValidationError, parseInput } from "../errors";
import { SlugBusyError, TranslationExistsError, createPost } from "../posts";
import { UpdatePostSchema } from "../schemas";
import { LostTransitionError, NotScheduledError } from "../status";
import { STALE_POST_MESSAGE, fieldForError } from "./field-error";

const AUTHOR = "123e4567-e89b-42d3-a456-426614174000";
const valid = {
  lang: "pt",
  title: "Um título de teste",
  author_id: AUTHOR,
  if_updated_at: "2026-10-05T12:00:00.000Z",
};

// The message the server would send for this document.
function messageFor(overrides: Record<string, unknown>): string {
  try {
    parseInput(UpdatePostSchema, { ...valid, ...overrides });
  } catch (err) {
    if (err instanceof ValidationError) return err.message;
    throw err;
  }
  throw new Error("the document was accepted");
}

describe("fieldForError", () => {
  it("as mensagens que o schema de verdade escreve caem no campo certo", () => {
    const cases: [Record<string, unknown>, string][] = [
      [{ title: "curto" }, "title"],
      [{ title: "x".repeat(161) }, "title"],
      [{ excerpt: "x".repeat(401) }, "excerpt"],
      [{ body_html: "x".repeat(300_001) }, "body"],
      [{ category_id: "nao-e-uuid" }, "category"],
      [{ author_id: "nao-e-uuid" }, "author"],
      [{ author_id: undefined }, "author"],
      [{ tags: ["com/barra"] }, "tags"],
      [{ tags: Array.from({ length: 13 }, (_, i) => `tag ${i}`) }, "tags"],
      [{ meta_title: "x".repeat(71) }, "metaTitle"],
      [{ meta_description: "x".repeat(171) }, "metaDescription"],
      [{ cover_url: "https://evil.example/a.png" }, "cover"],
      [{ cover_alt: "x".repeat(161) }, "coverAlt"],
    ];
    for (const [overrides, field] of cases) {
      const message = messageFor(overrides);
      expect(fieldForError(message), `${JSON.stringify(Object.keys(overrides))}: ${message}`).toBe(field);
    }
  });

  // The messages the cores write whole are not copied here: each one is taken from the error the
  // real code throws. What prepare() refuses (posts.ts) is thrown before the database is touched,
  // so the core runs here with no database at all; the ones that need rows (an approved post
  // with no body, an author that does not exist) are in tests/blog-field-errors.test.ts.
  async function thrownBy(run: () => Promise<unknown>): Promise<string> {
    try {
      await run();
    } catch (err) {
      if (err instanceof BlogError) return err.message;
      throw err;
    }
    throw new Error("nothing was thrown");
  }
  const NO_DB = null as unknown as Db;
  const save = (body_html: string) =>
    thrownBy(() => createPost(NO_DB, { ...valid, body_html }, "admin@example.com"));

  it("o que o núcleo recusa no corpo, antes de chegar ao banco, cai no campo do texto", async () => {
    const unknown = await save("<p>texto</p>{{calculadora:furo}}");
    expect(unknown).toContain("calculadora:furo");
    expect(fieldForError(unknown)).toBe("body");

    const inline = await save("<p>veja {{cta:pitch}} aqui</p>");
    expect(inline).toContain("cta:pitch");
    expect(fieldForError(inline)).toBe("body");
  });

  it("o que não fala de campo nenhum fica para o topo da tela", () => {
    for (const message of [
      new StalePostError().message,
      new LostTransitionError("id", "rascunho").message,
      new NotScheduledError("id").message,
      new NotFoundError("Post não encontrado").message,
      new TranslationExistsError("en").message,
      new SlugBusyError().message,
      messageFor({ if_updated_at: "ontem" }),
      "",
    ]) {
      expect(fieldForError(message), message).toBeNull();
    }
  });

  it("a mensagem de versão velha é a do núcleo", () => {
    expect(new StalePostError().message).toBe(STALE_POST_MESSAGE);
  });
});
