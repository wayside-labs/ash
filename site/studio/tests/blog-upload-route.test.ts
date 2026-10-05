// No database here: the route's own decisions (who may call it, what it reads, what it answers)
// over a Db that answers from memory. The same route against real rows, and the image pipeline,
// are in blog-upload.test.ts.
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { POST } from "@/app/api/admin/upload/route";
import { ValidationError } from "@/blog/errors";
import { MAX_IMAGE_BYTES } from "@/blog/lib/image-rules";
import { storePostImage } from "@/blog/upload";
import { type Db, db as sharedDb } from "@/db/client";
import { requireAdmin } from "@/lib/admin";
import { env } from "@/lib/env";

vi.mock("@/lib/admin", () => ({ requireAdmin: vi.fn() }));
vi.mock("@/lib/env", () => ({ env: vi.fn() }));
vi.mock("@/db/client", () => ({ db: vi.fn() }));
vi.mock("node:fs/promises", async (original) => {
  const real = await original<typeof import("node:fs/promises")>();
  return { ...real, default: real, writeFile: vi.fn(real.writeFile) };
});

const POST_ID = "11111111-2222-4333-8444-555555555555";
const ACTOR = "admin@example.com";
const SAME_ORIGIN = { origin: "https://studio.example", "sec-fetch-site": "same-origin" };

// The two things storePostImage asks of the database: does the post exist, and the audit insert.
function fakeDb(opts: { postExists?: boolean; auditFails?: boolean } = {}) {
  const audited: unknown[] = [];
  const handle = {
    select: () => ({
      from: () => ({ where: async () => (opts.postExists === false ? [] : [{ id: POST_ID }]) }),
    }),
    insert: () => ({
      values: (row: unknown) => ({
        returning: async () => {
          if (opts.auditFails) throw new Error("audit insert failed");
          audited.push(row);
          return [{ id: 1 }];
        },
      }),
    }),
  };
  return { db: handle as unknown as Db, audited };
}

const png = () =>
  sharp({ create: { width: 20, height: 10, channels: 3, background: "#c82828" } }).png().toBuffer();

async function filesUnder(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { recursive: true, withFileTypes: true });
  return entries.filter((e) => e.isFile()).map((e) => e.name);
}

