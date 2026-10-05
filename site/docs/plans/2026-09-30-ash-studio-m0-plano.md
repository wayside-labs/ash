# ash-studio M0 — esqueleto: plano de implementação

> **Para agentes:** SUB-SKILL OBRIGATÓRIA: superpowers:subagent-driven-development (recomendado) ou
> superpowers:executing-plans. Passos com checkbox (`- [ ]`).

**Objetivo:** app Next do ash-studio no ar em `studio.ash.app.br` (atrás do Cloudflare Access),
com Postgres próprio, fila durável, worker com batimento, `/api/health`, auditoria, deploy e backup —
a base onde M1–M3 (blog, IA, newsletter) vão entrar.

**Arquitetura:** pacote independente em `studio/` (lockfile próprio; o site na raiz não muda). Um
app Next 16 serve dois hostnames: o `proxy.ts` classifica cada pedido (admin, público, interno ou
negado) e o painel ainda confere o JWT do Access em cada página/rota (a doc do Next 16 diz que o
proxy não basta). Worker e migração são o mesmo código, empacotados com esbuild.

**Stack:** Next 16.3 · React 19.3 · Drizzle 0.45 + postgres 3.4 · zod 4 · jose 6 · Tailwind 4 ·
vitest 5 · esbuild · Postgres 17 · Docker Compose na VPS · cloudflared (túnel `ash` existente).

**Desenho:** `docs/plans/2026-09-30-ash-studio-desenho.md`. **Branch:** `feat/ash-studio`.

**Fatos conferidos em 30/09:** Zero Trust ativo (`ashhuman.cloudflareaccess.com`); túnel `ash`
remoto com ingress `ash.app.br`/`www` → `http://ash-web:80` e 404 no fim; rede Docker `ash`
existente; não há Docker no PC (integração roda contra Postgres real: service no CI, banco de teste
na VPS por túnel SSH aqui); padrão de backup em `algumacoisa-agentica/infra/ash-mail/backup/`;
Next 16 renomeou `middleware.ts` para `proxy.ts`, que roda em Node e **não** substitui a checagem
de autorização em cada rota (doc empacotada em `next/dist/docs/01-app/01-getting-started/16-proxy.md`).

**Correção ao desenho:** "pacote próprio num workspace pnpm" vira **pacote independente com
lockfile próprio** — o Docker da VPS builda só `studio/`, e o `pnpm install` do site não muda.

---

## Mapa de arquivos

```
studio/
├── package.json · pnpm-lock.yaml · tsconfig.json · next.config.ts · postcss.config.mjs
├── vitest.config.ts · drizzle.config.ts · build-worker.mjs · Dockerfile · .dockerignore
├── README.md                       como rodar, testar, publicar (PT)
├── drizzle/                        migrações geradas (versionadas)
├── public/.gitkeep
├── src/
│   ├── proxy.ts                    classifica host/rota; 404/403 antes de tudo
│   ├── lib/env.ts                  env validado por zod (preguiçoso: nada lê no build)
│   ├── lib/hosts.ts                surfaceFor(host, path) → admin | public | internal | deny
│   ├── lib/access.ts               verifyAdmin(token) — JWT do Access + lista de admins
│   ├── lib/admin.ts                adminFromToken / requireAdmin (atalho só em development)
│   ├── lib/health.ts               evaluateHealth(...) puro
│   ├── lib/expect-rows.ts          expectOne: update que não pega linha vira erro
│   ├── lib/audit.ts                logAudit(db, ...)
│   ├── db/schema.ts · db/client.ts · db/migrate.ts
│   ├── jobs/queue.ts               enqueue, claimNext (SKIP LOCKED), complete, fail, reapExpired
│   ├── worker/cycle.ts             runCycle(db, handlers) + batimento
│   ├── worker/handlers.ts          registro de handlers (M0: ping)
│   ├── worker/main.ts              laço de 60 s, SIGTERM
│   ├── app/layout.tsx · app/globals.css · app/page.tsx
│   └── app/api/health/route.ts
├── tests/helpers/db.ts             banco limpo + migrações; pula alto sem TEST_DATABASE_URL
└── deploy/
    ├── docker-compose.yml · deploy.sh · testdb.sh · cloudflare.md
    └── backup/{backup.sh,restore-test.sh,*.service,*.timer}
.github/workflows/studio.yml
```

---

### Task 1: Pacote, dependências e configs

**Files:** Create `studio/package.json`, `studio/tsconfig.json`, `studio/next.config.ts`,
`studio/postcss.config.mjs`, `studio/vitest.config.ts`, `studio/public/.gitkeep`; Modify `.gitignore`.

- [ ] **Step 1: package.json**

```json
{
  "name": "ash-studio",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "packageManager": "pnpm@9.12.0",
  "engines": { "node": ">=22" },
  "scripts": {
    "dev": "next dev -p 3100",
    "build": "next build && node build-worker.mjs",
    "start": "next start",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "db:generate": "drizzle-kit generate"
  }
}
```

- [ ] **Step 2: instalar (versões estáveis do dia; o lockfile fixa)**

```bash
cd studio
pnpm add next@16.3 react@19.3 react-dom@19.3 drizzle-orm@0.45 postgres@3.4 zod@4 jose@6 \
  @fontsource/inter@5 @fontsource/jetbrains-mono@5
pnpm add -D typescript@5.9 @types/node@24 @types/react@19 @types/react-dom@19 vitest@5 \
  drizzle-kit@0.31 esbuild tailwindcss@4 @tailwindcss/postcss@4
```

- [ ] **Step 3: tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2023",
    "lib": ["dom", "dom.iterable", "ES2023"],
    "module": "esnext",
    "moduleResolution": "bundler",
    "jsx": "preserve",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "skipLibCheck": true,
    "noEmit": true,
    "incremental": true,
    "isolatedModules": true,
    "resolveJsonModule": true,
    "esModuleInterop": true,
    "types": ["vitest/globals"],
    "plugins": [{ "name": "next" }],
    "paths": { "@/*": ["./src/*"] }
  },
  "include": ["next-env.d.ts", "src", "tests", ".next/types/**/*.ts", "*.ts", "*.mjs"],
  "exclude": ["node_modules", "dist"]
}
```

- [ ] **Step 4: next.config.ts, postcss.config.mjs, vitest.config.ts**

```ts
// next.config.ts
import type { NextConfig } from "next";

