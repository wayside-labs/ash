// Structural rules for everything under src/app, checked on the source so they cannot be
// forgotten in a new file:
//
// - route (route.ts): outside the public prefixes, the only exports are async function
//   declarations named after an HTTP method, each starting with `await requireAdmin()`, and each
//   one that is not GET or HEAD going on with the cross-site refusal. `export const POST = ...`,
//   re-exports and default exports are refused, not analysed: a guard hidden behind an
//   indirection is a guard this test cannot see.
// - page (page.tsx): outside the public prefixes, the default export and any other exported
//   function (generateMetadata runs before the page and reads data too) start with the guard.
// - layout (layout.tsx): NOT a place for the guard, on purpose. A layout does not run again on
//   client navigation, and the root layout also wraps the not-found page and the public pages to
//   come; a guard there would be false comfort or a broken public page. So a layout may import
//   neither the guard nor the database, and every page guards itself.
// - under a public prefix, nothing imports the guard: an admin route or page must not live there.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { PUBLIC_ROUTES } from "@/lib/hosts";

const APP = join("src", "app");

// lib/hosts.ts lists two kinds of entry, and they mean different things here too:
// - a prefix ends in "/" ("/api/public/"): everything under that folder is public;
// - an exact path does not ("/descadastro"): only the files of that one folder are public, and a
//   folder below it ("descadastro/admin/") is not, just as the proxy would not let it through.
// /api/health is the one extra exact path: internal and unauthenticated by design.
const toDir = (route: string) => `${route.replace(/^\/+|\/+$/g, "")}/`;
const PUBLIC_PREFIXES = PUBLIC_ROUTES.filter((route) => route.endsWith("/")).map(toDir);
const PUBLIC_EXACT = [...PUBLIC_ROUTES.filter((route) => !route.endsWith("/")), "/api/health"].map(
  toDir,
);
const isPublic = (relative: string) => {
  const folder = relative.slice(0, relative.lastIndexOf("/") + 1);
  return PUBLIC_PREFIXES.some((dir) => relative.startsWith(dir)) || PUBLIC_EXACT.includes(folder);
};

