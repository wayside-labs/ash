import { z } from "zod";
import { scopeSchema } from "@/lib/schema";
import { serverT } from "@/lib/server/i18n";
import { type DocumentInput, indexDocument, MAX_DOCUMENT_BYTES } from "@/lib/server/knowledge";
import { userOpsScope } from "@/lib/server/ops";
import { assertSameOrigin } from "@/lib/server/origin";
import { maskState } from "@/lib/server/present";
import { acquireSlot, checkFixedWindow } from "@/lib/server/rate-limit";
import { stateAccessResponse } from "@/lib/server/state/access";
import { mutateState, newId } from "@/lib/server/store";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const metaSchema = z.object({
  name: z.string().trim().min(1).max(120),
  scope: scopeSchema.default("global"),
  scopeName: z.string().max(80).default("All"),
});

const jsonSchema = z.discriminatedUnion("type", [
  metaSchema.extend({ type: z.literal("url"), url: z.url().max(2_000) }),
  metaSchema.extend({ type: z.literal("md"), content: z.string().min(1).max(MAX_DOCUMENT_BYTES) }),
]);

/**
 * Adds a document to the knowledge base and indexes it before answering: the row is
 * created as `indexing`, then updated to `indexed` or `error` with the reason. JSON for a
 * URL or pasted Markdown; multipart (`file`, `name`, `scope`, `scopeName`) for an upload.
 */
export async function POST(req: Request) {
  const denied = assertSameOrigin(req);
  if (denied) return denied;
  const limited = checkFixedWindow("knowledge", 20);
  if (limited) return limited;

  let meta: z.infer<typeof metaSchema>;
  let input: DocumentInput;
  let type: "pdf" | "md" | "url";
  let source: string | null = null;

  if ((req.headers.get("content-type") ?? "").includes("multipart/form-data")) {
    const form = await req.formData().catch(() => null);
    const file = form?.get("file");
    const parsed = metaSchema.safeParse({
      name: form?.get("name") || (file instanceof File ? file.name : ""),
      scope: form?.get("scope") || undefined,
      scopeName: form?.get("scopeName") || undefined,
    });
    if (!(file instanceof File) || !parsed.success) {
      return Response.json({ error: await serverT("api.error.invalidPayload") }, { status: 422 });
    }
    if (file.size > MAX_DOCUMENT_BYTES) {
      return Response.json({ error: "document is larger than 5 MB" }, { status: 413 });
    }
    meta = parsed.data;
    const bytes = new Uint8Array(await file.arrayBuffer());
    const isPdf = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
    type = isPdf ? "pdf" : "md";
    input = isPdf
      ? { type: "pdf", bytes }
      : { type: "md", content: new TextDecoder().decode(bytes) };
  } else {
    const parsed = jsonSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return Response.json({ error: await serverT("api.error.invalidPayload") }, { status: 422 });
    }
    meta = parsed.data;
    type = parsed.data.type;
    if (parsed.data.type === "url") {
      source = parsed.data.url;
      input = { type: "url", url: parsed.data.url };
    } else {
      input = { type: "md", content: parsed.data.content };
    }
  }

  // Extraction and embedding are the expensive part; one at a time per server.
  const slot = acquireSlot("knowledge");
  if (slot instanceof Response) return slot;
  try {
    const scope = await userOpsScope();
    const id = newId("rag");
    await mutateState((state) => {
      state.rag.push({
        id,
        name: meta.name,
        type,
        status: "indexing",
        scope: meta.scope,
        scopeName: meta.scope === "global" ? "All" : meta.scopeName,
        source,
        demo: false,
        error: null,
        chunkCount: 0,
        mode: null,
        bytes: 0,
        indexedAt: null,
      });
    });
    const outcome = await indexDocument(scope, id, input);
    const { state } = await mutateState((draft) => {
      const doc = draft.rag.find((row) => row.id === id);
      if (doc) Object.assign(doc, outcome);
    });
    return Response.json(
      { document: state.rag.find((row) => row.id === id), state: maskState(state) },
      { status: outcome.status === "indexed" ? 201 : 422 },
    );
  } catch (error) {
    const stateDenied = stateAccessResponse(error);
    if (stateDenied) return stateDenied;
    throw error;
  } finally {
    slot.release();
  }
}