// standalone: the VPS image carries only the traced server, not node_modules.
const config: NextConfig = { output: "standalone", poweredByHeader: false };
export default config;
```

```js
// postcss.config.mjs
export default { plugins: { "@tailwindcss/postcss": {} } };
```

```ts
// vitest.config.ts
import { loadEnvFile } from "node:process";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// .env.test holds TEST_DATABASE_URL (deploy/testdb.sh). Missing is fine: tests/helpers/db.ts
// then says loudly that the database suites were skipped.
try {
  loadEnvFile(".env.test");
} catch {}

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: {
    globals: true,
    include: ["src/**/*.test.ts", "tests/**/*.test.ts"],
    // The integration suites share one database; running files in parallel would race on it.
    fileParallelism: false,
  },
});
```

- [ ] **Step 5: .gitignore (raiz) — acrescentar**

```
studio/.next/
studio/dist/
studio/next-env.d.ts
studio/*.tsbuildinfo
studio/uploads/
```

- [ ] **Step 6: conferir e commit**

Run: `cd studio && pnpm typecheck` → Expected: sem erros (ainda não há código).
```bash
git add .gitignore studio/package.json studio/pnpm-lock.yaml studio/tsconfig.json studio/next.config.ts \
  studio/postcss.config.mjs studio/vitest.config.ts studio/public/.gitkeep
git commit -m "chore(studio): pacote Next 16 independente com lockfile proprio"
```

### Task 2: Ambiente validado (`lib/env.ts`)

**Files:** Create `studio/src/lib/env.ts`, Test `studio/src/lib/env.test.ts`.

- [ ] **Step 1: teste que falha**

```ts
import { parseEnv } from "./env";

const base = {
  NODE_ENV: "production",
  DATABASE_URL: "postgres://u:p@db:5432/studio",
  STUDIO_HOST: "studio.ash.app.br",
  PUBLIC_HOST: "pub.ash.app.br",
  ACCESS_TEAM_DOMAIN: "ashhuman.cloudflareaccess.com",
  ACCESS_AUD: "aud-tag",
  STUDIO_ADMINS: " Lucas@Example.com , outra@example.com ",
};

describe("parseEnv", () => {
  it("normaliza a lista de admins", () => {
    expect(parseEnv(base).STUDIO_ADMINS).toEqual(["lucas@example.com", "outra@example.com"]);
  });
  it("e-mail ainda não ligado é 'none' por padrão", () => {
    expect(parseEnv(base).EMAIL_DRIVER).toBe("none");
  });
  it("recusa lista de admins vazia", () => {
    expect(() => parseEnv({ ...base, STUDIO_ADMINS: " , " })).toThrow();
  });
  it("recusa o atalho de admin fora de development", () => {
    expect(() => parseEnv({ ...base, STUDIO_DEV_ADMIN: "a@b.co" })).toThrow(/development/);
  });
  it("aceita o atalho de admin em development", () => {
    const e = parseEnv({ ...base, NODE_ENV: "development", STUDIO_DEV_ADMIN: "a@b.co" });
    expect(e.STUDIO_DEV_ADMIN).toBe("a@b.co");
  });
});
```

- [ ] **Step 2:** Run `pnpm vitest run src/lib/env.test.ts` → FAIL (módulo não existe).

- [ ] **Step 3: implementação**

```ts
import { z } from "zod";

const emailList = z
  .string()
  .transform((s) => s.split(",").map((x) => x.trim().toLowerCase()).filter(Boolean))
  .pipe(z.array(z.email()).min(1));

export const EnvSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    DATABASE_URL: z.url(),
    STUDIO_HOST: z.string().min(1),
    PUBLIC_HOST: z.string().min(1),
    ACCESS_TEAM_DOMAIN: z.string().min(1),
    ACCESS_AUD: z.string().min(1),
    STUDIO_ADMINS: emailList,
    // "none" until M3 wires SMTP; "mock" is refused in production by the health check.
    EMAIL_DRIVER: z.enum(["none", "mock", "smtp"]).default("none"),
    APP_VERSION: z.string().default("dev"),
    STUDIO_DEV_ADMIN: z.email().optional(),
  })
  .refine((e) => !e.STUDIO_DEV_ADMIN || e.NODE_ENV === "development", {
    message: "STUDIO_DEV_ADMIN is only allowed when NODE_ENV=development",
    path: ["STUDIO_DEV_ADMIN"],
  });

export type Env = z.infer<typeof EnvSchema>;

export function parseEnv(src: Record<string, string | undefined>): Env {
  return EnvSchema.parse(src);
}

// Lazy on purpose: boringco's build broke because prerendering read server secrets.
let cached: Env | undefined;
export function env(): Env {
  cached ??= parseEnv(process.env);
  return cached;
}
```

- [ ] **Step 4:** Run o teste → PASS (5).
- [ ] **Step 5:** `git add studio/src/lib/env.* && git commit -m "feat(studio): ambiente validado por zod, sem leitura no build"`

### Task 3: Classificação de host (`lib/hosts.ts`)

**Files:** Create `studio/src/lib/hosts.ts`, Test `studio/src/lib/hosts.test.ts`.

- [ ] **Step 1: teste**

```ts
import { surfaceFor } from "./hosts";

const hosts = { studio: "studio.ash.app.br", pub: "pub.ash.app.br" };

describe("surfaceFor", () => {
  it("studio é admin em qualquer rota", () => {
    expect(surfaceFor("studio.ash.app.br", "/", hosts)).toBe("admin");
    expect(surfaceFor("STUDIO.ash.app.br:443", "/x", hosts)).toBe("admin");
  });
  it("pub só abre as rotas públicas", () => {
    expect(surfaceFor("pub.ash.app.br", "/api/public/posts", hosts)).toBe("public");
    expect(surfaceFor("pub.ash.app.br", "/newsletter/confirmar", hosts)).toBe("public");
    expect(surfaceFor("pub.ash.app.br", "/descadastro", hosts)).toBe("public");
    expect(surfaceFor("pub.ash.app.br", "/media/a.webp", hosts)).toBe("public");
    expect(surfaceFor("pub.ash.app.br", "/", hosts)).toBe("deny");
    expect(surfaceFor("pub.ash.app.br", "/api/health", hosts)).toBe("deny");
    expect(surfaceFor("pub.ash.app.br", "/descadastro-falso", hosts)).toBe("deny");
  });
  it("loopback só vê o health (healthcheck do Docker)", () => {
    expect(surfaceFor("127.0.0.1:3000", "/api/health", hosts)).toBe("internal");
    expect(surfaceFor("localhost:3000", "/", hosts)).toBe("deny");
  });
  it("host desconhecido ou ausente é negado", () => {
    expect(surfaceFor("evil.example", "/", hosts)).toBe("deny");
    expect(surfaceFor(null, "/", hosts)).toBe("deny");
  });
});
```

- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3: implementação**

```ts
export type Surface = "admin" | "public" | "internal" | "deny";

// Exact paths, or a prefix ending in "/": "/descadastro-falso" must not ride on "/descadastro".
const PUBLIC_ROUTES = ["/api/public/", "/newsletter/", "/descadastro", "/media/"];
const LOOPBACK = new Set(["127.0.0.1", "localhost"]);

function matches(route: string, pathname: string): boolean {
  return route.endsWith("/") ? pathname.startsWith(route) : pathname === route;
}

export function surfaceFor(
  host: string | null,
  pathname: string,
  hosts: { studio: string; pub: string },
): Surface {
  const name = (host ?? "").toLowerCase().split(":")[0] ?? "";
  if (name === hosts.studio) return "admin";
  if (name === hosts.pub) return PUBLIC_ROUTES.some((r) => matches(r, pathname)) ? "public" : "deny";
  if (LOOPBACK.has(name) && pathname === "/api/health") return "internal";
  return "deny";
}
```

- [ ] **Step 4:** Run → PASS. **Step 5:** commit `feat(studio): classificacao de host (admin, publico, interno, negado)`.

### Task 4: JWT do Access (`lib/access.ts`, `lib/admin.ts`)

**Files:** Create `studio/src/lib/access.ts`, `studio/src/lib/admin.ts`; Test `studio/src/lib/access.test.ts`.

- [ ] **Step 1: teste (chaves locais; nada de rede)**

```ts
import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair } from "jose";
import { verifyAdmin } from "./access";

const cfg = { teamDomain: "team.cloudflareaccess.com", aud: "aud-1", admins: ["lucas@example.com"] };
let keys: ReturnType<typeof createLocalJWKSet>;
let sign: (claims: Record<string, unknown>, opts?: { aud?: string; exp?: string }) => Promise<string>;

beforeAll(async () => {
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  const jwk = { ...(await exportJWK(publicKey)), kid: "k1", alg: "RS256" };
  keys = createLocalJWKSet({ keys: [jwk] });
  sign = (claims, opts = {}) =>
    new SignJWT(claims)
      .setProtectedHeader({ alg: "RS256", kid: "k1" })
      .setIssuer(`https://${cfg.teamDomain}`)
      .setAudience(opts.aud ?? cfg.aud)
      .setIssuedAt()
      .setExpirationTime(opts.exp ?? "5m")
      .sign(privateKey);
});

describe("verifyAdmin", () => {
  it("aceita admin da lista (sem diferenciar maiúsculas)", async () => {
    expect(await verifyAdmin(await sign({ email: "Lucas@Example.com" }), cfg, keys)).toEqual({
      email: "lucas@example.com",
    });
  });
  it("recusa e-mail fora da lista", async () => {
    expect(await verifyAdmin(await sign({ email: "x@example.com" }), cfg, keys)).toBeNull();
  });
  it("recusa audiência de outro app", async () => {
    expect(await verifyAdmin(await sign({ email: "lucas@example.com" }, { aud: "outro" }), cfg, keys)).toBeNull();
  });
  it("recusa token vencido", async () => {
    expect(await verifyAdmin(await sign({ email: "lucas@example.com" }, { exp: "-1m" }), cfg, keys)).toBeNull();
  });
  it("recusa ausência de token", async () => {
    expect(await verifyAdmin(null, cfg, keys)).toBeNull();
  });
});
```

- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3: implementação**

```ts
// src/lib/access.ts
import { type JWTVerifyGetKey, createRemoteJWKSet, jwtVerify } from "jose";

export type AccessConfig = { teamDomain: string; aud: string; admins: readonly string[] };

const remote = new Map<string, JWTVerifyGetKey>();
function remoteKeys(teamDomain: string): JWTVerifyGetKey {
  let keys = remote.get(teamDomain);
  if (!keys) {
    keys = createRemoteJWKSet(new URL(`https://${teamDomain}/cdn-cgi/access/certs`));
    remote.set(teamDomain, keys);
  }
  return keys;
}

// Access already blocks outsiders at the edge; this second check is what stops a request that
// reaches the origin some other way (or a valid Access user who is not on our list).
export async function verifyAdmin(
  token: string | null,
  cfg: AccessConfig,
  keys: JWTVerifyGetKey = remoteKeys(cfg.teamDomain),
): Promise<{ email: string } | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, keys, {
      issuer: `https://${cfg.teamDomain}`,
      audience: cfg.aud,
    });
    const email = typeof payload.email === "string" ? payload.email.toLowerCase() : "";
    return email && cfg.admins.includes(email) ? { email } : null;
  } catch (err) {
    console.warn(JSON.stringify({ at: "access", denied: (err as { code?: string }).code ?? "invalid" }));
    return null;
  }
}
```

```ts
// src/lib/admin.ts
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { verifyAdmin } from "./access";
import { type Env, env } from "./env";

export const ACCESS_HEADER = "cf-access-jwt-assertion";

export async function adminFromToken(token: string | null, e: Env = env()) {
  if (e.NODE_ENV === "development" && e.STUDIO_DEV_ADMIN) return { email: e.STUDIO_DEV_ADMIN };
  return verifyAdmin(token, { teamDomain: e.ACCESS_TEAM_DOMAIN, aud: e.ACCESS_AUD, admins: e.STUDIO_ADMINS });
}

// Every admin page, route and server action calls this. The proxy is a first gate only: the
// Next 16 docs warn that a matcher change can silently drop proxy coverage.
export async function requireAdmin(): Promise<{ email: string }> {
  const who = await adminFromToken((await headers()).get(ACCESS_HEADER));
  if (!who) notFound();
  return who;
}
```

- [ ] **Step 4:** Run → PASS (5). **Step 5:** commit `feat(studio): JWT do Cloudflare Access + lista de admins`.

### Task 5: Proxy (`src/proxy.ts`)

**Files:** Create `studio/src/proxy.ts`. (Lógica já testada nas Tasks 3–4; aqui só costura.)

- [ ] **Step 1: implementação**

```ts
import { type NextRequest, NextResponse } from "next/server";
import { ACCESS_HEADER, adminFromToken } from "@/lib/admin";
import { env } from "@/lib/env";
import { surfaceFor } from "@/lib/hosts";

export async function proxy(req: NextRequest) {
  const e = env();
  const surface = surfaceFor(req.headers.get("host"), req.nextUrl.pathname, {
    studio: e.STUDIO_HOST,
    pub: e.PUBLIC_HOST,
  });
  if (surface === "deny") return new NextResponse("Not found", { status: 404 });
  if (surface === "admin" && !(await adminFromToken(req.headers.get(ACCESS_HEADER), e))) {
    return new NextResponse("Forbidden", { status: 403 });
  }
  return NextResponse.next();
}

// Static assets pass untouched; everything else is classified.
export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
```

- [ ] **Step 2:** `pnpm typecheck` → sem erros. **Step 3:** commit `feat(studio): proxy classifica cada pedido antes da rota`.

### Task 6: Banco — schema, cliente, migração e helper de teste

**Files:** Create `studio/src/db/schema.ts`, `studio/src/db/client.ts`, `studio/src/db/migrate.ts`,
`studio/drizzle.config.ts`, `studio/src/lib/expect-rows.ts`, `studio/tests/helpers/db.ts`,
`studio/deploy/testdb.sh`; Generate `studio/drizzle/0000_*.sql`.

- [ ] **Step 1: schema**

```ts
import { sql } from "drizzle-orm";
import { bigserial, check, index, integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

const ts = (name: string) => timestamp(name, { withTimezone: true });

export const auditLog = pgTable(
  "audit_log",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    event: text("event").notNull(),
    actor: text("actor"),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [index("audit_log_event_idx").on(t.event, t.createdAt)],
);

export const JOB_STATUS = ["queued", "running", "done", "dead"] as const;

export const jobs = pgTable(
  "jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    kind: text("kind").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    status: text("status", { enum: JOB_STATUS }).notNull().default("queued"),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(3),
    runAfter: ts("run_after").notNull().defaultNow(),
    lockedUntil: ts("locked_until"),
    lastError: text("last_error"),
    // Same logical job enqueued twice (e.g. two clicks) collapses into one row.
    dedupeKey: text("dedupe_key").unique(),
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("jobs_ready_idx").on(t.status, t.runAfter),
    check("jobs_status_chk", sql`${t.status} in ('queued','running','done','dead')`),
    check("jobs_attempts_chk", sql`${t.attempts} >= 0 and ${t.maxAttempts} >= 1`),
  ],
);

export const workerHeartbeat = pgTable("worker_heartbeat", {
  worker: text("worker").primaryKey(),
  beatAt: ts("beat_at").notNull(),
  lastCycleMs: integer("last_cycle_ms").notNull(),
  lastError: text("last_error"),
});
```

- [ ] **Step 2: cliente, migração, drizzle.config, expectOne**

```ts
// src/db/client.ts
import { type PostgresJsDatabase, drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { env } from "@/lib/env";
import * as schema from "./schema";

export type Db = PostgresJsDatabase<typeof schema>;

export function createDb(url: string, max = 5): { db: Db; close: () => Promise<void> } {
  const client = postgres(url, { max, onnotice: () => {} });
  return { db: drizzle(client, { schema }), close: () => client.end() };
}

let shared: Db | undefined;
export function db(): Db {
  shared ??= createDb(env().DATABASE_URL).db;
  return shared;
}
```

```ts
// src/db/migrate.ts — runs as the one-shot `migrate` service before app and worker start.
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { createDb } from "./client";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required");
const { db, close } = createDb(url, 1);
await migrate(db, { migrationsFolder: process.env.MIGRATIONS_DIR ?? "drizzle" });
await close();
console.log(JSON.stringify({ at: "migrate", ok: true }));
```

```ts
// drizzle.config.ts
import { defineConfig } from "drizzle-kit";

export default defineConfig({ dialect: "postgresql", schema: "./src/db/schema.ts", out: "./drizzle" });
```

```ts
// src/lib/expect-rows.ts
// boringco's worst bug class: an update that matched nothing and still reported success.
export function expectOne<T>(rows: readonly T[], what: string): T {
  if (rows.length !== 1) throw new Error(`${what}: expected 1 row, got ${rows.length}`);
  return rows[0] as T;
}
```

- [ ] **Step 3: gerar a migração**

Run: `pnpm db:generate` → Expected: `drizzle/0000_<nome>.sql` com `CREATE TABLE "audit_log"`,
`"jobs"`, `"worker_heartbeat"` e os dois `CHECK`. Conferir o SQL à mão antes de commitar.

- [ ] **Step 4: helper de teste de banco**

```ts
// tests/helpers/db.ts
import { sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { createDb } from "@/db/client";

const url = process.env.TEST_DATABASE_URL;
if (!url && process.env.REQUIRE_DB_TESTS === "1") {
  throw new Error("REQUIRE_DB_TESTS=1 but TEST_DATABASE_URL is unset — refusing to skip silently");
}
if (!url) console.warn("[studio] TEST_DATABASE_URL unset: database suites are SKIPPED");

export const describeDb = url ? describe : describe.skip;

export async function freshDb() {
  const handle = createDb(url as string, 4);
  await handle.db.execute(sql`drop schema if exists public cascade`);
  await handle.db.execute(sql`drop schema if exists drizzle cascade`);
  await handle.db.execute(sql`create schema public`);
  await migrate(handle.db, { migrationsFolder: "drizzle" });
  return handle;
}
```

- [ ] **Step 5: banco de teste na VPS (uma vez) — `deploy/testdb.sh`**

```bash
#!/usr/bin/env bash
# Throwaway Postgres for the integration suites, loopback-only on the VPS (no Docker on the PC).
# Use (repo root): bash studio/deploy/testdb.sh   then   ssh -N -L 54329:127.0.0.1:54329 agent-rails-vps
set -euo pipefail
ssh agent-rails-vps 'set -e
if ! sudo docker ps -a --format "{{.Names}}" | grep -qx ash-studio-testdb; then
  PW=$(openssl rand -hex 16)
  sudo docker run -d --name ash-studio-testdb --restart unless-stopped \
    -p 127.0.0.1:54329:5432 -e POSTGRES_USER=studio -e POSTGRES_DB=studio_test \
    -e POSTGRES_PASSWORD="$PW" postgres:17-alpine >/dev/null
  echo "TEST_DATABASE_URL=postgres://studio:$PW@127.0.0.1:54329/studio_test" | sudo tee /opt/ash-studio-testdb.env >/dev/null
  sudo chmod 600 /opt/ash-studio-testdb.env
fi
sudo cat /opt/ash-studio-testdb.env' > studio/.env.test
echo "studio/.env.test written (gitignored)"
```

- [ ] **Step 6:** Run `bash studio/deploy/testdb.sh`, abrir o túnel em outro terminal, `pnpm typecheck` → ok.
- [ ] **Step 7:** commit `feat(studio): schema (auditoria, fila, batimento), migracao e banco de teste`.

### Task 7: Auditoria (`lib/audit.ts`)

**Files:** Create `studio/src/lib/audit.ts`, Test `studio/tests/audit.test.ts`.

- [ ] **Step 1: teste (integração)**

```ts
import { eq } from "drizzle-orm";
import { auditLog } from "@/db/schema";
import { logAudit } from "@/lib/audit";
import { describeDb, freshDb } from "./helpers/db";

describeDb("logAudit", () => {
  it("grava evento, autor e payload", async () => {
    const { db, close } = await freshDb();
    const id = await logAudit(db, { event: "post.published", actor: "lucas@example.com", payload: { slug: "a" } });
    const [row] = await db.select().from(auditLog).where(eq(auditLog.id, id));
    expect(row).toMatchObject({ event: "post.published", actor: "lucas@example.com", payload: { slug: "a" } });
    await close();
  });
});
```

- [ ] **Step 2:** Run `pnpm vitest run tests/audit.test.ts` (túnel aberto) → FAIL.
- [ ] **Step 3: implementação**

```ts
import type { Db } from "@/db/client";
import { auditLog } from "@/db/schema";
import { expectOne } from "./expect-rows";

export async function logAudit(
  db: Db,
  entry: { event: string; actor?: string | null; payload?: Record<string, unknown> },
): Promise<number> {
  const rows = await db
    .insert(auditLog)
    .values({ event: entry.event, actor: entry.actor ?? null, payload: entry.payload ?? {} })
    .returning({ id: auditLog.id });
  return expectOne(rows, "audit insert").id;
}
```

- [ ] **Step 4:** Run → PASS. **Step 5:** commit `feat(studio): registro de auditoria`.

### Task 8: Fila durável (`jobs/queue.ts`)

**Files:** Create `studio/src/jobs/queue.ts`, Test `studio/tests/queue.test.ts`.

- [ ] **Step 1: testes (integração)** — `t0` fica em 2099 de propósito: jobs sem `runAfter`
nascem com `now()` real, que precisa ser anterior a `t0` para sempre.

```ts
import { eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { jobs } from "@/db/schema";
import { backoffMs, claimNext, complete, enqueue, fail, reapExpired } from "@/jobs/queue";
import { describeDb, freshDb } from "./helpers/db";

const t0 = new Date("2099-01-01T12:00:00Z");
const at = (ms: number) => new Date(t0.getTime() + ms);

describe("backoffMs", () => {
  it("dobra a cada tentativa e para em 1 h", () => {
    expect([1, 2, 3].map(backoffMs)).toEqual([30_000, 60_000, 120_000]);
    expect(backoffMs(20)).toBe(3_600_000);
  });
});

describeDb("fila", () => {
  let db: Db;
  let close: () => Promise<void>;
  beforeEach(async () => {
    ({ db, close } = await freshDb());
  });
  afterEach(async () => close());

  it("dedupe: mesma chave vira um job só", async () => {
    const a = await enqueue(db, { kind: "ping", dedupeKey: "k" });
    const b = await enqueue(db, { kind: "ping", dedupeKey: "k" });
    expect(a).not.toBeNull();
    expect(b).toBeNull();
  });

  it("não pega job cujo run_after está no futuro", async () => {
    await enqueue(db, { kind: "ping", runAfter: at(60_000) });
    expect(await claimNext(db, t0)).toBeNull();
    expect(await claimNext(db, at(60_000))).not.toBeNull();
  });

  it("rodadas simultâneas nunca pegam o mesmo job", async () => {
    for (let i = 0; i < 3; i++) await enqueue(db, { kind: "ping" });
    const got = await Promise.all([1, 2, 3, 4].map(() => claimNext(db, t0)));
    const ids = got.filter(Boolean).map((j) => j?.id);
    expect(ids).toHaveLength(3);
    expect(new Set(ids).size).toBe(3);
  });

  it("falha reagenda com backoff e morre na última tentativa", async () => {
    await enqueue(db, { kind: "ping", maxAttempts: 2 });
    const j1 = await claimNext(db, t0);
    await fail(db, j1!, "boom", t0);
    const [r1] = await db.select().from(jobs).where(eq(jobs.id, j1!.id));
    expect(r1).toMatchObject({ status: "queued", lastError: "boom" });
    expect(r1!.runAfter.getTime()).toBe(at(30_000).getTime());
    const j2 = await claimNext(db, at(30_000));
    await fail(db, j2!, "boom2", at(30_000));
    const [r2] = await db.select().from(jobs).where(eq(jobs.id, j1!.id));
    expect(r2).toMatchObject({ status: "dead", attempts: 2 });
  });

  it("lease vencida volta para a fila; sem tentativas, morre", async () => {
    await enqueue(db, { kind: "ping", maxAttempts: 1 });
    await enqueue(db, { kind: "ping", maxAttempts: 3 });
    const a = await claimNext(db, t0, 1_000);
    const b = await claimNext(db, t0, 1_000);
    await reapExpired(db, at(2_000));
    const again = await claimNext(db, at(2_000));
    const survivor = [a, b].find((j) => j?.maxAttempts === 3);
    expect(again?.id).toBe(survivor?.id);
    const dead = [a, b].find((j) => j?.maxAttempts === 1);
    const [row] = await db.select().from(jobs).where(eq(jobs.id, dead!.id));
    expect(row?.status).toBe("dead");
  });

  it("complete de job que não está rodando é erro, não silêncio", async () => {
    const id = await enqueue(db, { kind: "ping" });
    await expect(complete(db, id!)).rejects.toThrow(/expected 1 row/);
  });
});
```

- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3: implementação**

```ts
import { and, eq, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { jobs } from "@/db/schema";
import { expectOne } from "@/lib/expect-rows";

export type Job = {
  id: string;
  kind: string;
  payload: Record<string, unknown>;
  attempts: number;
  maxAttempts: number;
};

export const backoffMs = (attempt: number) => Math.min(30_000 * 2 ** (attempt - 1), 3_600_000);

export async function enqueue(
  db: Db,
  job: { kind: string; payload?: Record<string, unknown>; runAfter?: Date; dedupeKey?: string; maxAttempts?: number },
): Promise<string | null> {
  const rows = await db
    .insert(jobs)
    .values({
      kind: job.kind,
      payload: job.payload ?? {},
      runAfter: job.runAfter ?? new Date(),
      dedupeKey: job.dedupeKey ?? null,
      maxAttempts: job.maxAttempts ?? 3,
    })
    .onConflictDoNothing({ target: jobs.dedupeKey })
    .returning({ id: jobs.id });
  return rows[0]?.id ?? null;
}

// SKIP LOCKED is what boringco's dispatcher lacked: two overlapping runs could send twice.
export async function claimNext(db: Db, now: Date, leaseMs = 5 * 60_000): Promise<Job | null> {
  const rows = await db.execute<{
    id: string;
    kind: string;
    payload: Record<string, unknown>;
    attempts: number;
    max_attempts: number;
  }>(sql`
    update jobs set status = 'running', attempts = attempts + 1,
      locked_until = ${new Date(now.getTime() + leaseMs)}, updated_at = ${now}
    where id = (
      select id from jobs
      where status = 'queued' and run_after <= ${now}
      order by run_after, created_at
      limit 1
      for update skip locked
    )
    returning id, kind, payload, attempts, max_attempts`);
  const r = rows[0];
  return r ? { id: r.id, kind: r.kind, payload: r.payload, attempts: r.attempts, maxAttempts: r.max_attempts } : null;
}

export async function complete(db: Db, id: string): Promise<void> {
  const rows = await db
    .update(jobs)
    .set({ status: "done", lockedUntil: null, updatedAt: new Date() })
    .where(and(eq(jobs.id, id), eq(jobs.status, "running")))
    .returning({ id: jobs.id });
  expectOne(rows, `complete job ${id}`);
}

export async function fail(db: Db, job: Job, error: string, now: Date): Promise<void> {
  const dead = job.attempts >= job.maxAttempts;
  const rows = await db
    .update(jobs)
    .set({
      status: dead ? "dead" : "queued",
      lastError: error.slice(0, 2000),
      lockedUntil: null,
      runAfter: dead ? now : new Date(now.getTime() + backoffMs(job.attempts)),
      updatedAt: now,
    })
    .where(and(eq(jobs.id, job.id), eq(jobs.status, "running")))
    .returning({ id: jobs.id });
  expectOne(rows, `fail job ${job.id}`);
}

// A worker that died mid-job leaves a lease behind; the job goes back to the queue, or dies if it
// already used every attempt (a job that crashes the worker must not loop forever).
export async function reapExpired(db: Db, now: Date): Promise<void> {
  await db.execute(sql`
    update jobs set
      status = case when attempts >= max_attempts then 'dead' else 'queued' end,
      last_error = coalesce(last_error, 'lease expired'),
      locked_until = null, updated_at = ${now}
    where status = 'running' and locked_until < ${now}`);
}
```

- [ ] **Step 4:** Run → PASS (7). **Step 5:** commit `feat(studio): fila duravel com SKIP LOCKED, backoff e lease`.

### Task 9: Worker (`worker/cycle.ts`, `handlers.ts`, `main.ts`)

**Files:** Create os três; Test `studio/tests/worker.test.ts`.

- [ ] **Step 1: teste (integração)**

```ts
import { eq } from "drizzle-orm";
import { jobs, workerHeartbeat } from "@/db/schema";
import { enqueue } from "@/jobs/queue";
import { runCycle } from "@/worker/cycle";
import { describeDb, freshDb } from "./helpers/db";

describeDb("runCycle", () => {
  it("processa, registra falha de kind sem handler e bate o ponto", async () => {
    const { db, close } = await freshDb();
    const seen: unknown[] = [];
    await enqueue(db, { kind: "ok", payload: { n: 1 } });
    const bad = await enqueue(db, { kind: "desconhecido", maxAttempts: 1 });
    const res = await runCycle(db, { ok: async (p) => void seen.push(p) }, { worker: "w1" });
    expect(res).toEqual({ processed: 1, failed: 1 });
    expect(seen).toEqual([{ n: 1 }]);
    const [dead] = await db.select().from(jobs).where(eq(jobs.id, bad!));
    expect(dead).toMatchObject({ status: "dead", lastError: 'no handler for kind "desconhecido"' });
    const [beat] = await db.select().from(workerHeartbeat);
    expect(beat).toMatchObject({ worker: "w1", lastError: 'no handler for kind "desconhecido"' });
    await close();
  });
});
```

- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3: implementação**

```ts
// src/worker/cycle.ts
import type { Db } from "@/db/client";
import { workerHeartbeat } from "@/db/schema";
import { claimNext, complete, fail, reapExpired } from "@/jobs/queue";

export type Handler = (payload: Record<string, unknown>, ctx: { db: Db; now: Date }) => Promise<void>;
export type Handlers = Record<string, Handler>;

export async function runCycle(
  db: Db,
  handlers: Handlers,
  opts: { worker: string; maxJobs?: number; now?: () => Date },
): Promise<{ processed: number; failed: number }> {
  const now = opts.now ?? (() => new Date());
  const started = Date.now();
  let processed = 0;
  let failed = 0;
  let lastError: string | null = null;

  await reapExpired(db, now());
  for (let i = 0; i < (opts.maxJobs ?? 20); i++) {
    const job = await claimNext(db, now());
    if (!job) break;
    try {
      const handler = handlers[job.kind];
      if (!handler) throw new Error(`no handler for kind "${job.kind}"`);
      await handler(job.payload, { db, now: now() });
      await complete(db, job.id);
      processed++;
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      await fail(db, job, lastError, now());
      failed++;
      console.error(JSON.stringify({ at: "worker", job: job.id, kind: job.kind, error: lastError }));
    }
  }

  const beat = { beatAt: now(), lastCycleMs: Date.now() - started, lastError };
  await db
    .insert(workerHeartbeat)
    .values({ worker: opts.worker, ...beat })
    .onConflictDoUpdate({ target: workerHeartbeat.worker, set: beat });
  return { processed, failed };
}
```

```ts
// src/worker/handlers.ts — M1+ register their kinds here (publish-due, generate-post, ...).
import { logAudit } from "@/lib/audit";
import type { Handlers } from "./cycle";

export const handlers: Handlers = {
  ping: async (payload, { db }) => void (await logAudit(db, { event: "worker.ping", payload })),
};
```

```ts
// src/worker/main.ts
import { hostname } from "node:os";
import { db } from "@/db/client";
import { runCycle } from "./cycle";
import { handlers } from "./handlers";

const EVERY_MS = 60_000;
let stopping = false;
for (const sig of ["SIGTERM", "SIGINT"] as const) process.on(sig, () => void (stopping = true));

const worker = `studio-worker@${hostname()}`;
while (!stopping) {
  try {
    const res = await runCycle(db(), handlers, { worker });
    if (res.processed || res.failed) console.log(JSON.stringify({ at: "cycle", ...res }));
  } catch (err) {
    // A cycle that cannot even reach the database must not kill the loop; the missing heartbeat
    // is what turns /api/health red.
    console.error(JSON.stringify({ at: "cycle", fatal: err instanceof Error ? err.message : String(err) }));
  }
  const until = Date.now() + EVERY_MS;
  while (!stopping && Date.now() < until) await new Promise((r) => setTimeout(r, 1_000));
}
process.exit(0);
```

- [ ] **Step 4:** Run → PASS. **Step 5:** commit `feat(studio): worker com ciclo de 60 s e batimento`.

### Task 10: Health (`lib/health.ts` + rota)

**Files:** Create `studio/src/lib/health.ts`, `studio/src/app/api/health/route.ts`; Test `studio/src/lib/health.test.ts`.

- [ ] **Step 1: teste**

```ts
import { evaluateHealth } from "./health";

const now = new Date("2026-10-01T12:00:00Z");
const ok = {
  version: "abc123",
  nodeEnv: "production",
  dbOk: true,
  heartbeatAt: new Date(now.getTime() - 60_000),
  now,
  emailDriver: "none" as const,
};

describe("evaluateHealth", () => {
  it("tudo verde", () => {
    const h = evaluateHealth(ok);
    expect(h.ok).toBe(true);
    expect(h.checks.email).toEqual({ ok: true, detail: "not wired yet" });
  });
  it("worker sem batimento há mais de 3 min fica vermelho", () => {
    expect(evaluateHealth({ ...ok, heartbeatAt: new Date(now.getTime() - 181_000) }).ok).toBe(false);
    expect(evaluateHealth({ ...ok, heartbeatAt: null }).checks.worker.ok).toBe(false);
  });
  it("driver mock em produção é falha", () => {
    expect(evaluateHealth({ ...ok, emailDriver: "mock" }).checks.email.ok).toBe(false);
    expect(evaluateHealth({ ...ok, nodeEnv: "development", emailDriver: "mock" }).checks.email.ok).toBe(true);
  });
  it("banco fora derruba o health", () => {
    expect(evaluateHealth({ ...ok, dbOk: false }).ok).toBe(false);
  });
});
```

- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3: implementação**

```ts
// src/lib/health.ts
export type Check = { ok: boolean; detail: string };
export type Health = { ok: boolean; version: string; checks: { db: Check; worker: Check; email: Check } };

const WORKER_STALE_MS = 180_000;

export function evaluateHealth(i: {
  version: string;
  nodeEnv: string;
  dbOk: boolean;
  heartbeatAt: Date | null;
  now: Date;
  emailDriver: "none" | "mock" | "smtp";
}): Health {
  const age = i.heartbeatAt ? i.now.getTime() - i.heartbeatAt.getTime() : null;
  const checks = {
    db: { ok: i.dbOk, detail: i.dbOk ? "reachable" : "unreachable" },
    worker:
      age === null
        ? { ok: false, detail: "no heartbeat yet" }
        : { ok: age <= WORKER_STALE_MS, detail: `last beat ${Math.round(age / 1000)}s ago` },
    // A mock that answers ok:true in production is how boringco lost mail without noticing.
    email:
      i.emailDriver === "mock" && i.nodeEnv === "production"
        ? { ok: false, detail: "mock driver in production" }
        : { ok: true, detail: i.emailDriver === "none" ? "not wired yet" : i.emailDriver },
  };
  return { ok: Object.values(checks).every((c) => c.ok), version: i.version, checks };
}
```

```ts
// src/app/api/health/route.ts
import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import { env } from "@/lib/env";
import { evaluateHealth } from "@/lib/health";

export const dynamic = "force-dynamic";

export async function GET() {
  const e = env();
  let dbOk = false;
  let heartbeatAt: Date | null = null;
  try {
    const rows = await db().execute<{ beat: Date | null }>(sql`select max(beat_at) as beat from worker_heartbeat`);
    dbOk = true;
    heartbeatAt = rows[0]?.beat ? new Date(rows[0].beat) : null;
  } catch (err) {
    console.error(JSON.stringify({ at: "health", db: err instanceof Error ? err.message : String(err) }));
  }
  const h = evaluateHealth({
    version: e.APP_VERSION,
    nodeEnv: e.NODE_ENV,
    dbOk,
    heartbeatAt,
    now: new Date(),
    emailDriver: e.EMAIL_DRIVER,
  });
  return Response.json(h, { status: h.ok ? 200 : 503, headers: { "cache-control": "no-store" } });
}
```

- [ ] **Step 4:** Run → PASS (4). **Step 5:** commit `feat(studio): /api/health (banco, worker, driver de e-mail)`.

### Task 11: Casca do painel (layout, tokens, página inicial)

**Files:** Create `studio/src/app/globals.css`, `studio/src/app/layout.tsx`, `studio/src/app/page.tsx`.

- [ ] **Step 1: tokens (valores de `docs/design-system.md`; fonte: console)**

```css
/* Same tokens as the site and the console — docs/design-system.md. Never invent a tone here. */
@import "tailwindcss";