describe("POST /api/admin/upload, sem banco", () => {
  let uploadsDir: string;
  let fake: ReturnType<typeof fakeDb>;
  beforeEach(async () => {
    uploadsDir = await mkdtemp(join(tmpdir(), "ash-studio-upload-route-"));
    fake = fakeDb();
    vi.mocked(requireAdmin).mockReset().mockResolvedValue({ email: ACTOR });
    vi.mocked(env)
      .mockReset()
      .mockReturnValue({
        UPLOADS_DIR: uploadsDir,
        STUDIO_HOST: "studio.example",
        NODE_ENV: "production",
      } as ReturnType<typeof env>);
    vi.mocked(sharedDb).mockReset().mockReturnValue(fake.db);
  });
  afterEach(async () => rm(uploadsDir, { recursive: true, force: true }));

  const form = async (post: string | null = POST_ID) => {
    const data = new FormData();
    data.set("file", new File([(await png()) as BlobPart], "foto.png", { type: "image/png" }));
    if (post !== null) data.set("post_id", post);
    return data;
  };
  const request = (body: FormData, headers: Record<string, string> = SAME_ORIGIN) =>
    new Request("https://studio.example/api/admin/upload", { method: "POST", body, headers });

  it("mesma origem: 200, JSON sem cache e com nosniff, arquivo gravado e auditado", async () => {
    const res = await POST(request(await form()));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    const body = (await res.json()) as { ok: boolean; url: string };
    expect(body.url).toMatch(new RegExp(`^/media/posts/${POST_ID}/[0-9a-f-]{36}\\.webp$`));
    expect(await filesUnder(uploadsDir)).toHaveLength(1);
    expect(fake.audited).toHaveLength(1);
    expect(fake.audited[0]).toMatchObject({ event: "blog.image_uploaded", actor: ACTOR });
  });

  describe("pedido forjado de outro site", () => {
    const refused: Record<string, Record<string, string>> = {
      "nenhum dos dois cabeçalhos": {},
      "Sec-Fetch-Site cross-site": { "sec-fetch-site": "cross-site" },
      "Sec-Fetch-Site same-site (o host público)": {
        origin: "https://studio.example",
        "sec-fetch-site": "same-site",
      },
      "Origin de outro site": { origin: "https://evil.example" },
      "Origin de outro site com Sec-Fetch-Site same-origin": {
        origin: "https://evil.example",
        "sec-fetch-site": "same-origin",
      },
      "Origin do host público": { origin: "https://pub.example", "sec-fetch-site": "same-origin" },
      "Origin null": { origin: "null" },
      "Origin em http": { origin: "http://studio.example" },
    };
    for (const [label, headers] of Object.entries(refused)) {
      it(`403 e nada lido nem gravado: ${label}`, async () => {
        const req = request(await form(), headers);
        const spy = vi.spyOn(req, "formData");
        const res = await POST(req);
        expect(res.status).toBe(403);
        expect(res.headers.get("x-content-type-options")).toBe("nosniff");
        expect(spy).not.toHaveBeenCalled();
        expect(sharedDb).not.toHaveBeenCalled();
        expect(await filesUnder(uploadsDir)).toEqual([]);
      });
    }

    it("a checagem de origem vem depois do admin: sem admin nem chega a ela", async () => {
      vi.mocked(requireAdmin).mockRejectedValue(new Error("NEXT_HTTP_ERROR_FALLBACK;404"));
      await expect(POST(request(await form(), {}))).rejects.toThrow("NEXT_HTTP_ERROR_FALLBACK;404");
    });
  });

  describe("tamanho do pedido", () => {
    it("Content-Length acima do teto: 413 sem ler o corpo", async () => {
      const req = request(await form(), {
        ...SAME_ORIGIN,
        "content-length": String(MAX_IMAGE_BYTES * 3),
      });
      const spy = vi.spyOn(req, "formData");
      const res = await POST(req);
      expect(res.status).toBe(413);
      expect(res.headers.get("x-content-type-options")).toBe("nosniff");
      expect(spy).not.toHaveBeenCalled();
    });

    it("Content-Length que não é número: 400 sem ler o corpo", async () => {
      for (const value of ["muito", "-1", "1e9", "12abc"]) {
        const req = request(await form(), { ...SAME_ORIGIN, "content-length": value });
        const spy = vi.spyOn(req, "formData");
        expect((await POST(req)).status, value).toBe(400);
        expect(spy).not.toHaveBeenCalled();
      }
    });

    it("sem Content-Length (envio em pedaços) o corpo é lido, e quem decide é o tamanho do arquivo", async () => {
      // A Request built from FormData carries no Content-Length header: this is that case.
      const small = request(await form());
      expect(small.headers.get("content-length")).toBeNull();
      expect((await POST(small)).status).toBe(200);

      const data = new FormData();
      data.set("file", new File([Buffer.alloc(MAX_IMAGE_BYTES + 1) as BlobPart], "grande.png"));
      const big = await POST(request(data));
      expect(big.status).toBe(413);
      expect(await big.json()).toEqual({ ok: false, error: "Imagem até 5MB" });
      expect(await filesUnder(uploadsDir)).toHaveLength(1);
    });

    it("Content-Length pequeno e mentiroso não passa: o tamanho do arquivo ainda barra", async () => {
      const data = new FormData();
      data.set("file", new File([Buffer.alloc(MAX_IMAGE_BYTES + 1) as BlobPart], "grande.png"));
      const res = await POST(request(data, { ...SAME_ORIGIN, "content-length": "10" }));
      expect(res.status).toBe(413);
    });

    it("corpo cortado no meio (o proxy só guarda até o limite): 400 legível, nada gravado", async () => {
      const boundary = "----ashtest";
      const head =
        `--${boundary}\r\n` +
        'Content-Disposition: form-data; name="file"; filename="foto.png"\r\n' +
        "Content-Type: image/png\r\n\r\n";
      // The part starts and never ends: no closing boundary.
      const truncated = Buffer.concat([Buffer.from(head), (await png()).subarray(0, 40)]);
      const req = new Request("https://studio.example/api/admin/upload", {
        method: "POST",
        body: truncated,
        headers: { ...SAME_ORIGIN, "content-type": `multipart/form-data; boundary=${boundary}` },
      });
      const res = await POST(req);
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ ok: false, error: expect.stringMatching(/grande demais|inválido/) });
      expect(await filesUnder(uploadsDir)).toEqual([]);
    });
  });

  it("post_id em maiúsculas é aceito e a pasta sai em minúsculas", async () => {
    const res = await POST(request(await form(POST_ID.toUpperCase())));
    expect(res.status).toBe(200);
    const { url } = (await res.json()) as { url: string };
    expect(url).toMatch(new RegExp(`^/media/posts/${POST_ID}/`));
    expect((fake.audited[0] as { payload: { postId: string } }).payload.postId).toBe(POST_ID);
  });

  describe("post_id é obrigatório", () => {
    const refusedWith400 = async (data: FormData, label: string) => {
      const res = await POST(request(data));
      expect(res.status, label).toBe(400);
      expect(await res.json(), label).toEqual({ ok: false, error: "Post inválido." });
      // Refused on the shape of the request alone: no query, no file, no audit row.
      expect(sharedDb, label).not.toHaveBeenCalled();
      expect(await filesUnder(uploadsDir), label).toEqual([]);
      expect(fake.audited, label).toEqual([]);
    };

    it("ausente ou vazio: 400, e nada é consultado nem gravado", async () => {
      await refusedWith400(await form(null), "ausente");
      await refusedWith400(await form(""), "vazio");
    });

    it("que não é uuid: 400, e nada é consultado nem gravado", async () => {
      for (const value of ["novo", "nao-e-uuid", "../../etc", `${POST_ID}/..`, ` ${POST_ID}`]) {
        await refusedWith400(await form(value), value);
      }
    });

    it("arquivo no lugar do texto: 400", async () => {
      const data = await form(null);
      data.set("post_id", new File(["x"], "post_id.txt"));
      await refusedWith400(data, "arquivo");
    });
  });

  it("post que não existe: 404 com mensagem", async () => {
    vi.mocked(sharedDb).mockReturnValue(fakeDb({ postExists: false }).db);
    const res = await POST(request(await form()));
    expect(res.status).toBe(404);
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(await res.json()).toEqual({ ok: false, error: "Post não encontrado" });
  });

  // The avatar branch: author_id instead of post_id, never next to it. It must not be a way
  // around the post rule.
  describe("author_id (avatar)", () => {
    const avatarForm = async (author: string | File) => {
      const data = await form(null);
      data.set("author_id", author);
      return data;
    };
    const untouched = async (label: string) => {
      expect(sharedDb, label).not.toHaveBeenCalled();
      expect(await filesUnder(uploadsDir), label).toEqual([]);
      expect(fake.audited, label).toEqual([]);
    };

    it("autor que existe: grava na pasta de autores e audita com o id do autor", async () => {
      const res = await POST(request(await avatarForm(POST_ID.toUpperCase())));
      expect(res.status).toBe(200);
      const { url } = (await res.json()) as { url: string };
      expect(url).toMatch(new RegExp(`^/media/autores/${POST_ID}/[0-9a-f-]{36}\\.webp$`));
      expect((fake.audited[0] as { payload: Record<string, unknown> }).payload).toMatchObject({
        authorId: POST_ID,
        url,
      });
      expect((fake.audited[0] as { payload: Record<string, unknown> }).payload).not.toHaveProperty(
        "postId",
      );
    });

    it("que não é uuid, vazio ou arquivo: 400, e nada é consultado nem gravado", async () => {
      for (const value of ["", "novo", "../../etc", `${POST_ID}/..`, new File(["x"], "a.txt")]) {
        const res = await POST(request(await avatarForm(value)));
        expect(res.status, String(value)).toBe(400);
        expect(await res.json()).toEqual({ ok: false, error: "Autor inválido." });
        await untouched(String(value));
      }
    });

    it("post_id e author_id juntos: 400, mesmo com os dois válidos", async () => {
      const data = await form(POST_ID);
      data.set("author_id", POST_ID);
      const res = await POST(request(data));
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({
        ok: false,
        error: "Envie a imagem para um post ou para um autor, não para os dois.",
      });
      await untouched("os dois");
      // An invalid post_id next to a valid author_id is still the two together, not an avatar.
      const mixed = await form("novo");
      mixed.set("author_id", POST_ID);
      expect((await POST(request(mixed))).status).toBe(400);
      await untouched("post inválido + autor");
    });

    it("autor que não existe: 404 com mensagem", async () => {
      vi.mocked(sharedDb).mockReturnValue(fakeDb({ postExists: false }).db);
      const res = await POST(request(await avatarForm(POST_ID)));
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ ok: false, error: "Autor não encontrado" });
      expect(await filesUnder(uploadsDir)).toEqual([]);
    });

    it("de outro site: 403, como qualquer envio", async () => {
      const res = await POST(
        request(await avatarForm(POST_ID), { origin: "https://evil.example", "sec-fetch-site": "cross-site" }),
      );
      expect(res.status).toBe(403);
      await untouched("cross-site");
    });
  });
});

