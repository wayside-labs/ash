import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { crc32 } from "node:zlib";
import { eq } from "drizzle-orm";
import sharp from "sharp";
import { POST } from "@/app/api/admin/upload/route";
import { NotFoundError, ValidationError } from "@/blog/errors";
import { MAX_IMAGE_BYTES, MAX_IMAGE_PIXELS, isMediaPath } from "@/blog/lib/image-rules";
import { createPost } from "@/blog/posts";
import { storeAuthorAvatar, storePostImage } from "@/blog/upload";
import { type Db, db as sharedDb } from "@/db/client";
import { auditLog } from "@/db/schema";
import { requireAdmin } from "@/lib/admin";
import { env } from "@/lib/env";
import { ACTOR, postInput, seedAuthor } from "./helpers/blog";
import { describeDb, freshDb } from "./helpers/db";

vi.mock("@/lib/admin", () => ({ requireAdmin: vi.fn() }));
vi.mock("@/lib/env", () => ({ env: vi.fn() }));
vi.mock("@/db/client", async (original) => ({
  ...(await original<typeof import("@/db/client")>()),
  db: vi.fn(),
}));

const MISSING = "00000000-0000-4000-8000-000000000000";
// Travels in the EXIF of the test photo; it must not be anywhere in what gets stored.
const EXIF_MARK = "SEGREDO-EXIF-0123";

const flat = (width: number, height: number) =>
  sharp({ create: { width, height, channels: 3, background: { r: 200, g: 40, b: 40 } } });

// A phone photo: landscape pixels, "rotate 90" in EXIF, GPS and a copyright string.
const photo = (width = 3000, height = 2000) =>
  flat(width, height)
    .withExif({
      IFD0: { Copyright: EXIF_MARK },
      IFD3: { GPSLatitudeRef: "S", GPSLatitude: "23/1 33/1 0/1", GPSLongitudeRef: "W" },
    })
    .withMetadata({ orientation: 6 })
    .jpeg()
    .toBuffer();

// A decompression bomb is a small file whose header promises a huge canvas. This is a real 1x1
// PNG with the IHDR dimensions rewritten (and its CRC fixed, or the decoder would stop there).
async function bombPng(side: number): Promise<Buffer> {
  const png = Buffer.from(await flat(1, 1).png().toBuffer());
  png.writeUInt32BE(side, 16);
  png.writeUInt32BE(side, 20);
  png.writeUInt32BE(crc32(png.subarray(12, 29)), 29);
  return png;
}

const GIF = Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64");
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>');

async function filesUnder(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { recursive: true, withFileTypes: true });
  return entries.filter((e) => e.isFile()).map((e) => e.name);
}

