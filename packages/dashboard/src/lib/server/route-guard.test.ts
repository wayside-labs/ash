import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The guard is a per-route call, so the thing that can go wrong is forgetting it
 * on route number fourteen. This test is what a `middleware.ts` would have given
 * for free — and unlike middleware, it also holds for the handler tests, which
 * call `POST(new Request(...))` directly and never run middleware at all.
 *
 * The rule is mechanical on purpose: every mutating method, no judgement about
 * whether a particular POST "really" mutates. `POST /api/solana/balances` only
 * reads, and is still in — a rule that needs an argument per route gets one.
 */

const API_ROOT = join(import.meta.dirname, "../../app/api");
const MUTATING = ["POST", "PATCH", "DELETE"] as const;

/**
 * Machine-to-machine routes: an agent's MCP calls them with a workflow ingest token and no
 * cookie, so there is no browser session for a cross-site request to ride. Each must
 * authenticate the bearer instead — and must stay on this list, not escape the sweep.
 */
const BEARER_ROUTES = new Set([
  "ingest/events/route.ts",
  "ingest/reviews/[intentId]/route.ts",
  "ingest/knowledge/route.ts",
]);

/** Read-only, and still guarded: it is the one route that emits whole env values. */
const GUARDED_READS = [["export/runner-config/route.ts", "GET"]] as const;

function routeFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) found.push(...routeFiles(path));
    else if (entry === "route.ts") found.push(path);
  }
  return found;
}

/** The source of one exported handler: from its signature to the next export. */
function handlerBody(source: string, method: string): string | null {
  const start = source.search(new RegExp(`export (async )?function ${method}\\b`));
  if (start === -1) return null;
  const rest = source.slice(start);
  const next = rest.slice(1).search(/\nexport /);
  return next === -1 ? rest : rest.slice(0, next + 1);
}

describe("every mutating route handler calls assertSameOrigin", () => {
  const files = routeFiles(API_ROOT);

  it("lists only bearer routes that exist", () => {
    const relatives = new Set(files.map((file) => file.slice(API_ROOT.length + 1)));
    for (const route of BEARER_ROUTES) expect(relatives.has(route)).toBe(true);
  });

  it("finds the routes at all, so an empty sweep cannot pass silently", () => {
    expect(files.length).toBeGreaterThanOrEqual(13);
  });

  for (const file of files) {
    const source = readFileSync(file, "utf8");
    const relative = file.slice(API_ROOT.length + 1);

    for (const method of MUTATING) {
      const body = handlerBody(source, method);
      if (body === null) continue;
      it(`${method} ${relative}`, () => {
        expect(body).toContain(
          BEARER_ROUTES.has(relative) ? "authenticateIngest(req)" : "assertSameOrigin(req)",
        );
      });
    }

    if (BEARER_ROUTES.has(relative)) {
      for (const method of ["GET", ...MUTATING]) {
        const body = handlerBody(source, method);
        if (body === null) continue;
        it(`${method} ${relative} authenticates its bearer`, () => {
          expect(body).toContain("authenticateIngest(req)");
        });
      }
    }
  }

  for (const [relative, method] of GUARDED_READS) {
    it(`${method} ${relative}`, () => {
      const body = handlerBody(readFileSync(join(API_ROOT, relative), "utf8"), method);
      expect(body).toContain("assertSameOrigin(req)");
    });
  }
});
