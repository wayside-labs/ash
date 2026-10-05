import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { BlogError, ValidationError } from "@/blog/errors";
import { toResult } from "@/blog/result";
import * as authorActions from "@/blog/actions/authors";
import * as categoryActions from "@/blog/actions/categories";
import * as postActions from "@/blog/actions/posts";
import * as statusActions from "@/blog/actions/status";
import { requireAdmin } from "@/lib/admin";
import { db } from "@/db/client";

vi.mock("@/lib/admin", () => ({ requireAdmin: vi.fn() }));
vi.mock("@/db/client", () => ({ db: vi.fn() }));

const SRC = "src";
const ACTIONS_DIR = join(SRC, "blog", "actions");

// Anywhere in the directive prologue (the leading string statements), not only first: a file
// that opens with "use strict" and then "use server" is a server-action file all the same.
const isUseServer = (sf: ts.SourceFile) => {
  for (const stmt of sf.statements) {
    if (!ts.isExpressionStatement(stmt) || !ts.isStringLiteralLike(stmt.expression)) return false;
    if (stmt.expression.text === "use server") return true;
  }
  return false;
};

const parse = (name: string, text: string) =>
  // No explicit ScriptKind: the extension decides (a .jsx file must be parsed as JSX).
  ts.createSourceFile(name, text, ts.ScriptTarget.Latest, true);

const isGuardCall = (node: ts.Expression | undefined) =>
  node !== undefined &&
  ts.isAwaitExpression(node) &&
  ts.isCallExpression(node.expression) &&
  ts.isIdentifier(node.expression.expression) &&
  node.expression.expression.text === "requireAdmin" &&
  node.expression.arguments.length === 0;

// `await requireAdmin();` or `const who = await requireAdmin();`, nothing else.
function isGuardStatement(stmt: ts.Statement | undefined): boolean {
  if (!stmt) return false;
  if (ts.isExpressionStatement(stmt)) return isGuardCall(stmt.expression);
  if (ts.isVariableStatement(stmt)) {
    const decls = stmt.declarationList.declarations;
    return decls.length === 1 && isGuardCall(decls[0]?.initializer);
  }
  return false;
}

// Every export of a "use server" file is a public POST endpoint. The rule is deliberately rigid:
// each export is an async function declaration whose FIRST statement awaits requireAdmin(), and
// requireAdmin is the one from @/lib/admin. Anything cleverer has to change this test first.
function violations(name: string, text: string): string[] {
  const sf = parse(name, text);
  const out: string[] = [];
  if (!isUseServer(sf)) out.push('does not start with "use server"');

  let guardImported = false;
  for (const stmt of sf.statements) {
    if (ts.isImportDeclaration(stmt)) {
      const from = ts.isStringLiteral(stmt.moduleSpecifier) ? stmt.moduleSpecifier.text : "";
      const named = stmt.importClause?.namedBindings;
      const elements = named && ts.isNamedImports(named) ? named.elements : [];
      for (const el of elements) {
        if (el.name.text !== "requireAdmin") continue;
        if (from === "@/lib/admin" && !el.propertyName && !stmt.importClause?.isTypeOnly) {
          guardImported = true;
        } else out.push("requireAdmin is not the export of @/lib/admin");
      }
      continue;
    }
    if (ts.isExportDeclaration(stmt) || ts.isExportAssignment(stmt)) {
      out.push("re-export or export assignment");
      continue;
    }
    if (ts.isFunctionDeclaration(stmt) && stmt.name?.text === "requireAdmin") {
      out.push("requireAdmin is redeclared locally");
    }
    if (ts.isVariableStatement(stmt)) {
      for (const d of stmt.declarationList.declarations) {
        if (d.name.getText(sf).includes("requireAdmin")) out.push("requireAdmin is redeclared locally");
      }
    }

    const exported =
      ts.canHaveModifiers(stmt) &&
      (ts.getModifiers(stmt) ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
    if (!exported) continue;
    if (!ts.isFunctionDeclaration(stmt) || !stmt.body) {
      out.push("export that is not a function declaration");
      continue;
    }
    const fn = stmt.name?.text ?? "default";
    const isAsync = (ts.getModifiers(stmt) ?? []).some(
      (m) => m.kind === ts.SyntaxKind.AsyncKeyword,
    );
    if (!isAsync) out.push(`${fn}: not async`);
    if (stmt.parameters.some((p) => p.name.getText(sf).includes("requireAdmin"))) {
      out.push(`${fn}: a parameter shadows requireAdmin`);
    }
    if (!isGuardStatement(stmt.body.statements[0])) {
      out.push(`${fn}: first statement is not "await requireAdmin()"`);
    }
  }
  if (!guardImported) out.push("requireAdmin is not imported from @/lib/admin");
  return out;
}

// Everything Next can compile into a server action, not just .ts: tsconfig has allowJs on.
const SOURCE_RE = /\.(?:[cm]?[jt]s|[jt]sx)$/;
const isSource = (name: string) => SOURCE_RE.test(name) && !/\.test\.[^.]+$/.test(name);

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return isSource(entry.name) ? [path] : [];
  });
}

const GOOD = `"use server";
import { requireAdmin } from "@/lib/admin";
export async function save(input: unknown) {
  const { email } = await requireAdmin();
  return email;
}
export async function remove(id: string) {
  await requireAdmin();
}
`;

