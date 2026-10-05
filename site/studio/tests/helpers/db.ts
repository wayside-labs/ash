import { sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { createDb } from "@/db/client";

const url = process.env.TEST_DATABASE_URL;
if (!url && process.env.REQUIRE_DB_TESTS === "1") {
  throw new Error("REQUIRE_DB_TESTS=1 but TEST_DATABASE_URL is unset — refusing to skip silently");
}
if (!url) console.warn("[studio] TEST_DATABASE_URL unset: database suites are SKIPPED");

// freshDb drops the whole public schema: never let it near a database that is not a test one.
// The message omits the URL on purpose (it carries the password).
function dbName(raw: string): string {
  try {
    return new URL(raw).pathname.slice(1);
  } catch {
    // Never echo the URL: it carries the password.
    throw new Error("TEST_DATABASE_URL is not a valid URL");
  }
}
if (url && !dbName(url).endsWith("_test")) {
  throw new Error("TEST_DATABASE_URL must point at a database whose name ends with _test");
}

export const describeDb = url ? describe : describe.skip;

export async function freshDb() {
  const handle = createDb(url as string, 4);
  await handle.db.execute(sql`drop schema if exists public cascade`);
  await handle.db.execute(sql`drop schema if exists drizzle cascade`);
  await handle.db.execute(sql`create schema public`);
  await migrate(handle.db, { migrationsFolder: "drizzle" });
  return handle;
}