@theme {
  --color-bg: #08080a;
  --color-surface: #0f0f12;
  --color-elevated: #17171b;
  --color-ink: #f4f4f5;
  --color-muted: #a1a1aa;
  --color-faint: #7a7a85;
  --color-line: #27272e;
  --color-line-strong: #3a3a44;
  --color-accent: #7c8cff;
  --color-settle: #14f195;
  --color-settle-ink: #08080a;
  --color-warning: #fab219;
  --color-deny: #f0575a;
  --font-sans: "Inter", system-ui, sans-serif;
  --font-mono: "JetBrains Mono", ui-monospace, monospace;
  --radius-sm: 6px;
  --radius-md: 8px;
  --radius-lg: 12px;
  --radius-xl: 16px;
}

body {
  background: var(--color-bg);
  color: var(--color-ink);
  font-family: var(--font-sans);
}
.surface-card {
  background: var(--color-surface);
  border: 1px solid var(--color-line);
  border-radius: var(--radius-xl);
  box-shadow: inset 0 1px 0 0 rgb(255 255 255 / 0.04);
}
```

- [ ] **Step 2: layout e página**

```tsx
// src/app/layout.tsx
import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "@fontsource/jetbrains-mono/400.css";
import "./globals.css";
import type { ReactNode } from "react";

