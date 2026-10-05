// The default is resolved from the bundle (dist/migrate.mjs -> ../drizzle, /app/drizzle in the
// image), so it does not depend on the process cwd. Runs as the one-shot `migrate` service
// before app and worker start.
import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { createDb } from "./client";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required");
const { db, close } = createDb(url, 1);
const migrationsFolder =
  process.env.MIGRATIONS_DIR ?? fileURLToPath(new URL("../drizzle", import.meta.url));
await migrate(db, { migrationsFolder });
await close();
console.log(JSON.stringify({ at: "migrate", ok: true }));