const METHODS = new Set(["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]);
const SAFE_METHODS = new Set(["GET", "HEAD"]);
// Route segment config, plus the two static metadata objects of a page.
const CONFIG = new Set([
  "dynamic",
  "dynamicParams",
  "revalidate",
  "fetchCache",
  "runtime",
  "preferredRegion",
  "maxDuration",
]);
const PAGE_CONFIG = new Set([...CONFIG, "metadata", "viewport"]);

const parse = (name: string, text: string) =>
  ts.createSourceFile(name, text, ts.ScriptTarget.Latest, true);
const has = (stmt: ts.Statement, kind: ts.SyntaxKind) =>
  ts.canHaveModifiers(stmt) && (ts.getModifiers(stmt) ?? []).some((m) => m.kind === kind);

const isCallTo = (node: ts.Expression | undefined, name: string): node is ts.CallExpression =>
  node !== undefined &&
  ts.isCallExpression(node) &&
  ts.isIdentifier(node.expression) &&
  node.expression.text === name;

// `await requireAdmin();` or `const who = await requireAdmin();`
function isGuard(stmt: ts.Statement | undefined): boolean {
  const awaited = (node: ts.Expression | undefined) =>
    node !== undefined &&
    ts.isAwaitExpression(node) &&
    isCallTo(node.expression, "requireAdmin") &&
    node.expression.arguments.length === 0;
  if (!stmt) return false;
  if (ts.isExpressionStatement(stmt)) return awaited(stmt.expression);
  if (ts.isVariableStatement(stmt)) {
    const decls = stmt.declarationList.declarations;
    return decls.length === 1 && awaited(decls[0]?.initializer);
  }
  return false;
}

// `const refused = refuseCrossSite(request);` then `if (refused) return refused;`, where
// `request` is the handler's first parameter.
function isCrossSiteRefusal(
  fn: ts.FunctionDeclaration,
  first: ts.Statement | undefined,
  second: ts.Statement | undefined,
): boolean {
  const param = fn.parameters[0]?.name;
  if (!param || !ts.isIdentifier(param)) return false;
  if (!first || !ts.isVariableStatement(first)) return false;
  const decl = first.declarationList.declarations[0];
  if (first.declarationList.declarations.length !== 1 || !decl || !ts.isIdentifier(decl.name)) {
    return false;
  }
  const call = decl.initializer;
  if (!isCallTo(call, "refuseCrossSite")) return false;
  const arg = call.arguments[0];
  if (call.arguments.length !== 1 || !arg || !ts.isIdentifier(arg) || arg.text !== param.text) {
    return false;
  }
  if (!second || !ts.isIfStatement(second) || second.elseStatement) return false;
  if (!ts.isIdentifier(second.expression) || second.expression.text !== decl.name.text) return false;
  const then = ts.isBlock(second.thenStatement)
    ? second.thenStatement.statements[0]
    : second.thenStatement;
  return (
    then !== undefined &&
    ts.isReturnStatement(then) &&
    then.expression !== undefined &&
    ts.isIdentifier(then.expression) &&
    then.expression.text === decl.name.text
  );
}

// Named, un-aliased, non-type import of `name` from `from`; and no local binding of that name.
function importsExactly(sf: ts.SourceFile, name: string, from: string, out: string[]): boolean {
  let found = false;
  for (const stmt of sf.statements) {
    if (ts.isImportDeclaration(stmt)) {
      const source = ts.isStringLiteral(stmt.moduleSpecifier) ? stmt.moduleSpecifier.text : "";
      const clause = stmt.importClause;
      const named = clause?.namedBindings;
      const local = [
        clause?.name?.text,
        named && ts.isNamespaceImport(named) ? named.name.text : undefined,
      ];
      if (local.includes(name)) out.push(`${name} is not the named export of ${from}`);
      for (const el of named && ts.isNamedImports(named) ? named.elements : []) {
        if (el.name.text !== name) continue;
        if (source === from && !el.propertyName && !clause?.isTypeOnly && !el.isTypeOnly) {
          found = true;
        } else out.push(`${name} is not the named export of ${from}`);
      }
      continue;
    }
    const declares =
      (ts.isFunctionDeclaration(stmt) && stmt.name?.text === name) ||
      (ts.isVariableStatement(stmt) &&
        stmt.declarationList.declarations.some((d) => d.name.getText(sf).includes(name)));
    if (declares) out.push(`${name} is redeclared locally`);
  }
  return found;
}

function exportedNames(stmt: ts.VariableStatement, sf: ts.SourceFile): string[] {
  return stmt.declarationList.declarations.map((d) => d.name.getText(sf));
}

function routeViolations(name: string, text: string): string[] {
  const sf = parse(name, text);
  const out: string[] = [];
  const guarded = importsExactly(sf, "requireAdmin", "@/lib/admin", out);
  if (!guarded) out.push("requireAdmin is not imported from @/lib/admin");
  let needsRefusal = false;

  for (const stmt of sf.statements) {
    if (ts.isExportDeclaration(stmt) || ts.isExportAssignment(stmt)) {
      out.push("re-export, export list or export assignment");
      continue;
    }
    if (!has(stmt, ts.SyntaxKind.ExportKeyword)) continue;
    if (ts.isVariableStatement(stmt)) {
      for (const exported of exportedNames(stmt, sf)) {
        if (!CONFIG.has(exported)) out.push(`export const ${exported}: not a function declaration`);
      }
      continue;
    }
    if (!ts.isFunctionDeclaration(stmt) || !stmt.body) {
      out.push("export that is neither a handler nor route config");
      continue;
    }
    if (has(stmt, ts.SyntaxKind.DefaultKeyword)) {
      out.push("default export");
      continue;
    }
    const method = stmt.name?.text ?? "";
    if (!METHODS.has(method)) out.push(`${method}: exported function that is not an HTTP method`);
    if (!has(stmt, ts.SyntaxKind.AsyncKeyword)) out.push(`${method}: not async`);
    if (stmt.parameters.some((p) => /requireAdmin|refuseCrossSite/.test(p.name.getText(sf)))) {
      out.push(`${method}: a parameter shadows a guard`);
    }
    const [first, second, third] = stmt.body.statements;
    if (!isGuard(first)) out.push(`${method}: first statement is not "await requireAdmin()"`);
    if (!SAFE_METHODS.has(method)) {
      needsRefusal = true;
      if (!isCrossSiteRefusal(stmt, second, third)) {
        out.push(`${method}: requireAdmin() is not followed by the refuseCrossSite(request) check`);
      }
    }
  }
  if (needsRefusal && !importsExactly(sf, "refuseCrossSite", "@/lib/same-origin", out)) {
    out.push("refuseCrossSite is not imported from @/lib/same-origin");
  }
  return out;
}

function pageViolations(name: string, text: string): string[] {
  const sf = parse(name, text);
  const out: string[] = [];
  if (!importsExactly(sf, "requireAdmin", "@/lib/admin", out)) {
    out.push("requireAdmin is not imported from @/lib/admin");
  }
  let hasDefault = false;
  for (const stmt of sf.statements) {
    if (ts.isExportDeclaration(stmt) || ts.isExportAssignment(stmt)) {
      out.push("re-export, export list or export assignment");
      continue;
    }
    if (!has(stmt, ts.SyntaxKind.ExportKeyword)) continue;
    if (ts.isVariableStatement(stmt)) {
      for (const exported of exportedNames(stmt, sf)) {
        if (!PAGE_CONFIG.has(exported)) out.push(`export const ${exported}: not page config`);
      }
      continue;
    }
    if (!ts.isFunctionDeclaration(stmt) || !stmt.body) {
      out.push("export that is neither a function declaration nor page config");
      continue;
    }
    const fn = stmt.name?.text ?? "default";
    if (has(stmt, ts.SyntaxKind.DefaultKeyword)) hasDefault = true;
    if (!has(stmt, ts.SyntaxKind.AsyncKeyword)) out.push(`${fn}: not async`);
    if (!isGuard(stmt.body.statements[0])) {
      out.push(`${fn}: first statement is not "await requireAdmin()"`);
    }
  }
  if (!hasDefault) out.push("no default export that is a function declaration");
  return out;
}

const importsOf = (name: string, text: string) =>
  parse(name, text)
    .statements.filter(ts.isImportDeclaration)
    .map((s) => (ts.isStringLiteral(s.moduleSpecifier) ? s.moduleSpecifier.text : ""));

// The layout rule, and the rule of every other file Next renders around or instead of a page:
// template, default, loading, and the error and status boundaries (error, global-error,
// not-found, forbidden, unauthorized). None of them is a place to decide who may see what, and
// several render exactly when the page's own guard refused, or for a visitor of the public host:
// with data in them they would show it to whoever got turned away.
const SHELL_KINDS = [
  "layout",
  "template",
  "default",
  "loading",
  "error",
  "global-error",
  "not-found",
  "forbidden",
  "unauthorized",
] as const;

function layoutViolations(name: string, text: string): string[] {
  return importsOf(name, text)
    .filter((source) => source === "@/lib/admin" || source.startsWith("@/db/"))
    .map((source) => `a layout or boundary file must not import ${source}`);
}

function publicViolations(name: string, text: string): string[] {
  // The import, not the word: these files say in a comment that they have no guard.
  return importsOf(name, text)
    .filter((source) => source === "@/lib/admin")
    .map(() => "admin code under a public prefix");
}

// A route under a public prefix is reachable by anyone, so it may only read: GET and HEAD, as
// function declarations. A public route that must accept a write (the newsletter's one-click
// unsubscribe is a POST by RFC 8058) is added here by path, on purpose and in review.
const PUBLIC_WRITE_ROUTES: Record<string, readonly string[]> = {};

function publicRouteViolations(name: string, text: string, allowed: readonly string[] = []): string[] {
  const sf = parse(name, text);
  const out = publicViolations(name, text);
  for (const stmt of sf.statements) {
    if (ts.isExportDeclaration(stmt) || ts.isExportAssignment(stmt)) {
      out.push("re-export, export list or export assignment");
      continue;
    }
    if (!has(stmt, ts.SyntaxKind.ExportKeyword)) continue;
    if (ts.isVariableStatement(stmt)) {
      for (const exported of exportedNames(stmt, sf)) {
        if (!CONFIG.has(exported)) out.push(`export const ${exported}: not a function declaration`);
      }
      continue;
    }
    if (!ts.isFunctionDeclaration(stmt) || has(stmt, ts.SyntaxKind.DefaultKeyword)) {
      out.push("export that is neither a handler nor route config");
      continue;
    }
    const method = stmt.name?.text ?? "";
    if (!SAFE_METHODS.has(method) && !allowed.includes(method)) {
      out.push(`${method}: a public route may only export GET and HEAD`);
    }
  }
  return out;
}

// Server actions written inline ("use server" at the top of a function body, in a page or a
// component) are refused everywhere, rather than checked: each one is a POST endpoint that no
// file listing shows. Actions live in files that start with "use server", and those are held to
// the guard rule by tests/blog-actions.test.ts, which scans all of src.
function inlineServerActions(name: string, text: string): string[] {
  const sf = parse(name, text);
  const found: string[] = [];
  const visit = (node: ts.Node) => {
    const body =
      ts.isFunctionLike(node) && "body" in node && node.body && ts.isBlock(node.body)
        ? node.body
        : undefined;
    if (body) {
      // The directive prologue: the leading string-literal statements of the body.
      for (const stmt of body.statements) {
        if (!ts.isExpressionStatement(stmt) || !ts.isStringLiteralLike(stmt.expression)) break;
        if (stmt.expression.text === "use server") {
          const { line } = sf.getLineAndCharacterOfPosition(stmt.getStart(sf));
          found.push(`inline "use server" at line ${line + 1}`);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
}

// Entry points this test has no rule for must not appear quietly:
// - metadata routes (sitemap.ts, robots.ts, opengraph-image.tsx, ...) are handlers under another
//   name: they run on request, on both hosts, and nothing above looks inside them;
// - a src/pages directory is the Pages Router, where none of these rules (nor the proxy's
//   assumptions about route handlers) were written for.
// Either one is added to its allowlist together with a rule for it.
const METADATA_RE =
  /(?:^|\/)(?:sitemap|robots|manifest|opengraph-image|twitter-image|icon|apple-icon)\d*\.(?:[cm]?[jt]s|[jt]sx)$/;
const ALLOWED_METADATA: readonly string[] = [];
const ALLOW_PAGES_ROUTER = false;

function unruledEntryPoints(
  appRelatives: readonly string[],
  srcEntries: readonly string[],
  allow: { metadata?: readonly string[]; pagesRouter?: boolean } = {},
): string[] {
  const out = appRelatives
    .filter((relative) => METADATA_RE.test(relative) && !(allow.metadata ?? []).includes(relative))
    .map((relative) => `metadata route without a rule: ${relative}`);
  if (srcEntries.includes("pages") && !allow.pagesRouter) out.push("src/pages (Pages Router)");
  return out;
}

const SOURCE_RE = /\.(?:[cm]?[jt]s|[jt]sx)$/;
function appFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return appFiles(path);
    return SOURCE_RE.test(entry.name) && !/\.test\.[^.]+$/.test(entry.name) ? [path] : [];
  });
}
const KIND_RE = new RegExp(`(?:^|/)(route|page|${SHELL_KINDS.join("|")})\\.[^./]+$`);
// "shell" is a layout or any of the other files held to the layout rule.
const kindOf = (relative: string): "route" | "page" | "shell" | undefined => {
  const name = KIND_RE.exec(relative)?.[1];
  if (name === undefined) return undefined;
  return name === "route" || name === "page" ? name : "shell";
};

const ROUTE = `import { requireAdmin } from "@/lib/admin";
import { refuseCrossSite } from "@/lib/same-origin";
export const dynamic = "force-dynamic";
export async function GET() {
  await requireAdmin();
  return new Response("ok");
}
export async function POST(request: Request) {
  const { email } = await requireAdmin();
  const refused = refuseCrossSite(request);
  if (refused) return refused;
  return new Response(email);
}
`;

const PAGE = `import { requireAdmin } from "@/lib/admin";
export const dynamic = "force-dynamic";
export const metadata = { title: "x" };
export async function generateMetadata() {
  await requireAdmin();
  return {};
}
export default async function Page() {
  const who = await requireAdmin();
  return who.email;
}
`;

describe("o verificador de rotas de admin", () => {
  it("aceita o formato certo", () => {
    expect(routeViolations("route.ts", ROUTE)).toEqual([]);
    // A route with only GET needs no cross-site check, and no import of it.
    const onlyGet = ROUTE.slice(0, ROUTE.indexOf("export async function POST")).replace(
      'import { refuseCrossSite } from "@/lib/same-origin";\n',
      "",
    );
    expect(routeViolations("route.ts", onlyGet)).toEqual([]);
  });

  const guard = "  const { email } = await requireAdmin();\n";
  const refusal = "  const refused = refuseCrossSite(request);\n  if (refused) return refused;\n";
  const bad: Record<string, string> = {
    "GET sem guarda": ROUTE.replace("  await requireAdmin();\n", ""),
    "POST sem guarda": ROUTE.replace(guard, ""),
    "guarda depois de outra instrução": ROUTE.replace(guard, `  const x = 1;\n${guard}`),
    "POST sem a checagem de origem": ROUTE.replace(refusal, ""),
    "checagem de origem antes da guarda": ROUTE.replace(guard + refusal, refusal + guard),
    "checagem de origem sem o return": ROUTE.replace("  if (refused) return refused;\n", ""),
    "checagem de origem ignorada": ROUTE.replace("if (refused) return refused;", "if (refused) {}"),
    "checagem de origem com outro argumento": ROUTE.replace(
      "refuseCrossSite(request)",
      "refuseCrossSite(new Request('https://studio.example'))",
    ),
    "checagem de origem de outro módulo": ROUTE.replace("@/lib/same-origin", "./fake"),
    "guarda de outro módulo": ROUTE.replace("@/lib/admin", "./fake"),
    "guarda com outro nome": ROUTE.replace("{ requireAdmin }", "{ noop as requireAdmin }"),
    "guarda redeclarada": `${ROUTE}async function requireAdmin() {}\n`,
    "export const POST": `${ROUTE}export const PUT = async () => new Response("x");\n`,
    "export const com arrow e guarda dentro": `${ROUTE}export const DELETE = async (request: Request) => { await requireAdmin(); return new Response("x"); };\n`,
    "re-export": `${ROUTE}export { POST as PUT } from "./outra";\n`,
    "export de lista": `${ROUTE}async function hidden() {}\nexport { hidden as DELETE };\n`,
    "export *": `${ROUTE}export * from "./outra";\n`,
    "export default": `${ROUTE}export default async function handler() { await requireAdmin(); }\n`,
    "export = / export default expressão": `${ROUTE}export default {};\n`,
    "função exportada que não é método HTTP": `${ROUTE}export async function helper() { await requireAdmin(); }\n`,
    "handler não async": ROUTE.replace("export async function GET", "export function GET"),
    "PUT sem a checagem de origem": `${ROUTE}export async function PUT(request: Request) {\n  await requireAdmin();\n  return new Response("x");\n}\n`,
    "DELETE sem a checagem de origem": `${ROUTE}export async function DELETE(request: Request) {\n  await requireAdmin();\n  return new Response("x");\n}\n`,
  };
  for (const [label, text] of Object.entries(bad)) {
    it(`recusa: ${label}`, () => {
      expect(routeViolations("route.ts", text)).not.toEqual([]);
    });
  }
});

describe("o verificador de páginas e layouts", () => {
  it("aceita a página certa", () => {
    expect(pageViolations("page.tsx", PAGE)).toEqual([]);
  });

  const bad: Record<string, string> = {
    "página sem guarda": PAGE.replace("  const who = await requireAdmin();\n", "  const who = { email: '' };\n"),
    "generateMetadata sem guarda": PAGE.replace("  await requireAdmin();\n  return {};", "  return {};"),
    "default como arrow": PAGE.replace(
      /export default async function Page\(\) \{[\s\S]*$/,
      "const Page = async () => { await requireAdmin(); return null; };\nexport default Page;\n",
    ),
    "sem default": PAGE.slice(0, PAGE.indexOf("export default")),
    "export const fora da configuração": `${PAGE}export const loader = async () => 1;\n`,
    "re-export": `${PAGE}export { something } from "./outra";\n`,
    "guarda de outro módulo": PAGE.replace("@/lib/admin", "./fake"),
    "página não async": PAGE.replace("export default async function", "export default function"),
  };
  for (const [label, text] of Object.entries(bad)) {
    it(`recusa a página: ${label}`, () => {
      expect(pageViolations("page.tsx", text)).not.toEqual([]);
    });
  }

  it("layout não pode importar a guarda nem o banco", () => {
    const layout = 'import "./globals.css";\nexport default function Root() { return null; }\n';
    expect(layoutViolations("layout.tsx", layout)).toEqual([]);
    expect(
      layoutViolations("layout.tsx", `import { requireAdmin } from "@/lib/admin";\n${layout}`),
    ).not.toEqual([]);
    expect(layoutViolations("layout.tsx", `import { db } from "@/db/client";\n${layout}`)).not.toEqual(
      [],
    );
  });

  it("os outros arquivos que o Next renderiza em volta da página seguem a regra do layout", () => {
    const names = [
      "template.tsx",
      "default.tsx",
      "loading.tsx",
      "error.tsx",
      "global-error.tsx",
      "not-found.tsx",
      "forbidden.tsx",
      "unauthorized.tsx",
      "painel/blog/error.tsx",
      "painel/@modal/default.jsx",
    ];
    for (const name of [...names, "layout.tsx", "painel/layout.tsx"]) {
      expect(kindOf(name), name).toBe("shell");
    }
    expect(kindOf("page.tsx")).toBe("page");
    expect(kindOf("api/x/route.ts")).toBe("route");
    // Names that only look like one of them are ordinary modules.
    for (const name of ["errors.ts", "my-error.tsx", "loading-bar.tsx", "not-found-list.tsx", "globals.css"]) {
      expect(kindOf(name), name).toBeUndefined();
    }

    const shell = '"use client";\nexport default function Boundary() { return null; }\n';
    expect(layoutViolations("error.tsx", shell)).toEqual([]);
    for (const bad of [
      'import { requireAdmin } from "@/lib/admin";\n',
      'import { db } from "@/db/client";\n',
      'import { blogPosts } from "@/db/schema";\n',
    ]) {
      expect(layoutViolations("not-found.tsx", `${bad}${shell}`), bad).not.toEqual([]);
    }
  });

  it("debaixo de prefixo público nada importa a guarda", () => {
    expect(publicViolations("route.ts", "// no requireAdmin() here\nexport async function GET() {}\n")).toEqual([]);
    expect(publicViolations("route.ts", ROUTE)).not.toEqual([]);
  });
});

describe("o verificador de rotas públicas", () => {
  const PUBLIC = `import { env } from "@/lib/env";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  return new Response("ok");
}
export function HEAD() {
  return new Response(null);
}
`;

  it("aceita GET e HEAD", () => {
    expect(publicRouteViolations("route.ts", PUBLIC)).toEqual([]);
  });

  const bad: Record<string, string> = {
    POST: `${PUBLIC}export async function POST() { return new Response("x"); }\n`,
    PUT: `${PUBLIC}export async function PUT() { return new Response("x"); }\n`,
    PATCH: `${PUBLIC}export async function PATCH() { return new Response("x"); }\n`,
    DELETE: `${PUBLIC}export async function DELETE() { return new Response("x"); }\n`,
    OPTIONS: `${PUBLIC}export async function OPTIONS() { return new Response("x"); }\n`,
    "export const POST": `${PUBLIC}export const POST = async () => new Response("x");\n`,
    // GET itself, but as a const: allowed method, refused form.
    "export const GET": PUBLIC.replace(
      /export async function GET\(request: Request\) \{[\s\S]*?\n\}\n/,
      'export const GET = async () => new Response("ok");\n',
    ),
    "export const com nome que não é configuração": `${PUBLIC}export const GET2 = async () => new Response("x");\n`,
    "re-export de um POST": `${PUBLIC}export { POST } from "../../admin/upload/route";\n`,
    "export *": `${PUBLIC}export * from "../../admin/upload/route";\n`,
    "export default": `${PUBLIC}export default async function handler() {}\n`,
    "importa a guarda": `import { requireAdmin } from "@/lib/admin";\n${PUBLIC}`,
  };
  for (const [label, text] of Object.entries(bad)) {
    it(`recusa: ${label}`, () => {
      expect(publicRouteViolations("route.ts", text)).not.toEqual([]);
    });
  }

  it("um POST público só passa se o caminho estiver na lista, e só esse método", () => {
    const withPost = `${PUBLIC}export async function POST() { return new Response("x"); }\n`;
    expect(publicRouteViolations("route.ts", withPost, ["POST"])).toEqual([]);
    expect(publicRouteViolations("route.ts", withPost, ["PUT"])).not.toEqual([]);
    // Nothing is on the list today.
    expect(PUBLIC_WRITE_ROUTES).toEqual({});
  });
});

describe("o verificador de server actions embutidas", () => {
  it("arquivo sem diretiva embutida passa, mesmo falando dela em texto e comentário", () => {
    const clean = `// "use server" is not used here
const label = "use server";
export default async function Page() {
  const text = "use server";
  return text + label;
}
`;
    expect(inlineServerActions("page.tsx", clean)).toEqual([]);
    // The file-level directive is the allowed form; it is not "inline".
    expect(inlineServerActions("actions.ts", '"use server";\nexport async function a() {}\n')).toEqual([]);
  });

  const bad: Record<string, string> = {
    "função dentro da página": `export default async function Page() {
  async function save(formData: FormData) {
    "use server";
    await db.insert(formData);
  }
  return <form action={save} />;
}
`,
    "arrow function": `export default function Page() {
  const save = async () => {
    'use server';
  };
  return <form action={save} />;
}
`,
    "action passada direto na prop": `export default function Page() {
  return <form action={async () => { "use server"; }} />;
}
`,
    "depois de outra diretiva": `export async function save() {
  "use strict";
  "use server";
}
`,
    "método de objeto": `export const actions = {
  async save() {
    "use server";
  },
};
`,
    "em componente fora de src/app": `export function Editor() {
  async function upload() {
    "use server";
  }
  return <button formAction={upload} />;
}
`,
  };
  for (const [label, text] of Object.entries(bad)) {
    it(`recusa: ${label}`, () => {
      expect(inlineServerActions("x.tsx", text)).toHaveLength(1);
    });
  }
});

describe("pontos de entrada sem regra", () => {
  it("nada a dizer do que existe hoje em forma", () => {
    expect(
      unruledEntryPoints(
        ["page.tsx", "layout.tsx", "api/health/route.ts", "icon.png", "blog/sitemap-notes.md"],
        ["app", "blog", "db", "lib", "proxy.ts"],
      ),
    ).toEqual([]);
  });

  it("recusa rota de metadados em qualquer pasta e extensão de código", () => {
    for (const relative of [
      "sitemap.ts",
      "robots.ts",
      "manifest.ts",
      "opengraph-image.tsx",
      "blog/[slug]/opengraph-image.tsx",
      "twitter-image.jsx",
      "icon.tsx",
      "icon2.tsx",
      "apple-icon.js",
      "api/public/sitemap.mts",
    ]) {
      expect(unruledEntryPoints([relative], ["app"]), relative).toHaveLength(1);
    }
    // Lookalikes that are not metadata routes.
    for (const relative of ["sitemap-helper.ts", "my-robots.ts", "icons.tsx", "icon.png"]) {
      expect(unruledEntryPoints([relative], ["app"]), relative).toEqual([]);
    }
  });

  it("recusa src/pages", () => {
    expect(unruledEntryPoints([], ["app", "pages"])).toEqual(["src/pages (Pages Router)"]);
  });

  it("só passa o que estiver na lista, e só isso", () => {
    expect(unruledEntryPoints(["sitemap.ts"], ["app"], { metadata: ["sitemap.ts"] })).toEqual([]);
    expect(unruledEntryPoints(["robots.ts"], ["app"], { metadata: ["sitemap.ts"] })).toHaveLength(1);
    expect(unruledEntryPoints([], ["pages"], { pagesRouter: true })).toEqual([]);
  });
});

describe("src/app inteiro", () => {
  const files = appFiles(APP).map((path) => ({
    path,
    relative: path.slice(APP.length + 1).replaceAll("\\", "/"),
  }));

  it("os prefixos públicos vêm de lib/hosts.ts", () => {
    expect(PUBLIC_PREFIXES).toEqual(["api/public/", "newsletter/", "media/"]);
    expect(PUBLIC_EXACT).toEqual(["descadastro/", "api/health/"]);
    expect(isPublic("api/public/posts/route.ts")).toBe(true);
    expect(isPublic("media/[...path]/route.ts")).toBe(true);
    expect(isPublic("api/admin/upload/route.ts")).toBe(false);
    expect(isPublic("page.tsx")).toBe(false);
  });

  it("caminho exato em hosts.ts é exato: a pasta sim, o que está abaixo dela não", () => {
    expect(isPublic("descadastro/page.tsx")).toBe(true);
    expect(isPublic("descadastro/route.ts")).toBe(true);
    expect(isPublic("api/health/route.ts")).toBe(true);
    // The proxy answers 404 to /descadastro/admin on the public host, so a file there is an
    // admin file like any other, and gets the admin rules.
    expect(isPublic("descadastro/admin/page.tsx")).toBe(false);
    expect(isPublic("descadastro/[token]/route.ts")).toBe(false);
    expect(isPublic("api/health/debug/route.ts")).toBe(false);
    // A sibling that only starts like it is not public either.
    expect(isPublic("descadastro-falso/page.tsx")).toBe(false);
    // A prefix, by contrast, covers everything below.
    expect(isPublic("newsletter/confirmar/[token]/page.tsx")).toBe(true);
  });

  it("toda rota, página e layout segue a regra do seu tipo", () => {
    const seen = { route: 0, page: 0, shell: 0, public: 0 };
    for (const { path, relative } of files) {
      const text = readFileSync(path, "utf8");
      const kind = kindOf(relative);
      if (isPublic(relative)) {
        seen.public += 1;
        const violations =
          kind === "route"
            ? publicRouteViolations(path, text, PUBLIC_WRITE_ROUTES[relative])
            : kind === "shell"
              ? layoutViolations(path, text)
              : publicViolations(path, text);
        expect(violations, relative).toEqual([]);
        continue;
      }
      if (!kind) continue;
      seen[kind] += 1;
      const violations =
        kind === "route"
          ? routeViolations(path, text)
          : kind === "page"
            ? pageViolations(path, text)
            : layoutViolations(path, text);
      expect(violations, relative).toEqual([]);
    }
    // The scan found what exists today; a count of zero would mean it is looking in the wrong place.
    expect(seen.route).toBeGreaterThanOrEqual(1);
    expect(seen.page).toBeGreaterThanOrEqual(1);
    expect(seen.shell).toBeGreaterThanOrEqual(1);
    expect(seen.public).toBeGreaterThanOrEqual(3);
  });

  it("src inteiro: nenhuma server action embutida em função", () => {
    const all = appFiles("src");
    // The scan covers more than src/app: components and libs can carry an inline action too.
    expect(all.some((path) => !path.startsWith(APP))).toBe(true);
    for (const path of all) {
      expect(inlineServerActions(path, readFileSync(path, "utf8")), path).toEqual([]);
    }
  });

  it("nenhuma rota de metadados nem src/pages sem estar na lista", () => {
    expect(
      unruledEntryPoints(
        files.map((f) => f.relative),
        readdirSync("src"),
        { metadata: ALLOWED_METADATA, pagesRouter: ALLOW_PAGES_ROUTER },
      ),
    ).toEqual([]);
    // The App Router of this package is src/app; a top-level pages/ or app/ would be another one.
    expect(readdirSync(".").filter((entry) => entry === "pages" || entry === "app")).toEqual([]);
  });

  it("nenhum outro arquivo de src/app exporta um handler por fora das regras", () => {
    // A file that is not route/page/layout cannot be an entry point; one named like a method
    // export elsewhere is a sign of a handler assembled by re-export.
    for (const { path, relative } of files) {
      if (kindOf(relative) || isPublic(relative)) continue;
      const sf = parse(path, readFileSync(path, "utf8"));
      for (const stmt of sf.statements) {
        if (ts.isFunctionDeclaration(stmt) && has(stmt, ts.SyntaxKind.ExportKeyword)) {
          expect(METHODS.has(stmt.name?.text ?? ""), `${relative}: ${stmt.name?.text}`).toBe(false);
        }
      }
    }
  });
});
