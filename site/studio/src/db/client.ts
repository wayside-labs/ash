import { type PostgresJsDatabase, drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { env } from "@/lib/env";
import * as schema from "./schema";

export type Db = PostgresJsDatabase<typeof schema>;

export function createDb(url: string, max = 5): { db: Db; close: () => Promise<void> } {
  const client = postgres(url, {
    max,
    onnotice: () => {},
    connect_timeout: 10,
    idle_timeout: 30,
    // A half-open connection must not hang fail() or the heartbeat forever.
    connection: { statement_timeout: 30_000, idle_in_transaction_session_timeout: 30_000 },
  });
  return { db: drizzle(client, { schema }), close: () => client.end() };
}

let shared: Db | undefined;
export function db(): Db {
  shared ??= createDb(env().DATABASE_URL).db;
  return shared;
}
