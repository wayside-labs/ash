// build-worker.mjs bundles the worker with esbuild, and esbuild cannot carry a native module:
// one import of sharp anywhere the worker reaches and the image fails to start. sanitize-html is
// not native, but it has no business there either (the worker serves no HTML), and it is the
// usual way sharp's neighbours in src/blog get pulled in. This asks esbuild itself what the
// worker reaches, with the options of build-worker.mjs.
import { build } from "esbuild";

const FORBIDDEN = /(?:^|[\\/])node_modules[\\/](?:sharp|@img|sanitize-html)[\\/]/;
// App-only modules of ours: each one imports sharp or sanitize-html.
const APP_ONLY = /src[\\/]blog[\\/](?:upload|public|posts|lib[\\/]sanitize)\.ts$/;

async function reached(entry: string) {
  const result = await build({
    entryPoints: [entry],
    bundle: true,
    write: false,
    metafile: true,
    platform: "node",
    format: "esm",
    target: "node24",
    tsconfig: "tsconfig.json",
    logLevel: "silent",
    // Marked external so a violation shows up as a finding below instead of a build error about
    // a .node file.
    external: ["sharp"],
  });
  const inputs = Object.keys(result.metafile.inputs);
  const externals = Object.values(result.metafile.inputs).flatMap((input) =>
    input.imports.filter((i) => i.external).map((i) => i.path),
  );
  return { inputs, externals };
}

describe("o que o worker alcança", () => {
  it("nem sharp nem sanitize-html, e nenhum módulo nosso que seja só do app", async () => {
    const { inputs, externals } = await reached("src/worker/main.ts");
    // The scan is looking at the real graph: these must be there.
    expect(inputs).toContain("src/worker/main.ts");
    expect(inputs).toContain("src/blog/publish-due.ts");
    expect(inputs).toContain("src/blog/rebuild.ts");

    expect(inputs.filter((path) => FORBIDDEN.test(path))).toEqual([]);
    expect(inputs.filter((path) => APP_ONLY.test(path))).toEqual([]);
    expect(externals.filter((path) => /^(?:sharp|sanitize-html)(?:\/|$)/.test(path))).toEqual([]);
  });

  it("o migrador também não", async () => {
    const { inputs, externals } = await reached("src/db/migrate.ts");
    expect(inputs.filter((path) => FORBIDDEN.test(path))).toEqual([]);
    expect(externals.filter((path) => /^(?:sharp|sanitize-html)(?:\/|$)/.test(path))).toEqual([]);
  });

  it("o teste enxerga uma violação: o módulo de upload alcança o sharp", async () => {
    const { inputs, externals } = await reached("src/blog/upload.ts");
    expect(externals).toContain("sharp");
    expect(inputs.some((path) => APP_ONLY.test(path))).toBe(true);
    const viaPosts = await reached("src/blog/posts.ts");
    expect(viaPosts.inputs.some((path) => FORBIDDEN.test(path))).toBe(true);
  });
});