describeDb("upload de imagem do post", () => {
  let db: Db;
  let close: () => Promise<void>;
  let postId: string;
  let authorId: string;
  let uploadsDir: string;
  beforeAll(async () => {
    ({ db, close } = await freshDb());
    authorId = await seedAuthor(db);
    ({ id: postId } = await createPost(db, postInput(authorId), ACTOR));
  });
  afterAll(async () => close());
  beforeEach(async () => {
    uploadsDir = await mkdtemp(join(tmpdir(), "ash-studio-upload-"));
    await db.delete(auditLog);
    vi.mocked(requireAdmin).mockReset().mockResolvedValue({ email: ACTOR });
    vi.mocked(env)
      .mockReset()
      .mockReturnValue({
        UPLOADS_DIR: uploadsDir,
        STUDIO_HOST: "studio.example",
        NODE_ENV: "production",
      } as ReturnType<typeof env>);
    vi.mocked(sharedDb).mockReset().mockReturnValue(db);
  });
  afterEach(async () => rm(uploadsDir, { recursive: true, force: true }));

  const store = (bytes: Uint8Array, id: string = postId) =>
    storePostImage(db, { bytes, postId: id, actor: ACTOR, uploadsDir });
  const onDisk = (url: string) => readFile(join(uploadsDir, url.replace(/^\/media\//, "")));

  describe("avatar de autor", () => {
    const avatar = (bytes: Uint8Array, id: string = authorId) =>
      storeAuthorAvatar(db, { bytes, authorId: id, actor: ACTOR, uploadsDir });

    it("vai para a pasta do autor, com 512 de largura no máximo, sem EXIF, e audita com o id do autor", async () => {
      const stored = await avatar(await photo());
      expect(stored.url).toMatch(new RegExp(`^/media/autores/${authorId}/[0-9a-f-]{36}\\.webp$`));
      expect(isMediaPath(stored.url)).toBe(true);
      // The same 2000x3000 portrait as the post photo, reduced to the avatar's width.
      expect(stored).toMatchObject({ width: 512, height: 768 });
      const file = await onDisk(stored.url);
      expect(await sharp(file).metadata()).toMatchObject({ format: "webp", width: 512 });
      expect(file.includes(EXIF_MARK)).toBe(false);
      const logs = await db.select().from(auditLog);
      expect(logs).toHaveLength(1);
      expect(logs[0]).toMatchObject({ event: "blog.image_uploaded", actor: ACTOR });
      expect(logs[0]!.payload).toEqual({ authorId, ...stored });
    });

    it("o id tem de ser de um autor: o de um post, um que não existe e um que não é uuid são recusados", async () => {
      const png = await flat(10, 10).png().toBuffer();
      await expect(avatar(png, postId)).rejects.toThrow(NotFoundError);
      await expect(avatar(png, MISSING)).rejects.toThrow("Autor não encontrado");
      await expect(avatar(png, "novo")).rejects.toThrow(ValidationError);
      // And the other way round: an author's id is not a post.
      await expect(store(png, authorId)).rejects.toThrow("Post não encontrado");
      expect(await filesUnder(uploadsDir)).toEqual([]);
      expect(await db.select().from(auditLog)).toHaveLength(0);
    });

    it("as mesmas recusas da imagem de post: formato pelos bytes, tamanho e bomba", async () => {
      await expect(avatar(GIF)).rejects.toThrow("Use JPG, PNG ou WebP");
      await expect(avatar(SVG)).rejects.toThrow(ValidationError);
      await expect(avatar(Buffer.alloc(MAX_IMAGE_BYTES + 1))).rejects.toThrow("Imagem até 5MB");
      await expect(avatar(await bombPng(20_000))).rejects.toThrow(ValidationError);
      expect(await filesUnder(uploadsDir)).toEqual([]);
    });

    it("pela rota: author_id grava o avatar; junto de post_id é 400", async () => {
      const send = (fields: Record<string, string>, bytes: Uint8Array) => {
        const form = new FormData();
        form.set("file", new File([bytes as BlobPart], "foto.png", { type: "image/png" }));
        for (const [key, value] of Object.entries(fields)) form.set(key, value);
        return POST(
          new Request("https://studio.example/api/admin/upload", {
            method: "POST",
            body: form,
            headers: { origin: "https://studio.example", "sec-fetch-site": "same-origin" },
          }),
        );
      };
      const png = await flat(40, 40).png().toBuffer();
      const ok = await send({ author_id: authorId }, png);
      expect(ok.status).toBe(200);
      expect(((await ok.json()) as { url: string }).url).toMatch(
        new RegExp(`^/media/autores/${authorId}/`),
      );
      expect((await send({ author_id: authorId, post_id: postId }, png)).status).toBe(400);
      const wrong = await send({ author_id: postId }, png);
      expect(wrong.status).toBe(404);
      expect(await wrong.json()).toEqual({ ok: false, error: "Autor não encontrado" });
      expect(await filesUnder(uploadsDir)).toHaveLength(1);
    });
  });

  it("foto de celular: gira pelo EXIF, reduz para 1600 de largura, vira WebP, grava e audita", async () => {
    const stored = await store(await photo());
    expect(stored.url).toMatch(
      new RegExp(`^/media/posts/${postId}/[0-9a-f-]{36}\\.webp$`),
    );
    expect(isMediaPath(stored.url)).toBe(true);
    // 3000x2000 with "rotate 90" is a 2000x3000 portrait; 1600 wide keeps the ratio.
    expect(stored).toMatchObject({ width: 1600, height: 2400 });

    const file = await onDisk(stored.url);
    expect(file.length).toBe(stored.bytes);
    const meta = await sharp(file).metadata();
    expect(meta).toMatchObject({ format: "webp", width: 1600, height: 2400 });

    const logs = await db.select().from(auditLog).where(eq(auditLog.event, "blog.image_uploaded"));
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ actor: ACTOR });
    expect(logs[0]!.payload).toMatchObject({ postId, url: stored.url, width: 1600, height: 2400 });
  });

  it("EXIF, GPS e perfil não sobrevivem", async () => {
    const input = await photo(800, 600);
    // The premise: the metadata really is in what goes in.
    expect((await sharp(input).metadata()).exif).toBeDefined();
    expect(input.includes(EXIF_MARK)).toBe(true);

    const file = await onDisk((await store(input)).url);
    const meta = await sharp(file).metadata();
    expect(meta.exif).toBeUndefined();
    expect(meta.icc).toBeUndefined();
    expect(meta.xmp).toBeUndefined();
    expect(meta.iptc).toBeUndefined();
    expect(meta.orientation).toBeUndefined();
    expect(file.includes(EXIF_MARK)).toBe(false);
    expect(file.includes("EXIF")).toBe(false);
    expect(file.includes("Exif")).toBe(false);
  });

  it("imagem pequena não é ampliada; PNG e WebP também saem WebP", async () => {
    const png = await store(await flat(400, 300).png().toBuffer());
    expect(png).toMatchObject({ width: 400, height: 300 });
    expect((await sharp(await onDisk(png.url)).metadata()).format).toBe("webp");
    const webp = await store(await flat(1600, 10).webp().toBuffer());
    expect(webp).toMatchObject({ width: 1600, height: 10 });
  });

  it("id do post em maiúsculas vale, e a pasta sai em minúsculas", async () => {
    const stored = await store(await flat(10, 10).png().toBuffer(), postId.toUpperCase());
    expect(stored.url).toMatch(new RegExp(`^/media/posts/${postId}/[0-9a-f-]{36}\\.webp$`));
    expect((await onDisk(stored.url)).length).toBeGreaterThan(0);
  });

  it("post que não existe é NotFoundError, id que não é uuid é ValidationError, e nada é gravado", async () => {
    const bytes = await flat(10, 10).png().toBuffer();
    await expect(store(bytes, MISSING)).rejects.toThrow(NotFoundError);
    await expect(store(bytes, "../../etc")).rejects.toThrow(ValidationError);
    await expect(store(bytes, "novo")).rejects.toThrow(ValidationError);
    await expect(store(bytes, "")).rejects.toThrow(ValidationError);
    expect(await filesUnder(uploadsDir)).toEqual([]);
    expect(await db.select().from(auditLog)).toHaveLength(0);
  });

  it("o formato vem dos bytes: GIF, SVG, texto e lixo são recusados", async () => {
    const junk = Buffer.from("not an image at all, just text pretending".repeat(10));
    for (const bytes of [GIF, SVG, junk, Buffer.alloc(64)]) {
      await expect(store(bytes)).rejects.toThrow(ValidationError);
    }
    await expect(store(new Uint8Array(0))).rejects.toThrow("Arquivo vazio");
    expect(await filesUnder(uploadsDir)).toEqual([]);
    expect(await db.select().from(auditLog)).toHaveLength(0);
  });

  it("acima de 5 MB é recusado pelo tamanho, antes de decodificar", async () => {
    // Zeros: if this reached the decoder the error would be about the format, not the size.
    await expect(store(Buffer.alloc(MAX_IMAGE_BYTES + 1))).rejects.toThrow("Imagem até 5MB");
    expect(await filesUnder(uploadsDir)).toEqual([]);
  });

  it("bomba de descompressão: arquivo pequeno que declara uma tela enorme é recusado", async () => {
    const bomb = await bombPng(30_000);
    expect(bomb.length).toBeLessThan(1_000);
    expect(30_000 * 30_000).toBeGreaterThan(MAX_IMAGE_PIXELS);
    const started = Date.now();
    await expect(store(bomb)).rejects.toThrow(ValidationError);
    expect(Date.now() - started).toBeLessThan(5_000);
    expect(await filesUnder(uploadsDir)).toEqual([]);
  });

  describe("rota POST /api/admin/upload", () => {
    // What a browser on the studio sends with a same-origin fetch; the refusals of anything else
    // are in blog-upload-route.test.ts.
    const SAME_ORIGIN = { origin: "https://studio.example", "sec-fetch-site": "same-origin" };
    const request = (form: FormData, headers: Record<string, string> = {}) =>
      new Request("https://studio.example/api/admin/upload", {
        method: "POST",
        body: form,
        headers: { ...SAME_ORIGIN, ...headers },
      });
    const formWith = (bytes: Uint8Array, type = "image/jpeg", post: string | null = postId) => {
      const form = new FormData();
      form.set("file", new File([bytes as BlobPart], "foto.jpg", { type }));
      if (post !== null) form.set("post_id", post);
      return form;
    };

    it("sem admin, nada é lido nem gravado", async () => {
      vi.mocked(requireAdmin).mockRejectedValue(new Error("NEXT_HTTP_ERROR_FALLBACK;404"));
      const req = request(formWith(await flat(10, 10).png().toBuffer()));
      const spy = vi.spyOn(req, "formData");
      await expect(POST(req)).rejects.toThrow("NEXT_HTTP_ERROR_FALLBACK;404");
      expect(spy).not.toHaveBeenCalled();
      expect(sharedDb).not.toHaveBeenCalled();
      expect(await filesUnder(uploadsDir)).toEqual([]);
    });

    it("upload válido devolve o caminho relativo e grava com o e-mail do admin", async () => {
      const res = await POST(request(formWith(await photo(800, 600))));
      expect(res.status).toBe(200);
      const body = (await res.json()) as { ok: boolean; url: string; width: number; height: number };
      expect(body).toMatchObject({ ok: true, width: 600, height: 800 });
      expect(body.url).toMatch(new RegExp(`^/media/posts/${postId}/`));
      expect(res.headers.get("cache-control")).toBe("no-store");
      expect((await onDisk(body.url)).length).toBeGreaterThan(0);
      const [log] = await db.select().from(auditLog);
      expect(log).toMatchObject({ event: "blog.image_uploaded", actor: ACTOR });
    });

    it("sem post_id, ou com um que não é uuid, é 400 e nada é gravado nem auditado", async () => {
      for (const post of [null, "", "novo"]) {
        const res = await POST(request(formWith(await flat(10, 10).png().toBuffer(), "image/png", post)));
        expect(res.status, String(post)).toBe(400);
        expect(await res.json()).toEqual({ ok: false, error: "Post inválido." });
      }
      expect(await filesUnder(uploadsDir)).toEqual([]);
      expect(await db.select().from(auditLog)).toHaveLength(0);
    });

    it("o tipo declarado não vale nada: GIF dizendo que é JPEG é recusado com 400", async () => {
      const res = await POST(request(formWith(GIF, "image/jpeg")));
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ ok: false, error: "Use JPG, PNG ou WebP" });
      expect(await filesUnder(uploadsDir)).toEqual([]);
    });

    it("arquivo acima do teto é 413, e Content-Length acima do teto nem lê o corpo", async () => {
      const big = await POST(request(formWith(Buffer.alloc(MAX_IMAGE_BYTES + 1))));
      expect(big.status).toBe(413);
      expect(await big.json()).toEqual({ ok: false, error: "Imagem até 5MB" });

      const req = request(formWith(await flat(10, 10).png().toBuffer()), {
        "content-length": String(MAX_IMAGE_BYTES * 3),
      });
      const spy = vi.spyOn(req, "formData");
      const res = await POST(req);
      expect(res.status).toBe(413);
      expect(spy).not.toHaveBeenCalled();
    });

    it("pedido sem arquivo, com texto no lugar do arquivo ou sem multipart é 400", async () => {
      const empty = new FormData();
      expect((await POST(request(empty))).status).toBe(400);
      const text = new FormData();
      text.set("file", "isto não é um arquivo");
      expect((await POST(request(text))).status).toBe(400);
      const json = new Request("https://studio.example/api/admin/upload", {
        method: "POST",
        body: "{}",
        headers: { ...SAME_ORIGIN, "content-type": "application/json" },
      });
      const res = await POST(json);
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ ok: false, error: expect.any(String) });
    });

    it("post inexistente é 404 com mensagem, não exceção", async () => {
      const form = formWith(await flat(10, 10).png().toBuffer(), "image/png", MISSING);
      const res = await POST(request(form));
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ ok: false, error: "Post não encontrado" });
    });
  });
});
