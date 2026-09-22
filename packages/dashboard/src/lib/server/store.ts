import { randomUUID } from "node:crypto";
import type { DashboardState } from "@/lib/schema";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { requirePostgresContext } from "./state/context";
import * as postgres from "./state/postgres";
import * as json from "./store-json";

export { StateAccessError } from "./state/context";
export { storePath } from "./store-json";

export async function readState(): Promise<DashboardState> {
  if (isSupabaseConfigured()) {
    const ctx = await requirePostgresContext();
    return postgres.readState(ctx);
  }
  return json.readState();
}

export async function mutateState<T>(
  fn: (state: DashboardState) => T | Promise<T>,
): Promise<{ state: DashboardState; result: T }> {
  if (isSupabaseConfigured()) {
    const ctx = await requirePostgresContext();
    return postgres.mutateState(ctx, fn);
  }
  return json.mutateState(fn);
}

export async function resetState(): Promise<DashboardState> {
  if (isSupabaseConfigured()) {
    const ctx = await requirePostgresContext();
    return postgres.resetState(ctx);
  }
  return json.resetState();
}

export function newId(prefix: string): string {
  if (isSupabaseConfigured()) return randomUUID();
  return json.newId(prefix);
}
