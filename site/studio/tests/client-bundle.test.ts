// A client component can only import what runs in a browser. sanitize-html and sharp must never
// reach that bundle, and neither may a Node builtin or the database layer (Drizzle, postgres-js,
// the schema). Next would catch some of it at build time, but the build does not run on every
// machine (see README, "Build"), and a module that merely bloats the bundle is not an error to
// it. This asks esbuild what each module reaches, as tests/worker-bundle.test.ts does.
import { readFileSync, readdirSync } from "node:fs";
import { builtinModules } from "node:module";
import { join } from "node:path";
import { type BuildOptions, type Plugin, build } from "esbuild";
import ts from "typescript";

// Modules with no directive of their own that client components import. Every file that starts
// with "use client" is found by the scan below and needs no entry here; this list is for a
// module worth holding to the rule before (or without) a client file importing it.
const CLIENT_SAFE = [
  "src/blog/lib/href.ts",
  "src/blog/schemas.ts",
  "src/blog/lib/format-date.ts",
  "src/blog/lib/list-query.ts",
  "src/blog/lib/list-rows.ts",
  "src/blog/lib/local-time.ts",
  "src/blog/lib/post-status.ts",
  "src/blog/lib/short-slug.ts",
  "src/blog/lib/field-error.ts",
  "src/blog/lib/image-rules.ts",
  "src/blog/lib/shortcode-html.ts",
  "src/blog/components/editor/extensions.ts",
  "src/blog/components/editor/shortcode-node.ts",
  "src/blog/components/editor/upload-image.ts",
  "src/lib/hosts.ts",
  "src/ui/button.tsx",
  "src/ui/field.tsx",
  "src/ui/notice.tsx",
  "src/ui/status-badge.tsx",
  "src/ui/tabs.tsx",
];

const FORBIDDEN_PACKAGE = /(?:^|[\\/])node_modules[\\/](?:sharp|@img|sanitize-html)[\\/]/;
const DB_LAYER = /(?:^|[\\/])src[\\/]db[\\/]/;
// Ours, and for the server alone: the environment (it holds every secret the app reads) and the
// guard (it reads request headers). A client file that reaches either is shipping, or trying to
// run, server code.
const SERVER_ONLY = /(?:^|[\\/])src[\\/]lib[\\/](?:env|admin|admin-token)\.ts$/;
// The parts of Next that only exist in a request on the server.
const SERVER_ONLY_NEXT = new Set(["next/headers", "next/server", "next/cache"]);
const BUILTINS = new Set(builtinModules);
const isNodeOnly = (specifier: string) =>
  specifier.startsWith("node:") ||
  BUILTINS.has(specifier) ||
  /^(?:sharp|sanitize-html)(?:\/|$)/.test(specifier);

// The directive prologue: the leading string statements of the file.
function hasDirective(path: string, text: string, directive: string): boolean {
  const sf = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, false);
  for (const stmt of sf.statements) {
    if (!ts.isExpressionStatement(stmt) || !ts.isStringLiteralLike(stmt.expression)) return false;
    if (stmt.expression.text === directive) return true;
  }
  return false;
}

// A "use server" file is where the client bundle ends: Next replaces the import with a stub that
// calls the server, and none of its code (nor the database behind it) is shipped. So the walk
// stops there, exactly as the real bundle does. Anything else a client file imports is followed.
const serverActionBoundary: Plugin = {
  name: "server-action-boundary",
  setup(pluginBuild) {
    pluginBuild.onResolve({ filter: /.*/ }, async (args) => {
      if (args.pluginData?.resolving) return undefined;
      const resolved = await pluginBuild.resolve(args.path, {
        resolveDir: args.resolveDir,
        kind: args.kind,
        importer: args.importer,
        pluginData: { resolving: true },
      });
      if (resolved.errors.length > 0 || resolved.external) return undefined;
      if (!/[\\/]src[\\/].*\.[cm]?[jt]sx?$/.test(resolved.path)) return undefined;
      if (!hasDirective(resolved.path, readFileSync(resolved.path, "utf8"), "use server")) {
        return undefined;
      }
      return { path: resolved.path, external: true };
    });
  },
};

