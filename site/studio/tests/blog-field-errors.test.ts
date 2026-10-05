// The editor shows a server message next to the field it is about (lib/field-error.ts). The
// messages here are the ones the cores write whole and only write with rows in place; each is
// taken from the error the real code throws, never copied as a literal, so a reworded message
// that stops matching its field fails here. The ones that need no database are in
// src/blog/lib/field-error.test.ts.
import type { Db } from "@/db/client";
import { BlogError } from "@/blog/errors";
import { fieldForError } from "@/blog/lib/field-error";
import { createPost, updatePost } from "@/blog/posts";
import { setPostStatus } from "@/blog/status";
import { ACTOR, editInput, postInput, seedAuthor } from "./helpers/blog";
import { describeDb, freshDb } from "./helpers/db";

const MISSING = "00000000-0000-4000-8000-000000000000";

async function thrownBy(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
  } catch (err) {
    if (err instanceof BlogError) return err.message;
    throw err;
  }
  throw new Error("nothing was thrown");
}

describeDb("mensagens dos núcleos e o campo em que a tela as mostra", () => {
  let db: Db;
  let close: () => Promise<void>;
  let authorId: string;
  let counter = 0;
  beforeAll(async () => {
    ({ db, close } = await freshDb());
    authorId = await seedAuthor(db);
  });
  afterAll(async () => close());

  const draft = async (overrides: Record<string, unknown> = {}) => {
    counter += 1;
    const created = await createPost(
      db,
      postInput(authorId, { title: `Um post para os erros de campo ${counter}`, ...overrides }),
      ACTOR,
    );
    return created.id;
  };

  it("autor e categoria que não existem caem nos seus campos", async () => {
    const author = await thrownBy(() => createPost(db, postInput(MISSING), ACTOR));
    expect(fieldForError(author)).toBe("author");
    const category = await thrownBy(() =>
      createPost(db, postInput(authorId, { category_id: MISSING }), ACTOR),
    );
    expect(fieldForError(category)).toBe("category");
    // Two different messages: neither is the generic fallback.
    expect(author).not.toBe(category);
  });

  it("aprovar um post sem texto fala do texto", async () => {
    const id = await draft({ body_html: "<p></p>" });
    await setPostStatus(db, { id, action: "submit" }, ACTOR);
    const message = await thrownBy(() => setPostStatus(db, { id, action: "approve" }, ACTOR));
    expect(fieldForError(message)).toBe("body");
  });

  it("esvaziar o texto de um post aprovado fala do texto", async () => {
    const id = await draft();
    await setPostStatus(db, { id, action: "submit" }, ACTOR);
    await setPostStatus(db, { id, action: "approve" }, ACTOR);
    const input = await editInput(db, id, authorId, { body_html: "<p></p>" });
    const message = await thrownBy(() => updatePost(db, id, input, ACTOR));
    expect(fieldForError(message)).toBe("body");
  });

  it("o que não é de campo nenhum fica para o topo: idioma trocado, post que sumiu, estado errado", async () => {
    const id = await draft();
    const lang = await thrownBy(async () =>
      updatePost(db, id, await editInput(db, id, authorId, { lang: "en" }), ACTOR),
    );
    const gone = await thrownBy(async () =>
      updatePost(db, MISSING, await editInput(db, MISSING, authorId), ACTOR),
    );
    const lost = await thrownBy(() => setPostStatus(db, { id, action: "publish" }, ACTOR));
    for (const message of [lang, gone, lost]) {
      expect(message).toMatch(/\S/);
      expect(fieldForError(message), message).toBeNull();
    }
  });
});
