/**
 * Embeddings through Voyage AI when `VOYAGE_API_KEY` is set (plan decision D1). Without a
 * key the knowledge base indexes lexically (BM25) — a real ranking, labelled `lexical` on
 * every document, rather than a stand-in vector that would pretend to be semantic.
 */

const ENDPOINT = "https://api.voyageai.com/v1/embeddings";
const BATCH = 64;

export function embeddingsConfigured(): boolean {
  return Boolean(process.env.VOYAGE_API_KEY?.trim());
}

export async function embed(
  texts: string[],
  inputType: "document" | "query",
  fetchImpl: typeof fetch = fetch,
): Promise<number[][]> {
  const key = process.env.VOYAGE_API_KEY?.trim();
  if (!key) throw new Error("VOYAGE_API_KEY is not set");
  const model = process.env.VOYAGE_MODEL?.trim() || "voyage-3.5-lite";
  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += BATCH) {
    const res = await fetchImpl(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({ input: texts.slice(i, i + BATCH), model, input_type: inputType }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) throw new Error(`embedding request failed: HTTP ${res.status}`);
    const body = (await res.json()) as { data?: { index: number; embedding: number[] }[] };
    const rows = [...(body.data ?? [])].sort((a, b) => a.index - b.index);
    if (rows.length !== Math.min(BATCH, texts.length - i)) {
      throw new Error("embedding response did not match the request");
    }
    out.push(...rows.map((row) => row.embedding));
  }
  return out;
}
