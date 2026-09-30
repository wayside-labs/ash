import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { LedgerEntry, LedgerKind } from "@/lib/billing";
import { storePath } from "@/lib/server/store-json";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Who pays. Hosted: the caller's org, resolved from the session. Local JSON
 * mode has no tenants, so there is one ledger for the whole server.
 */
export type BillingScope = { kind: "org"; orgId: string; accountId: string } | { kind: "local" };

export type NewLedgerEntry = Omit<LedgerEntry, "id" | "createdAt"> & {
  kind: LedgerKind;
  idempotencyKey: string;
};

export interface LedgerStore {
  balance(scope: BillingScope): Promise<number>;
  entries(scope: BillingScope, limit: number): Promise<LedgerEntry[]>;
  /** False when the idempotency key was already used — the replay is a no-op, not an error. */
  append(scope: BillingScope, entry: NewLedgerEntry): Promise<boolean>;
}

type Row = {
  id: string;
  kind: LedgerKind;
  amount_micros: number | string;
  created_at: string;
  model: string | null;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  raw_cost_micros: number | string | null;
  markup_bps: number | null;
  markup_micros: number | string | null;
  estimated: boolean;
  note: string | null;
};

/** PostgREST returns bigint as a JSON number; a string only above 2^53, which no balance reaches. */
function toMicros(value: number | string): number {
  const n = typeof value === "string" ? Number(value) : value;
  if (!Number.isSafeInteger(n)) throw new RangeError(`ledger amount out of range: ${value}`);
  return n;
}

function fromRow(row: Row): LedgerEntry {
  return {
    id: row.id,
    kind: row.kind,
    amountMicros: toMicros(row.amount_micros),
    createdAt: row.created_at,
    ...(row.model ? { model: row.model } : {}),
    ...(row.prompt_tokens !== null ? { promptTokens: row.prompt_tokens } : {}),
    ...(row.completion_tokens !== null ? { completionTokens: row.completion_tokens } : {}),
    ...(row.raw_cost_micros !== null ? { rawCostMicros: toMicros(row.raw_cost_micros) } : {}),
    ...(row.markup_bps !== null ? { markupBps: row.markup_bps } : {}),
    ...(row.markup_micros !== null ? { markupMicros: toMicros(row.markup_micros) } : {}),
    ...(row.estimated ? { estimated: true } : {}),
    ...(row.note ? { note: row.note } : {}),
  };
}

function requireOrg(scope: BillingScope): { orgId: string; accountId: string } {
  if (scope.kind !== "org") throw new Error("the Postgres ledger needs an org scope");
  return scope;
}

/**
 * Service role, for reads too: the ledger has no user-writable policy by design
 * (see the migration), and reading through the same client keeps a turn's
 * balance check and its debit on one connection's view of the table. The org id
 * comes from the caller's own session, never from the request body.
 */
export const postgresLedger: LedgerStore = {
  async balance(scope) {
    const { orgId } = requireOrg(scope);
    const { data, error } = await createAdminClient().rpc("credit_balance", { p_org_id: orgId });
    if (error) throw error;
    return toMicros((data as number | string | null) ?? 0);
  },

  async entries(scope, limit) {
    const { orgId } = requireOrg(scope);
    const { data, error } = await createAdminClient()
      .from("credit_ledger")
      .select(
        "id, kind, amount_micros, created_at, model, prompt_tokens, completion_tokens, raw_cost_micros, markup_bps, markup_micros, estimated, note",
      )
      .eq("org_id", orgId)
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) throw error;
    return (data as Row[]).map(fromRow);
  },

  async append(scope, entry) {
    const { orgId, accountId } = requireOrg(scope);
    const { error } = await createAdminClient()
      .from("credit_ledger")
      .insert({
        org_id: orgId,
        account_id: accountId,
        kind: entry.kind,
        amount_micros: entry.amountMicros,
        model: entry.model ?? null,
        prompt_tokens: entry.promptTokens ?? null,
        completion_tokens: entry.completionTokens ?? null,
        raw_cost_micros: entry.rawCostMicros ?? null,
        markup_bps: entry.markupBps ?? null,
        markup_micros: entry.markupMicros ?? null,
        estimated: entry.estimated ?? false,
        note: entry.note ?? null,
        idempotency_key: entry.idempotencyKey,
      });
    // 23505: unique_violation on idempotency_key — this entry already landed.
    if (error?.code === "23505") return false;
    if (error) throw error;
    return true;
  },
};

type JsonLedger = { entries: (LedgerEntry & { idempotencyKey: string })[] };

/** Beside dashboard.json, not inside it: the state document is user-editable through the UI. */
export function ledgerPath(): string {
  return join(dirname(storePath()), "billing.json");
}

async function readJson(): Promise<JsonLedger> {
  try {
    return JSON.parse(await readFile(ledgerPath(), "utf8")) as JsonLedger;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { entries: [] };
    throw error;
  }
}

let writeChain: Promise<unknown> = Promise.resolve();

/** Local development only: one ledger for the server, same temp-file + rename as store-json. */
export const jsonLedger: LedgerStore = {
  async balance() {
    const { entries } = await readJson();
    return entries.reduce((sum, e) => sum + e.amountMicros, 0);
  },

  async entries(_scope, limit) {
    const { entries } = await readJson();
    return entries
      .slice(-limit)
      .reverse()
      .map(({ idempotencyKey: _, ...entry }) => entry);
  },

  async append(_scope, entry) {
    const run = async () => {
      const ledger = await readJson();
      if (ledger.entries.some((e) => e.idempotencyKey === entry.idempotencyKey)) return false;
      ledger.entries.push({ ...entry, id: randomUUID(), createdAt: new Date().toISOString() });
      const path = ledgerPath();
      await mkdir(dirname(path), { recursive: true });
      const tmp = `${path}.${randomUUID()}.tmp`;
      await writeFile(tmp, `${JSON.stringify(ledger, null, 2)}\n`, { mode: 0o600 });
      await rename(tmp, path);
      return true;
    };
    const next = writeChain.then(run, run);
    writeChain = next.catch(() => {});
    return next;
  },
};

export function ledgerFor(scope: BillingScope): LedgerStore {
  return scope.kind === "org" ? postgresLedger : jsonLedger;
}
