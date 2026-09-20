import { isResourceName, RESOURCE_SCHEMAS } from "@/lib/schema";
import { maskState } from "@/lib/server/present";
import { mutateState } from "@/lib/server/store";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ resource: string; id: string }> };

export async function PATCH(req: Request, { params }: Params) {
  const { resource, id } = await params;
  if (!isResourceName(resource)) {
    return Response.json({ error: `recurso desconhecido: ${resource}` }, { status: 404 });
  }
  const patch = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  // `id` is the addressing key, never a patchable field.
  delete patch.id;

  let failure: { status: number; body: unknown } | null = null;
  const { state } = await mutateState((draft) => {
    const rows = draft[resource] as Array<{ id: string }>;
    const index = rows.findIndex((row) => row.id === id);
    if (index === -1) {
      failure = { status: 404, body: { error: "não encontrado" } };
      return;
    }
    const parsed = RESOURCE_SCHEMAS[resource].safeParse({ ...rows[index], ...patch });
    if (!parsed.success) {
      failure = { status: 422, body: { error: "payload inválido", issues: parsed.error.issues } };
      return;
    }
    rows[index] = parsed.data as { id: string };
  });

  if (failure) {
    const { status, body } = failure as { status: number; body: unknown };
    return Response.json(body, { status });
  }
  return Response.json(maskState(state));
}

export async function DELETE(_req: Request, { params }: Params) {
  const { resource, id } = await params;
  if (!isResourceName(resource)) {
    return Response.json({ error: `recurso desconhecido: ${resource}` }, { status: 404 });
  }

  const { state, result } = await mutateState((draft) => {
    const rows = draft[resource] as Array<{ id: string }>;
    const index = rows.findIndex((row) => row.id === id);
    if (index === -1) return false;
    rows.splice(index, 1);
    // Deleting a workflow orphans its agents; drop them in the same write.
    if (resource === "workflows") {
      draft.agents = draft.agents.filter((agent) => agent.workflowId !== id);
    }
    return true;
  });

  if (!result) return Response.json({ error: "não encontrado" }, { status: 404 });
  return Response.json(maskState(state));
}
