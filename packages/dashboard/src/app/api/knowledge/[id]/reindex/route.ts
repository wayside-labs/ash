import { indexDocument } from "@/lib/server/knowledge";
import { embed, embeddingsConfigured } from "@/lib/server/knowledge/embed";
import { loadChunks, putChunks } from "@/lib/server/knowledge/store";
import { userOpsScope } from "@/lib/server/ops";
import { assertSameOrigin } from "@/lib/server/origin";
import { maskState } from "@/lib/server/present";
import { acquireSlot } from "@/lib/server/rate-limit";
import { stateAccessResponse } from "@/lib/server/state/access";
import { mutateState, readState } from "@/lib/server/store";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

type Params = { params: Promise<{ id: string }> };

/**
 * A URL is fetched again. An upload is not kept, so its stored chunks are re-embedded
 * instead — which is what turns a `lexical` document into a `vector` one after a Voyage key
 * is added.
 */
export async function POST(req: Request, { params }: Params) {
  const denied = assertSameOrigin(req);
  if (denied) return denied;
  const { id } = await params;
  const slot = acquireSlot("knowledge");
  if (slot instanceof Response) return slot;
  try {
    const scope = await userOpsScope();
    const doc = (await readState()).rag.find((row) => row.id === id);
    if (!doc) return Response.json({ error: "not found" }, { status: 404 });

    let outcome: Awaited<ReturnType<typeof indexDocument>>;
    if (doc.type === "url" && doc.source) {
      outcome = await indexDocument(scope, id, { type: "url", url: doc.source });
    } else {
      const chunks = await loadChunks(scope, [id]);
      if (chunks.length === 0 || !embeddingsConfigured()) {
        return Response.json(
          { error: "nothing to re-embed: upload the file again, or set VOYAGE_API_KEY" },
          { status: 409 },
        );
      }
      const vectors = await embed(
        chunks.map((c) => c.text),
        "document",
      );
      await putChunks(
        scope,
        id,
        chunks.map((chunk, i) => ({ ...chunk, embedding: vectors[i] ?? null })),
      );
      outcome = {
        status: "indexed",
        error: null,
        chunkCount: chunks.length,
        mode: "vector",
        bytes: doc.bytes,
        indexedAt: new Date().toISOString(),
      };
    }
    const { state } = await mutateState((draft) => {
      const row = draft.rag.find((r) => r.id === id);
      if (row) Object.assign(row, outcome);
    });
    return Response.json(maskState(state));
  } catch (error) {
    const stateDenied = stateAccessResponse(error);
    if (stateDenied) return stateDenied;
    throw error;
  } finally {
    slot.release();
  }
}
