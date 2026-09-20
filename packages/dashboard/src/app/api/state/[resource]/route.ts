import { isResourceName, RESOURCE_SCHEMAS } from "@/lib/schema";
import { maskState } from "@/lib/server/present";
import { mutateState, newId } from "@/lib/server/store";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ resource: string }> };

export async function POST(req: Request, { params }: Params) {
  const { resource } = await params;
  if (!isResourceName(resource)) {
    return Response.json({ error: `recurso desconhecido: ${resource}` }, { status: 404 });
  }

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const candidate = {
    createdAt: new Date().toISOString(),
    ...body,
    id: newId(resource.slice(0, 3)),
  };

  const parsed = RESOURCE_SCHEMAS[resource].safeParse(candidate);
  if (!parsed.success) {
    return Response.json(
      { error: "payload inválido", issues: parsed.error.issues },
      { status: 422 },
    );
  }

  const { state } = await mutateState((draft) => {
    (draft[resource] as unknown[]).push(parsed.data);
  });
  return Response.json(
    { created: maskOne(resource, parsed.data), state: maskState(state) },
    { status: 201 },
  );
}

function maskOne(resource: string, row: unknown) {
  if (resource !== "apiKeys") return row;
  const { secret: _secret, ...rest } = row as { secret: string };
  return rest;
}
