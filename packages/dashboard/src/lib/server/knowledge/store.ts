import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { createAdminClient } from "@/lib/supabase/admin";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import type { OpsScope } from "../ops";

/**
 * Chunks live apart from the document rows, like events: they are large, many, and only
 * ever read by search. Scoring happens in process over the scope's chunks (see `index.ts`),
 * so both backends store the same thing and rank the same way. At the corpus sizes an
 * operator's policy docs reach, that is milliseconds; `MAX_CHUNKS_PER_SCOPE` keeps it so.
 */

export type StoredChunk = { docId: string; idx: number; text: string; embedding: number[] | null };

export const MAX_CHUNKS_PER_SCOPE = 5_000;

function chunkDir(): string {
  return join(process.env.AGENT_RAILS_HOME ?? join(homedir(), ".agent-rails"), "knowledge");
}

const chunkFile = (docId: string) => join(chunkDir(), `${docId.replace(/[^\w-]/g, "_")}.json`);

async function jsonPut(docId: string, chunks: StoredChunk[]): Promise<void> {
  await mkdir(chunkDir(), { recursive: true, mode: 0o700 });
  await writeFile(chunkFile(docId), JSON.stringify(chunks), { mode: 0o600 });
}

async function jsonLoad(docIds: string[]): Promise<StoredChunk[]> {
  const out: StoredChunk[] = [];
  for (const docId of docIds) {
    try {
      out.push(...(JSON.parse(await readFile(chunkFile(docId), "utf8")) as StoredChunk[]));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    if (out.length >= MAX_CHUNKS_PER_SCOPE) break;
  }
  return out.slice(0, MAX_CHUNKS_PER_SCOPE);
}

const isJsonStore = (scope: OpsScope) => scope.kind === "json" || !isSupabaseConfigured();

export async function putChunks(
  scope: OpsScope,
  docId: string,
  chunks: StoredChunk[],
): Promise<void> {
  if (isJsonStore(scope)) return jsonPut(docId, chunks);
  if (scope.kind !== "org") return;
  const db = createAdminClient();
  const del = await db
    .from("knowledge_chunks")
    .delete()
    .eq("org_id", scope.orgId)
    .eq("doc_id", docId);
  if (del.error) throw del.error;
  for (let i = 0; i < chunks.length; i += 200) {
    const res = await db.from("knowledge_chunks").insert(
      chunks.slice(i, i + 200).map((chunk) => ({
        org_id: scope.orgId,
        doc_id: docId,
        idx: chunk.idx,
        text: chunk.text,
        embedding: chunk.embedding,
      })),
    );
    if (res.error) throw res.error;
  }
}

export async function removeChunks(scope: OpsScope, docId: string): Promise<void> {
  if (isJsonStore(scope)) {
    await rm(chunkFile(docId), { force: true });
    return;
  }
  if (scope.kind !== "org") return;
  const res = await createAdminClient()
    .from("knowledge_chunks")
    .delete()
    .eq("org_id", scope.orgId)
    .eq("doc_id", docId);
  if (res.error) throw res.error;
}

export async function loadChunks(scope: OpsScope, docIds: string[]): Promise<StoredChunk[]> {
  if (docIds.length === 0) return [];
  if (isJsonStore(scope)) return jsonLoad(docIds);
  if (scope.kind !== "org") return [];
  const res = await createAdminClient()
    .from("knowledge_chunks")
    .select("doc_id, idx, text, embedding")
    .eq("org_id", scope.orgId)
    .in("doc_id", docIds)
    .limit(MAX_CHUNKS_PER_SCOPE);
  if (res.error) throw res.error;
  return (
    (res.data ?? []) as { doc_id: string; idx: number; text: string; embedding: number[] | null }[]
  ).map((row) => ({ docId: row.doc_id, idx: row.idx, text: row.text, embedding: row.embedding }));
}
