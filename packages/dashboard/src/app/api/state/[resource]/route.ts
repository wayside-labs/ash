import { isResourceName, RESOURCE_SCHEMAS } from "@/lib/schema";
import { serverT } from "@/lib/server/i18n";
import { assertSameOrigin } from "@/lib/server/origin";
import { MASKED_ENV_VALUE, maskState } from "@/lib/server/present";
import { checkFixedWindow } from "@/lib/server/rate-limit";
import { mutateState, newId } from "@/lib/server/store";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ resource: string }> };

export async function POST(req: Request, { params }: Params) {
  const denied = assertSameOrigin(req);
  if (denied) return denied;
  const limited = checkFixedWindow("api");
  if (limited) return limited;

  const { resource } = await params;
  if (!isResourceName(resource)) {
    return Response.json(
      { error: await serverT("api.error.unknownResource", { resource }) },
      { status: 404 },
    );
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
      { error: await serverT("api.error.invalidPayload"), issues: parsed.error.issues },
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

/** The echo of the created row is a read like any other — same mask applies. */
function maskOne(resource: string, row: unknown) {
  if (resource === "apiKeys") {
    const { secret: _secret, ...rest } = row as { secret: string };
    return rest;
  }
  if (resource === "mcps") {
    const mcp = row as { env: Record<string, string> };
    return {
      ...mcp,
      env: Object.fromEntries(
        Object.entries(mcp.env).map(([key, value]) => [key, value ? MASKED_ENV_VALUE : ""]),
      ),
    };
  }
  return row;
}