describe("storePostImage: o arquivo e a auditoria andam juntos", () => {
  let uploadsDir: string;
  beforeEach(async () => {
    uploadsDir = await mkdtemp(join(tmpdir(), "ash-studio-upload-core-"));
    vi.mocked(writeFile).mockClear();
  });
  afterEach(async () => rm(uploadsDir, { recursive: true, force: true }));

  it("gravação que falha no meio não deixa arquivo pela metade", async () => {
    const real = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
    vi.mocked(writeFile).mockImplementationOnce(async (path, data) => {
      // Half of the bytes reach the disk, then the disk gives up.
      await real.writeFile(path, (data as Buffer).subarray(0, 8), { flag: "wx" });
      throw Object.assign(new Error("ENOSPC: no space left on device"), { code: "ENOSPC" });
    });
    const { db, audited } = fakeDb();
    await expect(
      storePostImage(db, { bytes: await png(), postId: POST_ID, actor: ACTOR, uploadsDir }),
    ).rejects.toThrow(/ENOSPC/);
    expect(await filesUnder(uploadsDir)).toEqual([]);
    expect(audited).toEqual([]);
  });

  it("id de post que não é uuid é ValidationError antes de qualquer consulta ou gravação", async () => {
    const select = vi.fn();
    const db = { select } as unknown as Db;
    for (const postId of ["novo", "", "../../etc"]) {
      await expect(
        storePostImage(db, { bytes: await png(), postId, actor: ACTOR, uploadsDir }),
      ).rejects.toThrow(ValidationError);
    }
    expect(select).not.toHaveBeenCalled();
    expect(await filesUnder(uploadsDir)).toEqual([]);
  });

  it("auditoria que falha apaga o arquivo já gravado", async () => {
    const { db } = fakeDb({ auditFails: true });
    await expect(
      storePostImage(db, { bytes: await png(), postId: POST_ID, actor: ACTOR, uploadsDir }),
    ).rejects.toThrow("audit insert failed");
    expect(await filesUnder(uploadsDir)).toEqual([]);
  });
});