export const metadata = { title: "Ash Studio", robots: { index: false, follow: false } };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="pt-BR">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
```

```tsx
// src/app/page.tsx
import { requireAdmin } from "@/lib/admin";

export const dynamic = "force-dynamic";

export default async function Home() {
  const who = await requireAdmin();
  return (
    <main className="mx-auto max-w-3xl p-8">
      <p className="text-sm text-muted">Ash Studio</p>
      <h1 className="mt-1 text-2xl font-semibold">Olá, {who.email}</h1>
      <section className="surface-card mt-6 p-6">
        <p className="text-muted">Blog, campanhas e newsletter entram aqui nas próximas fases.</p>
        <a className="mt-4 inline-block font-mono text-sm text-settle" href="/api/health">
          /api/health
        </a>
      </section>
    </main>
  );
}
```

- [ ] **Step 3: rodar local**

`studio/.env.local` (ignorado): `NODE_ENV=development`, `DATABASE_URL=<o de .env.test>`,
`STUDIO_HOST=localhost`, `PUBLIC_HOST=pub.localhost`, `ACCESS_TEAM_DOMAIN=ashhuman.cloudflareaccess.com`,
`ACCESS_AUD=dev`, `STUDIO_ADMINS=<e-mail do Lucas>`, `STUDIO_DEV_ADMIN=<o mesmo>`.
Run: `pnpm dev` → abrir `http://localhost:3100/` → "Olá, <e-mail>". `http://127.0.0.1:3100/`
→ 404 (loopback só vê o health).

