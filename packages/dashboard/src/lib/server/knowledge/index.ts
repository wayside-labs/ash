import type { StoredAgent, StoredRagDocument, StoredWorkflow } from "@/lib/schema";
import { appliesToAgent } from "@/lib/scope";
import type { OpsScope } from "../ops";
import { embed, embeddingsConfigured } from "./embed";
import { safeFetch } from "./safe-fetch";
import { loadChunks, putChunks, type StoredChunk } from "./store";
import { bm25, chunkText, cosine, htmlToText } from "./text";

export const MAX_DOCUMENT_BYTES = 5 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 15_000;

export type DocumentInput =
  | { type: "md"; content: string }
  | { type: "pdf"; bytes: Uint8Array }
  | { type: "url"; url: string };

async function pdfText(bytes: Uint8Array): Promise<string> {
  // Loaded on use: pdf.js is the heaviest thing on the server and most documents are not PDFs.
  const { extractText, getDocumentProxy } = await import("unpdf");
  const pdf = await getDocumentProxy(bytes);
  const { text } = await extractText(pdf, { mergePages: true });
  return Array.isArray(text) ? text.join("\n\n") : text;
}

export async function extractDocument(
  input: DocumentInput,
): Promise<{ text: string; bytes: number; kind: "md" | "pdf" | "html" | "text" }> {
  if (input.type === "md") {
    return { text: input.content, bytes: Buffer.byteLength(input.content), kind: "md" };
  }
  if (input.type === "pdf") {
    if (input.bytes.length > MAX_DOCUMENT_BYTES)
      throw new Error("document is larger than the limit");
    return { text: await pdfText(input.bytes), bytes: input.bytes.length, kind: "pdf" };
  }
  const fetched = await safeFetch(input.url, {
    maxBytes: MAX_DOCUMENT_BYTES,
    timeoutMs: FETCH_TIMEOUT_MS,
  });
  const type = fetched.contentType.toLowerCase();
  if (type.includes("application/pdf")) {
    return { text: await pdfText(fetched.bytes), bytes: fetched.bytes.length, kind: "pdf" };
  }
  const body = new TextDecoder().decode(fetched.bytes);
  if (type.includes("html"))
    return { text: htmlToText(body), bytes: fetched.bytes.length, kind: "html" };
  if (type.startsWith("text/") || type.includes("markdown") || type.includes("json")) {
    return { text: body, bytes: fetched.bytes.length, kind: "text" };
  }
  throw new Error(`unsupported content type: ${fetched.contentType || "none"}`);
}

export type IndexOutcome = Pick<
  StoredRagDocument,
  "status" | "error" | "chunkCount" | "mode" | "bytes" | "indexedAt"
>;

/** Extract, chunk, embed when configured, store. Failures become the document's `error`. */
export async function indexDocument(
  scope: OpsScope,
  docId: string,
  input: DocumentInput,
): Promise<IndexOutcome> {
  try {
    const { text, bytes } = await extractDocument(input);
    const pieces = chunkText(text);
    if (pieces.length === 0) throw new Error("no text could be extracted");
    const vectors = embeddingsConfigured() ? await embed(pieces, "document") : null;
    const chunks: StoredChunk[] = pieces.map((piece, idx) => ({
      docId,
      idx,
      text: piece,
      embedding: vectors?.[idx] ?? null,
    }));
    await putChunks(scope, docId, chunks);
    return {
      status: "indexed",
      error: null,
      chunkCount: chunks.length,
      mode: vectors ? "vector" : "lexical",
      bytes,
      indexedAt: new Date().toISOString(),
    };
  } catch (error) {
    return {
      status: "error",
      error: error instanceof Error ? error.message : String(error),
      chunkCount: 0,
      mode: null,
      bytes: 0,
      indexedAt: null,
    };
  }
}

/** Indexed documents an agent (or, with no agent, the workflow as a whole) may read. */
export function documentsInScope(
  docs: StoredRagDocument[],
  workflow?: Pick<StoredWorkflow, "name">,
  agent?: Pick<StoredAgent, "name">,
): StoredRagDocument[] {
  return docs.filter((doc) => {
    if (doc.status !== "indexed" || doc.demo) return false;
    if (doc.scope === "global") return true;
    if (!workflow) return false;
    if (agent) return appliesToAgent(doc, agent, workflow);
    return doc.scope === "workflow" && doc.scopeName === workflow.name;
  });
}

export type SearchHit = {
  docId: string;
  docName: string;
  idx: number;
  text: string;
  score: number;
};

export async function searchKnowledge(
  scope: OpsScope,
  docs: StoredRagDocument[],
  query: string,
  k = 5,
): Promise<{ hits: SearchHit[]; mode: "vector" | "lexical" | "mixed" | "empty" }> {
  const chunks = await loadChunks(
    scope,
    docs.map((d) => d.id),
  );
  if (chunks.length === 0 || !query.trim()) return { hits: [], mode: "empty" };
  const names = new Map(docs.map((d) => [d.id, d.name]));
  const vectorChunks = chunks.some((c) => c.embedding);
  const queryVector =
    vectorChunks && embeddingsConfigured() ? ((await embed([query], "query"))[0] ?? null) : null;
  const lexical = bm25(
    query,
    chunks.map((c) => c.text),
  );
  const maxLexical = Math.max(...lexical, 0) || 1;
  const scored = chunks.map((chunk, i) => ({
    docId: chunk.docId,
    docName: names.get(chunk.docId) ?? chunk.docId,
    idx: chunk.idx,
    text: chunk.text,
    // Vector chunks rank by cosine when the query can be embedded; everything else by BM25
    // normalised to [0, 1] so the two can share one list.
    score:
      queryVector && chunk.embedding
        ? cosine(queryVector, chunk.embedding)
        : (lexical[i] ?? 0) / maxLexical,
  }));
  const hits = scored
    .filter((hit) => hit.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(1, Math.min(k, 20)));
  const mode = queryVector ? (chunks.every((c) => c.embedding) ? "vector" : "mixed") : "lexical";
  return { hits, mode };
}