async function violations(source: string | { stdin: string }): Promise<string[]> {
  const entry: BuildOptions =
    typeof source === "string"
      ? { entryPoints: [source] }
      : { stdin: { contents: source.stdin, resolveDir: "src", sourcefile: "probe.tsx", loader: "tsx" } };
  const result = await build({
    ...entry,
    bundle: true,
    write: false,
    metafile: true,
    // "node" on purpose: builtins then resolve as externals and show up as findings below,
    // instead of failing the build with a message about a missing module.
    platform: "node",
    format: "esm",
    jsx: "automatic",
    tsconfig: "tsconfig.json",
    logLevel: "silent",
    // The framework is the bundler's business, not ours: what Next and React ship to the browser
    // for these imports is decided by them.
    external: ["sharp", "react", "react/*", "react-dom", "react-dom/*", "next", "next/*"],
    plugins: [serverActionBoundary],
  });
  const out: string[] = [];
  for (const [path, input] of Object.entries(result.metafile.inputs)) {
    if (FORBIDDEN_PACKAGE.test(path) || DB_LAYER.test(path) || SERVER_ONLY.test(path)) out.push(path);
    for (const imported of input.imports) {
      if (imported.external && (isNodeOnly(imported.path) || SERVER_ONLY_NEXT.has(imported.path))) {
        out.push(`${path} -> ${imported.path}`);
      }
    }
  }
  return out;
}

const SOURCE_RE = /\.(?:[cm]?[jt]s|[jt]sx)$/;
function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name).replaceAll("\\", "/");
    if (entry.isDirectory()) return sourceFiles(path);
    return SOURCE_RE.test(entry.name) && !/\.test\.[^.]+$/.test(entry.name) ? [path] : [];
  });
}

const CLIENT_FILES = sourceFiles("src").filter((path) =>
  hasDirective(path, readFileSync(path, "utf8"), "use client"),
);