- [ ] **Step 4:** commit `feat(studio): casca do painel com os tokens do Ash`.

### Task 12: Build do worker e imagem Docker

**Files:** Create `studio/build-worker.mjs`, `studio/Dockerfile`, `studio/.dockerignore`.

- [ ] **Step 1: build-worker.mjs**

```js
// Bundles the worker and the migrator: Next's standalone output only traces the web server.
import { build } from "esbuild";

await build({
  entryPoints: { worker: "src/worker/main.ts", migrate: "src/db/migrate.ts" },
  outdir: "dist",
  outExtension: { ".js": ".mjs" },
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node24",
  tsconfig: "tsconfig.json",
  // Some deps still call require(); ESM bundles need it provided.
  banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
});
```

- [ ] **Step 2: Dockerfile e .dockerignore**

```dockerfile
FROM node:24-alpine AS deps
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

FROM deps AS build
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm build

FROM node:24-alpine AS run
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
# Fixed uid so /opt/ash-studio/uploads can be chowned on the host before the first run.
RUN addgroup -S -g 10001 app && adduser -S -u 10001 -G app app
COPY --from=build --chown=app:app /app/.next/standalone ./
COPY --from=build --chown=app:app /app/.next/static ./.next/static
COPY --from=build --chown=app:app /app/public ./public
COPY --from=build --chown=app:app /app/dist ./dist
COPY --from=build --chown=app:app /app/drizzle ./drizzle
USER app
EXPOSE 3000
CMD ["node", "server.js"]
```

