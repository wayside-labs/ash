import {
  MAX_IMAGE_BYTES,
  buildAuthorImagePath,
  buildPostImagePath,
  isMediaPath,
  mediaUrl,
  validateImage,
} from "./image-rules";

const POST_ID = "11111111-2222-4333-8444-555555555555";
const NAME = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

describe("buildAuthorImagePath", () => {
  it("monta o caminho na pasta de autores, sempre .webp, e vira um endereço /media aceito", () => {
    expect(buildAuthorImagePath(POST_ID, NAME)).toBe(`autores/${POST_ID}/${NAME}.webp`);
    expect(isMediaPath(mediaUrl(buildAuthorImagePath(POST_ID, NAME)))).toBe(true);
  });

  it("recusa id de autor ou nome de arquivo que não é uuid", () => {
    for (const id of ["..", "../..", "a/b", "", "novo", `${POST_ID}/..`, NAME.toUpperCase()]) {
      expect(() => buildAuthorImagePath(id, NAME), id).toThrow();
    }
    expect(() => buildAuthorImagePath(null as unknown as string, NAME)).toThrow();
    for (const name of ["..", "a/b", "foto.png", "", "a\\b"]) {
      expect(() => buildAuthorImagePath(POST_ID, name), name).toThrow();
    }
  });
});

describe("validateImage", () => {
  it("aceita jpeg, png e webp dentro do teto", () => {
    for (const format of ["jpeg", "png", "webp"]) {
      expect(validateImage({ format, size: 1024 })).toEqual({ ok: true });
    }
  });

  it("recusa formato fora da lista", () => {
    for (const format of ["gif", "svg", "tiff", "heif", "image/png"]) {
      expect(validateImage({ format, size: 1024 }), format).toEqual({
        ok: false,
        error: "Use JPG, PNG ou WebP",
      });
    }
  });

  it("recusa quando o sharp não reconheceu formato nenhum", () => {
    expect(validateImage({ format: undefined, size: 1024 })).toEqual({
      ok: false,
      error: "Use JPG, PNG ou WebP",
    });
  });

  it("recusa arquivo acima de 5MB", () => {
    expect(validateImage({ format: "webp", size: MAX_IMAGE_BYTES + 1 })).toEqual({
      ok: false,
      error: "Imagem até 5MB",
    });
  });

  it("recusa arquivo vazio", () => {
    expect(validateImage({ format: "webp", size: 0 }).ok).toBe(false);
  });

  it("aceita exatamente no teto", () => {
    expect(validateImage({ format: "webp", size: MAX_IMAGE_BYTES }).ok).toBe(true);
  });
});

describe("buildPostImagePath", () => {
  it("monta o caminho com post e nome único, sempre .webp", () => {
    expect(buildPostImagePath(POST_ID, NAME)).toBe(`posts/${POST_ID}/${NAME}.webp`);
  });

  it("recusa id de post que não é uuid (ele vira pasta no disco)", () => {
    for (const id of ["..", "../..", "a/b", "", "novo", `${POST_ID}/..`, NAME.toUpperCase()]) {
      expect(() => buildPostImagePath(id, NAME), id).toThrow();
    }
    // There is no folder for a post that does not exist yet: the post is created before the
    // editor opens, so every image belongs to one.
    expect(() => buildPostImagePath(null as unknown as string, NAME)).toThrow();
    expect(() => buildPostImagePath(undefined as unknown as string, NAME)).toThrow();
  });

  it("recusa nome de arquivo que não é uuid", () => {
    for (const name of ["..", "a/b", "foto.png", "", "a\\b", `${NAME}\\..`]) {
      expect(() => buildPostImagePath(POST_ID, name), name).toThrow();
    }
  });

  it("o caminho montado vira um endereço /media aceito", () => {
    const url = mediaUrl(buildPostImagePath(POST_ID, NAME));
    expect(url).toBe(`/media/posts/${POST_ID}/${NAME}.webp`);
    expect(isMediaPath(url)).toBe(true);
  });
});

describe("isMediaPath", () => {
  it("aceita caminho relativo à raiz sob /media/", () => {
    for (const path of ["/media/a.webp", "/media/posts/novo/a.webp", "/media/og/Post_1.webp"]) {
      expect(isMediaPath(path), path).toBe(true);
    }
  });

  it("recusa endereço absoluto, relativo a protocolo e outros esquemas", () => {
    for (const path of [
      "https://ash.app.br/media/a.webp",
      "http://evil.example/media/a.webp",
      "//evil.example/media/a.webp",
      "data:image/png;base64,AAAA",
      "javascript:alert(1)",
    ]) {
      expect(isMediaPath(path), path).toBe(false);
    }
  });

  it("recusa travessia de diretório, codificada ou não", () => {
    for (const path of [
      "/media/../x",
      "/media/posts/../../x",
      "/media/..",
      "/media/./a.webp",
      "/media/%2e%2e/x",
      "/media/a%2Fb.webp",
      "/media/a\\..\\b.webp",
      "/media/a\\b.webp",
      "/media\\a.webp",
      "/media//evil.example/a.webp",
    ]) {
      expect(isMediaPath(path), path).toBe(false);
    }
  });

  it("recusa o que não começa exatamente em /media/", () => {
    for (const path of [
      "",
      "/media",
      "/media/",
      "media/a.webp",
      "/MEDIA/a.webp",
      "/mediax/a.webp",
      "/blog/a.webp",
      " /media/a.webp",
      "/media/a.webp ",
      "/media/a.webp?x=1",
      "/media/a.webp#x",
      "/media/a b.webp",
      "/media/a.webp\n",
    ]) {
      expect(isMediaPath(path), JSON.stringify(path)).toBe(false);
    }
  });
});
