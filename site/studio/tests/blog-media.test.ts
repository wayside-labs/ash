import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GET } from "@/app/media/[...path]/route";
import { readMedia } from "@/blog/media";
import { env } from "@/lib/env";
import { surfaceFor } from "@/lib/hosts";

vi.mock("@/lib/env", () => ({ env: vi.fn() }));

const POST = "11111111-2222-4333-8444-555555555555";
const NAME = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const BYTES = Buffer.from("RIFF\u0010\u0000\u0000\u0000WEBPVP8 pretend");
const SECRET = Buffer.from("TOP SECRET, outside the uploads root");

describe("servir /media", () => {
  let base: string;
  let root: string;
  beforeAll(async () => {
    base = await mkdtemp(join(tmpdir(), "ash-studio-media-"));
    root = join(base, "uploads");
    await mkdir(join(root, "posts", POST), { recursive: true });
    await writeFile(join(root, "posts", POST, `${NAME}.webp`), BYTES);
    await writeFile(join(root, "posts", POST, "notes.txt"), "not an image");
    await writeFile(join(root, "posts", POST, ".hidden.webp"), BYTES);
    await mkdir(join(root, "posts", "dir.webp"));
    // What a traversal would be after: a file next to the root, and one in a sibling folder
    // whose name starts like the root's ("uploads-outros").
    await writeFile(join(base, "secret.webp"), SECRET);
    await mkdir(join(base, "uploads-outros"));
    await writeFile(join(base, "uploads-outros", "x.webp"), SECRET);
    await mkdir(join(base, "outside"));
    await writeFile(join(base, "outside", "x.webp"), SECRET);
    // A junction on Windows (no privilege needed), a plain symlink elsewhere: a link inside the
    // root that points out of it.
    await symlink(join(base, "outside"), join(root, "posts", "link"), "junction");
    vi.mocked(env).mockReturnValue({ UPLOADS_DIR: root } as ReturnType<typeof env>);
  });
  afterAll(async () => rm(base, { recursive: true, force: true }));

  const good = ["posts", POST, `${NAME}.webp`];

  it("devolve o arquivo que existe", async () => {
    expect(await readMedia(root, good)).toEqual(BYTES);
  });

  it("vale também com a raiz relativa ao diretório do processo", async () => {
    const cwd = process.cwd();
    process.chdir(base);
    try {
      expect(await readMedia("uploads", good)).toEqual(BYTES);
    } finally {
      process.chdir(cwd);
    }
  });

  const refused: Record<string, string[]> = {
    "nada": [],
    "arquivo que não existe": ["posts", POST, "bbbbbbbb-bbbb-4ccc-8ddd-eeeeeeeeeeee.webp"],
    "extensão que não é .webp": ["posts", POST, "notes.txt"],
    "extensão em maiúsculas": ["posts", POST, `${NAME}.WEBP`],
    "pasta com nome terminado em .webp": ["posts", "dir.webp"],
    "arquivo oculto": ["posts", POST, ".hidden.webp"],
    "..": ["..", "secret.webp"],
    ".. no meio": ["posts", "..", "..", "secret.webp"],
    ".. decodificado pelo Next num segmento só": ["../secret.webp"],
    "%2F ainda codificado": ["..%2Fsecret.webp"],
    "%2e%2e ainda codificado": ["%2e%2e", "secret.webp"],
    "barra invertida": ["..\\secret.webp"],
    "barra invertida dupla": ["posts\\..\\..\\secret.webp"],
    "segmento vazio": ["posts", "", `${NAME}.webp`],
    "ponto sozinho": ["posts", ".", POST, `${NAME}.webp`],
    "caminho absoluto posix": ["/etc/passwd.webp"],
    "caminho absoluto windows": ["C:", "Windows", "x.webp"],
    "letra de drive colada": [`C:${NAME}.webp`],
    "caminho UNC": ["\\\\server\\share\\x.webp"],
    "NUL no meio": ["posts", POST, `${NAME}.webp\u0000.txt`],
    "NUL antes da extensão": ["posts", POST, `${NAME}\u0000.webp`],
    "pasta irmã com o mesmo prefixo da raiz": ["..", "uploads-outros", "x.webp"],
    "link que aponta para fora da raiz": ["posts", "link", "x.webp"],
    "espaço e caractere fora do alfabeto": ["posts", POST, "a b.webp"],
    "fluxo alternativo do NTFS": ["posts", POST, `${NAME}.webp::$DATA`],
    "segmentos demais": [...Array<string>(20).fill("a"), "x.webp"],
    "segmento enorme": ["posts", `${"a".repeat(300)}.webp`],
  };
  for (const [label, segments] of Object.entries(refused)) {
    it(`recusa: ${label}`, async () => {
      expect(await readMedia(root, segments)).toBeNull();
    });
  }

  it("o link de teste existe mesmo: sem a checagem do caminho real ele serviria o arquivo de fora", async () => {
    const { readFile } = await import("node:fs/promises");
    expect(await readFile(join(root, "posts", "link", "x.webp"))).toEqual(SECRET);
  });

  describe("rota GET /media/[...path]", () => {
    const get = (path: string[]) =>
      GET(new Request("https://pub.example/media/x"), { params: Promise.resolve({ path }) });

    it("200 com tipo fixo, nosniff e cache imutável", async () => {
      const res = await get(good);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe("image/webp");
      expect(res.headers.get("x-content-type-options")).toBe("nosniff");
      expect(res.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
      expect(res.headers.get("content-length")).toBe(String(BYTES.length));
      expect(Buffer.from(await res.arrayBuffer())).toEqual(BYTES);
    });

    it("404 seco para tudo o que é recusado, sem cache e sem detalhe", async () => {
      for (const segments of Object.values(refused)) {
        const res = await get(segments);
        expect(res.status, segments.join("/")).toBe(404);
        const text = await res.text();
        expect(text).toBe("Not found");
        expect(text).not.toContain(base);
        expect(res.headers.get("cache-control")).toBe("no-store");
        expect(res.headers.get("x-content-type-options")).toBe("nosniff");
      }
    });

    it("raiz de uploads que não existe é 404, não erro", async () => {
      vi.mocked(env).mockReturnValueOnce({
        UPLOADS_DIR: join(base, "nao-existe"),
      } as ReturnType<typeof env>);
      expect((await get(good)).status).toBe(404);
    });
  });
});

describe("em que host cada rota do blog responde", () => {
  const hosts = { studio: "studio.ash.app.br", pub: "pub.ash.app.br" };

  it("upload só no painel; /media e a API pública nos dois", () => {
    expect(surfaceFor(hosts.pub, "/api/admin/upload", hosts)).toBe("deny");
    expect(surfaceFor(hosts.studio, "/api/admin/upload", hosts)).toBe("admin");
    for (const path of [`/media/posts/${POST}/${NAME}.webp`, "/api/public/posts"]) {
      expect(surfaceFor(hosts.pub, path, hosts), path).toBe("public");
      expect(surfaceFor(hosts.studio, path, hosts), path).toBe("admin");
    }
  });
});