```
node_modules
.next
dist
.env*
uploads
deploy
tests
```

- [ ] **Step 3:** Run `pnpm build` local → Expected: `.next/standalone/server.js`, `dist/worker.mjs`,
`dist/migrate.mjs`. **Step 4:** commit `build(studio): imagem Docker com servidor, worker e migrador`.

### Task 13: Compose e deploy na VPS

**Files:** Create `studio/deploy/docker-compose.yml`, `studio/deploy/deploy.sh`.

- [ ] **Step 1: fixar a versão do Postgres**

Run: `ssh agent-rails-vps 'sudo docker pull -q postgres:17-alpine && sudo docker run --rm postgres:17-alpine postgres --version'`
→ usar a versão exibida como tag `postgres:<versão>-alpine` no compose (e no `testdb.sh`).

- [ ] **Step 2: docker-compose.yml** (`<versão>` = a do passo 1)

```yaml
# /opt/ash-studio on the Hostinger VPS. Reached only through the `ash` Cloudflare Tunnel;
# nothing publishes a port. Secrets live in /opt/ash-studio/.env, never here.
x-comum: &comum
  restart: unless-stopped
  logging:
    driver: json-file
    options: { max-size: "10m", max-file: "5" }

x-app: &app
  <<: *comum
  image: ash-studio:${APP_VERSION:?APP_VERSION is required}
  env_file: .env
  environment:
    APP_VERSION: ${APP_VERSION}
  depends_on:
    migrate: { condition: service_completed_successfully }

services:
  db:
    <<: *comum
    image: postgres:<versão>-alpine
    container_name: ash-studio-db
    environment:
      POSTGRES_USER: studio
      POSTGRES_DB: studio
      POSTGRES_PASSWORD: ${DB_PASSWORD:?DB_PASSWORD is required}
    volumes: ["./pgdata:/var/lib/postgresql/data"]
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -h 127.0.0.1 -U studio -d studio"]
      interval: 10s
      timeout: 5s
      retries: 10
    networks: [studio]

  migrate:
    image: ash-studio:${APP_VERSION}
    container_name: ash-studio-migrate
    command: ["node", "dist/migrate.mjs"]
    env_file: .env
    depends_on:
      db: { condition: service_healthy }
    networks: [studio]
    restart: "no"

  app:
    <<: *app
    container_name: ash-studio
    volumes: ["./uploads:/app/uploads"]
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://127.0.0.1:3000/api/health"]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 90s
    networks: [studio, ash]

  worker:
    <<: *app
    container_name: ash-studio-worker
    command: ["node", "dist/worker.mjs"]
    networks: [studio]

networks:
  studio: { name: ash-studio }
  ash: { external: true, name: ash }
```

