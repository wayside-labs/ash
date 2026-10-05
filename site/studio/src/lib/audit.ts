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