describe("o verificador de server actions", () => {
  it("aceita o formato certo", () => {
    expect(violations("good.ts", GOOD)).toEqual([]);
  });

  it("olha toda extensão que o Next compila, menos os testes", () => {
    for (const name of ["a.ts", "a.tsx", "a.js", "a.jsx", "a.mjs", "a.cjs", "a.mts", "a.cts"]) {
      expect(isSource(name), name).toBe(true);
    }
    for (const name of ["a.test.ts", "a.test.tsx", "a.test.mjs", "a.css", "a.json", "a.d.md"]) {
      expect(isSource(name), name).toBe(false);
    }
  });

  it("acha a falta de guarda também em arquivo JavaScript", () => {
    const js = GOOD.replace(": unknown", "").replace(": string", "");
    expect(violations("good.mjs", js)).toEqual([]);
    expect(violations("bad.mjs", js.replace("  await requireAdmin();\n", ""))).not.toEqual([]);
    expect(violations("bad.jsx", js.replace("  await requireAdmin();\n", ""))).not.toEqual([]);
  });

  const bad: Record<string, string> = {
    "sem guarda": GOOD.replace("  await requireAdmin();\n", ""),
    "guarda depois de outra instrução": GOOD.replace(
      "  await requireAdmin();\n",
      "  const x = 1;\n  await requireAdmin();\n",
    ),
    "guarda sem await": GOOD.replace("  await requireAdmin();", "  requireAdmin();"),
    "guarda dentro de um if": GOOD.replace(
      "  await requireAdmin();",
      "  if (id) await requireAdmin();",
    ),
    "export const": `${GOOD}export const leak = async () => 1;\n`,
    "re-export": `${GOOD}export { listPosts } from "../posts";\n`,
    "export default": `${GOOD}export default async function () {}\n`,
    "sem a diretiva": GOOD.replace('"use server";\n', ""),
    "guarda de outro módulo": GOOD.replace("@/lib/admin", "./fake"),
    "guarda com outro nome importado": GOOD.replace(
      "{ requireAdmin }",
      "{ noop as requireAdmin }",
    ),
    "guarda redeclarada": `${GOOD}async function requireAdmin() {}\n`,
    "parâmetro que faz sombra": GOOD.replace(
      "remove(id: string)",
      "remove(requireAdmin: () => Promise<void>)",
    ),
    "função não async": GOOD.replace("export async function remove", "export function remove"),
  };
  for (const [label, text] of Object.entries(bad)) {
    it(`recusa: ${label}`, () => {
      expect(violations("bad.ts", text)).not.toEqual([]);
    });
  }
});

describe("server actions do blog", () => {
  const modules = {
    "authors.ts": authorActions,
    "categories.ts": categoryActions,
    "posts.ts": postActions,
    "status.ts": statusActions,
  } as Record<string, Record<string, (...args: unknown[]) => Promise<unknown>>>;

  beforeEach(() => {
    vi.mocked(requireAdmin).mockReset();
    vi.mocked(db).mockReset();
  });

  it('todo arquivo de src/blog/actions é "use server" e todo export chama requireAdmin() primeiro', () => {
    const files = readdirSync(ACTIONS_DIR).sort();
    // A new file must be added to `modules` above, so the runtime checks below cover it too.
    expect(files).toEqual(Object.keys(modules).sort());
    for (const file of files) {
      const path = join(ACTIONS_DIR, file);
      expect(violations(path, readFileSync(path, "utf8")), path).toEqual([]);
    }
  });

  it('nenhum outro arquivo de src é "use server" sem seguir a mesma regra', () => {
    for (const path of sourceFiles(SRC)) {
      const text = readFileSync(path, "utf8");
      // A directive inside a function body is another matter, refused by app-guards.test.ts.
      if (!isUseServer(parse(path, text))) continue;
      expect(violations(path, text), path).toEqual([]);
    }
  });

  // Route handlers, pages and layouts have their own rules in tests/app-guards.test.ts.

  it("sem admin, nenhuma action chega ao banco", async () => {
    vi.mocked(requireAdmin).mockRejectedValue(new Error("no admin"));
    vi.mocked(db).mockImplementation(() => {
      throw new Error("db touched");
    });
    let count = 0;
    for (const [file, mod] of Object.entries(modules)) {
      for (const [name, action] of Object.entries(mod)) {
        await expect(action("x", {}), `${file}:${name}`).rejects.toThrow("no admin");
        count += 1;
      }
    }
    expect(count).toBeGreaterThanOrEqual(9);
    expect(db).not.toHaveBeenCalled();
  });

  it("erro de validação volta como { ok: false, error }, não como exceção", async () => {
    vi.mocked(requireAdmin).mockResolvedValue({ email: "admin@example.com" });
    vi.mocked(db).mockReturnValue({} as ReturnType<typeof db>);
    for (const [file, mod] of Object.entries(modules)) {
      for (const [name, action] of Object.entries(mod)) {
        const result = await action("x", {});
        expect(result, `${file}:${name}`).toEqual({ ok: false, error: expect.any(String) });
      }
    }
  });
});

describe("toResult", () => {
  it("sucesso vira { ok: true, data }", async () => {
    expect(await toResult(async () => 7)).toEqual({ ok: true, data: 7 });
  });

  it("BlogError vira { ok: false } com a mensagem para a tela", async () => {
    expect(
      await toResult(async () => {
        throw new ValidationError("Título muito curto");
      }),
    ).toEqual({ ok: false, error: "Título muito curto" });
    expect(
      await toResult(async () => {
        throw new BlogError("x");
      }),
    ).toEqual({ ok: false, error: "x" });
  });

  it("qualquer outro erro continua sendo exceção", async () => {
    await expect(
      toResult(async () => {
        throw new Error("connection refused");
      }),
    ).rejects.toThrow("connection refused");
  });
});