- [ ] **Step 3: deploy.sh**

```bash
#!/usr/bin/env bash
# Ships the committed studio/ tree to the VPS and builds there: one VPS, one image, no registry.
# Use (Git Bash, repo root): bash studio/deploy/deploy.sh
set -euo pipefail
HOST=${HOST:-agent-rails-vps}
[ -z "$(git status --porcelain -- studio)" ] || { echo "studio/ has uncommitted changes" >&2; exit 1; }
VERSION=$(git rev-parse --short HEAD)

git archive --format=tar HEAD:studio | ssh "$HOST" \
  'sudo rm -rf /opt/ash-studio/src && sudo mkdir -p /opt/ash-studio/src && sudo tar -x -C /opt/ash-studio/src'
ssh "$HOST" "set -e; cd /opt/ash-studio
  sudo cp src/deploy/docker-compose.yml .
  sudo docker build -q -t ash-studio:$VERSION src
  sudo env APP_VERSION=$VERSION docker compose up -d --remove-orphans
  sleep 20; sudo docker compose ps
  sudo docker exec ash-studio wget -qO- http://127.0.0.1:3000/api/health"
echo "deployed $VERSION"
```

- [ ] **Step 4: primeira instalação na VPS (uma vez)**

```bash
ssh agent-rails-vps 'set -e
sudo mkdir -p /opt/ash-studio/uploads /opt/ash-studio/pgdata
sudo chown 10001:10001 /opt/ash-studio/uploads
PW=$(openssl rand -hex 24)
sudo tee /opt/ash-studio/.env >/dev/null <<EOF
DB_PASSWORD=$PW
DATABASE_URL=postgres://studio:$PW@db:5432/studio
STUDIO_HOST=studio.ash.app.br
PUBLIC_HOST=pub.ash.app.br
ACCESS_TEAM_DOMAIN=ashhuman.cloudflareaccess.com
ACCESS_AUD=pending
STUDIO_ADMINS=pending@ash.app.br
EMAIL_DRIVER=none
EOF
sudo chmod 600 /opt/ash-studio/.env'
```

`ACCESS_AUD` e `STUDIO_ADMINS` recebem os valores reais na Task 14. `DB_PASSWORD` serve à
interpolação do compose e `DATABASE_URL` aos containers (o compose lê o `.env` do diretório).

- [ ] **Step 5:** Run `bash studio/deploy/deploy.sh` → Expected: 4 serviços; health com
`"db":{"ok":true,...}` e, em até 60 s, `"worker":{"ok":true,...}`.
- [ ] **Step 6:** commit `deploy(studio): compose e script de deploy na VPS`.

### Task 14: Cloudflare — hostnames no túnel, DNS e Access

**Files:** Create `studio/deploy/cloudflare.md` (runbook com o que foi feito e como desfazer).

- [ ] **Step 1: perguntar ao Lucas** quais e-mails entram na política do Access e em `STUDIO_ADMINS`.

- [ ] **Step 2: ingress do túnel `ash`** — `GET /accounts/{acc}/cfd_tunnel/{tunnel}/configurations`,
salvar o JSON em `agenttokenfy/.aios/secrets/ash-tunnel-config-2026-09-30.json`, inserir antes da
regra 404 final (preservando as existentes) e `PUT` de volta:
`{"hostname":"studio.ash.app.br","service":"http://ash-studio:3000"}` e
`{"hostname":"pub.ash.app.br","service":"http://ash-studio:3000"}`.

- [ ] **Step 3: DNS** — dois CNAME proxied: `studio` e `pub` → `<tunnel-id>.cfargotunnel.com`.

- [ ] **Step 4: Access** — `POST /accounts/{acc}/access/apps` com
`{"name":"Ash Studio","domain":"studio.ash.app.br","type":"self_hosted","session_duration":"24h"}`
e política `allow` com `include: [{"email":{"email":"<cada e-mail>"}}]`. Ler o `aud` da resposta.

- [ ] **Step 5:** gravar `ACCESS_AUD=<aud>` e `STUDIO_ADMINS=<e-mails>` no `/opt/ash-studio/.env`;
`cd /opt/ash-studio && sudo env APP_VERSION=<versão> docker compose up -d` (recria app e worker).

- [ ] **Step 6: provas**
  - `curl -sI https://studio.ash.app.br/` → 302 para `ashhuman.cloudflareaccess.com` (Access na borda).
  - Login no navegador → "Olá, <e-mail>"; `/api/health` → 200 com os três checks verdes.
  - `curl -s -o /dev/null -w "%{http_code}" https://pub.ash.app.br/` → 404;
    `https://pub.ash.app.br/api/health` → 404.
- [ ] **Step 7:** commit `docs(studio): runbook da Cloudflare (tunel, DNS, Access)`.

### Task 15: Backup e prova de restauração

**Files:** Create `studio/deploy/backup/{backup.sh,restore-test.sh,ash-studio-backup.service,ash-studio-backup.timer,ash-studio-restauracao.service,ash-studio-restauracao.timer}`;
Modify `algumacoisa-agentica/infra/ash-backup/agent-rails/offsite.sh` (e a cópia em `/opt/ash-backup/`).