describe("o que um componente cliente pode importar", () => {
  it('a varredura acha os arquivos "use client" de src', () => {
    // Zero would mean the scan is looking in the wrong place, and every check below is vacuous.
    expect(CLIENT_FILES.length).toBeGreaterThanOrEqual(10);
    for (const known of [
      "src/ui/dialog.tsx",
      "src/ui/nav.tsx",
      "src/blog/components/post-list.tsx",
      "src/blog/components/schedule-dialog.tsx",
    ]) {
      expect(CLIENT_FILES, known).toContain(known);
    }
    // A test file is not shipped, and a file that only mentions the directive is not a client file.
    expect(CLIENT_FILES.some((path) => /\.test\./.test(path))).toBe(false);
    expect(hasDirective("x.tsx", '// "use client"\nexport {};\n', "use client")).toBe(false);
    expect(hasDirective("x.tsx", 'const a = "use client";\n', "use client")).toBe(false);
    expect(hasDirective("x.tsx", '"use strict";\n"use client";\n', "use client")).toBe(true);
  });

  for (const entry of CLIENT_FILES) {
    it(`${entry} ("use client") não alcança sanitize-html, sharp, módulo do Node nem o banco`, async () => {
      expect(await violations(entry)).toEqual([]);
    });
  }

  for (const entry of CLIENT_SAFE) {
    it(`${entry} não alcança sanitize-html, sharp, módulo do Node nem o banco`, async () => {
      expect(await violations(entry)).toEqual([]);
    });
  }

  it("o teste enxerga cada tipo de violação", async () => {
    const sanitize = await violations("src/blog/lib/sanitize.ts");
    expect(sanitize.some((v) => FORBIDDEN_PACKAGE.test(v))).toBe(true);

    const upload = await violations("src/blog/upload.ts");
    expect(upload).toContain("src/blog/upload.ts -> sharp");
    expect(upload).toContain("src/blog/upload.ts -> node:crypto");
    expect(upload.some((v) => DB_LAYER.test(v) && !v.includes(" -> "))).toBe(true);

    // The schema alone, with no driver: still the database layer, still refused.
    expect(await violations("src/db/schema.ts")).toContain("src/db/schema.ts");
  });

  it("um componente cliente que importa o que não pode é pego, direto ou por tabela", async () => {
    const client = (imports: string) =>
      violations({ stdin: `"use client";\n${imports}\nexport function Probe() { return <p />; }\n` });

    expect((await client('import { sanitizePostHtml } from "@/blog/lib/sanitize";\nvoid sanitizePostHtml;')).some((v) => FORBIDDEN_PACKAGE.test(v))).toBe(true);
    expect((await client('import { db } from "@/db/client";\nvoid db;')).some((v) => DB_LAYER.test(v))).toBe(true);
    expect(await client('import { readFileSync } from "node:fs";\nvoid readFileSync;')).toContain(
      "src/probe.tsx -> node:fs",
    );
    // Through a core: posts.ts looks harmless in the import line and brings the database along.
    const viaCore = await client('import { listPosts } from "@/blog/posts";\nvoid listPosts;');
    expect(viaCore.some((v) => DB_LAYER.test(v))).toBe(true);
    expect(viaCore.some((v) => FORBIDDEN_PACKAGE.test(v))).toBe(true);
    // A type-only import is erased and brings nothing.
    expect(await client('import type { PostRow } from "@/blog/posts";\nexport type X = PostRow;')).toEqual([]);
  });

  it("um componente cliente que alcança o ambiente, a guarda ou os cabeçalhos do pedido é pego", async () => {
    const client = (imports: string) =>
      violations({ stdin: `"use client";\n${imports}\nexport function Probe() { return <p />; }\n` });

    // env() holds every secret the app reads.
    expect(await client('import { env } from "@/lib/env";\nvoid env;')).toContain("src/lib/env.ts");
    // The guard, and through it next/headers.
    const guard = await client('import { requireAdmin } from "@/lib/admin";\nvoid requireAdmin;');
    expect(guard).toContain("src/lib/admin.ts");
    expect(guard).toContain("src/lib/admin.ts -> next/headers");
    expect(await client('import { headers } from "next/headers";\nvoid headers;')).toContain(
      "src/probe.tsx -> next/headers",
    );
    expect(await client('import { refresh } from "next/cache";\nvoid refresh;')).toContain(
      "src/probe.tsx -> next/cache",
    );
    // By way of a module that looks like a helper: same-origin.ts reads the environment.
    expect(
      await client('import { refuseCrossSite } from "@/lib/same-origin";\nvoid refuseCrossSite;'),
    ).toContain("src/lib/env.ts");
    // What a client component does import from next is fine.
    expect(
      await client('import Link from "next/link";\nimport { useRouter } from "next/navigation";\nvoid Link; void useRouter;'),
    ).toEqual([]);
    // hosts.ts is in src/lib too, and is plain data: not everything there is server-only.
    expect(await client('import { PUBLIC_ROUTES } from "@/lib/hosts";\nvoid PUBLIC_ROUTES;')).toEqual([]);
  });

  it('a fronteira é só o arquivo "use server": o que está atrás dele não conta, o resto conta', async () => {
    const viaAction = await violations({
      stdin: '"use client";\nimport { createPost } from "@/blog/actions/posts";\nvoid createPost;\n',
    });
    expect(viaAction).toEqual([]);
    // The same core, imported without the action in between, is a violation.
    const direct = await violations({
      stdin: '"use client";\nimport { createPost } from "@/blog/posts";\nvoid createPost;\n',
    });
    expect(direct.some((v) => DB_LAYER.test(v))).toBe(true);
  });
});