- [ ] **Step 1: backup.sh**

```bash
#!/usr/bin/env bash
# Daily dump of the studio database plus the uploaded images. Retention: 7 daily, 4 weekly,
# 6 monthly. A dump pg_restore cannot list is a failure: an empty file looks like a backup.
set -euo pipefail
DEST=/var/backups/ash-studio
STAMP=$(date -u +%Y-%m-%dT%H%MZ)
mkdir -p "$DEST"/{diario,semanal,mensal}

TMP="$DEST/diario/.studio-$STAMP.dump.partial"
OUT="$DEST/diario/studio-$STAMP.dump"
docker exec ash-studio-db pg_dump -U studio -d studio -Fc >"$TMP"
docker exec -i ash-studio-db pg_restore --list >/dev/null <"$TMP"
mv "$TMP" "$OUT"

UP="$DEST/diario/uploads-$STAMP.tar.gz"
tar -czf "$UP.partial" -C /opt/ash-studio uploads
tar -tzf "$UP.partial" >/dev/null
mv "$UP.partial" "$UP"
chmod 640 "$OUT" "$UP"

[ "$(date -u +%u)" = 7 ] && cp -p "$OUT" "$UP" "$DEST/semanal/"
[ "$(date -u +%d)" = 01 ] && cp -p "$OUT" "$UP" "$DEST/mensal/"

# find, not ls: with pipefail, ls on a still-empty weekly/monthly dir fails the whole run.
prune() {
  find "$1" -maxdepth 1 -name "$2" -printf '%T@ %p\n' | sort -rn |
    tail -n +"$(($3 + 1))" | cut -d' ' -f2- | xargs -r rm -f
}
for kind in 'studio-*.dump' 'uploads-*.tar.gz'; do
  prune "$DEST/diario" "$kind" 7
  prune "$DEST/semanal" "$kind" 4
  prune "$DEST/mensal" "$kind" 6
done
echo "$(date -u +%FT%TZ) ok $OUT $(stat -c %s "$OUT") bytes; $UP $(stat -c %s "$UP") bytes"
```

- [ ] **Step 2: restore-test.sh**

```bash
#!/usr/bin/env bash
# Weekly proof that the newest dump restores into a throwaway Postgres of the same image and that
# the studio tables answer. pg_isready alone is not proof.
set -euo pipefail
DUMP=$(ls -1t /var/backups/ash-studio/diario/studio-*.dump | head -n1)
IMAGE=$(docker inspect -f '{{.Config.Image}}' ash-studio-db)
NAME=ash-studio-restore-test
docker rm -f "$NAME" >/dev/null 2>&1 || true
trap 'docker rm -f "$NAME" >/dev/null 2>&1 || true' EXIT
docker run -d --name "$NAME" --network none -e POSTGRES_PASSWORD=restore-test \
  -e POSTGRES_USER=studio -e POSTGRES_DB=studio "$IMAGE" >/dev/null
# Over TCP on purpose: the init phase runs a socket-only server that answers and then restarts.
for _ in $(seq 1 30); do
  docker exec "$NAME" psql -h 127.0.0.1 -U studio -d studio -c 'select 1' >/dev/null 2>&1 && break
  sleep 2
done
docker exec -i "$NAME" pg_restore -U studio -d studio --no-owner --exit-on-error <"$DUMP"
counts=$(docker exec "$NAME" psql -U studio -d studio -Atc \
  "select (select count(*) from jobs)||' jobs, '||(select count(*) from audit_log)||' audit rows'")
echo "$(date -u +%FT%TZ) ok $DUMP: $counts"
```

- [ ] **Step 3: units** — copiar as quatro units do `algumacoisa-agentica/infra/ash-mail/backup/`
trocando nomes, descrições e caminhos (`/opt/ash-studio/backup/backup.sh`,
`/opt/ash-studio/backup/restore-test.sh`); timers `03:35 UTC` diário (backup) e domingo
`05:00 UTC` (restauração). Instalar em `/opt/ash-studio/backup/` e `/etc/systemd/system/`,
`sudo systemctl daemon-reload && sudo systemctl enable --now ash-studio-backup.timer ash-studio-restauracao.timer`.

- [ ] **Step 4: offsite** — no `offsite.sh` (repo e `/opt/ash-backup/offsite.sh`), acrescentar
`/var/backups/ash-studio/diario` à lista do `find` da linha 22.

- [ ] **Step 5: provas** — `sudo systemctl start ash-studio-backup` → journal `ok`;
`sudo systemctl start ash-studio-restauracao` → `ok ... jobs, ... audit rows`;
`sudo systemctl start ash-offsite` → o `.age` do studio aparece na livro
(`ssh livro-vps 'sudo ls /srv/backups/agent-rails/'`).
- [ ] **Step 6:** commits `ops(studio): backup diario e prova semanal de restauracao` (ash-web) e o
do `offsite.sh` no `algumacoisa-agentica`.

### Task 16: CI

**Files:** Create `.github/workflows/studio.yml`.

- [ ] **Step 1**

```yaml
name: studio

on:
  push:
    branches: [main]
    paths: ["studio/**", ".github/workflows/studio.yml"]
  pull_request:
    paths: ["studio/**", ".github/workflows/studio.yml"]

jobs:
  check:
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: studio
    services:
      postgres:
        image: postgres:17-alpine
        env:
          POSTGRES_USER: studio
          POSTGRES_PASSWORD: studio
          POSTGRES_DB: studio_test
        ports: ["5432:5432"]
        options: >-
          --health-cmd "pg_isready -U studio" --health-interval 5s --health-timeout 5s --health-retries 10
    env:
      TEST_DATABASE_URL: postgres://studio:studio@localhost:5432/studio_test
      # boringco's integration suite never ran in CI; here a missing database fails the job.
      REQUIRE_DB_TESTS: "1"
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with:
          version: 9
      - uses: actions/setup-node@v4
        with:
          node-version: 24
          cache: pnpm
          cache-dependency-path: studio/pnpm-lock.yaml
      - run: pnpm install --frozen-lockfile
      - run: pnpm typecheck
      - run: pnpm test
      - run: pnpm build
```

- [ ] **Step 2:** commit `ci(studio): typecheck, testes com Postgres real e build`. Roda quando o
branch for enviado ao GitHub; conferir o primeiro resultado.

### Task 17: Documentação

**Files:** Create `studio/README.md`; Modify `CLAUDE.md`, `docs/CODEMAP.md`, `docs/ROADMAP.md`,
`CHANGELOG.md`, `docs/plans/2026-09-30-ash-studio-desenho.md` (correção do workspace).

- [ ] **Step 1: `studio/README.md`** (PT): o que é; `pnpm dev` com `.env.local`; testes (túnel +
`deploy/testdb.sh`; sem `TEST_DATABASE_URL` as suítes de banco são puladas com aviso); deploy
(`deploy/deploy.sh`); onde ficam segredos (`/opt/ash-studio/.env`); backup e restauração; a regra
"toda página, rota e server action chama `requireAdmin()`".
- [ ] **Step 2: `CLAUDE.md`** — seção "studio/": pacote independente; `requireAdmin()` obrigatório;
escrita confere linhas (`expectOne`); trabalho demorado vira job; sem pixel nem rastreio.
- [ ] **Step 3:** CODEMAP (mapa do `studio/`), ROADMAP (decisão 1 resolvida — controlador e
lgpd@; blog agora = ash-studio M0–M3; X e prospecção depois), CHANGELOG `[Não publicado]`.
- [ ] **Step 4:** commit `docs: ash-studio M0 (README, CLAUDE, CODEMAP, ROADMAP, CHANGELOG)`.

---

## Critério de pronto do M0 (spec §6)

`https://studio.ash.app.br/api/health` verde atrás do Access · `pub.` 404 fora das rotas liberadas ·
worker registrando ciclo · backup restaurado na prova · CI verde no primeiro envio do branch.

> Executado em 01/10 com desvios registrados no CHANGELOG/README: 5 serviços (conector próprio do túnel), Postgres 17.11, CI lê packageManager, .npmrc hoisted.
