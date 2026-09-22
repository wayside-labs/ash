import { isResourceName, RESOURCE_SCHEMAS } from "@/lib/schema";
import { serverT } from "@/lib/server/i18n";
import { assertSameOrigin } from "@/lib/server/origin";
import { maskState, restoreMaskedEnv } from "@/lib/server/present";
import { mutateState } from "@/lib/server/store";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ resource: string; id: string }> };

export async function PATCH(req: Request, { params }: Params) {
  const denied = assertSameOrigin(req);
  if (denied) return denied;

  const { resource, id } = await params;
  if (!isResourceName(resource)) {
    return Response.json(
      { error: await serverT("api.error.unknownResource", { resource }) },
      { status: 404 },
    );
  }
  const patch = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  delete patch.id;

  let failure: { status: number; body: unknown } | null = null;
  const { state } = await mutateState((draft) => {
    const rows = draft[resource] as Array<{ id: string }>;
    const index = rows.findIndex((row) => row.id === id);
    if (index === -1) {
      failure = { status: 404, body: { error: "not found" } };
      return;
    }
    // The browser only ever saw masked env values; fold them back before the
    // merged row is validated, or saving a dialog would overwrite every secret
    // with a row of bullets.
    if (resource === "mcps" && patch.env && typeof patch.env === "object") {
      const stored = (rows[index] as { env?: Record<string, string> }).env ?? {};
      patch.env = restoreMaskedEnv(patch.env as Record<string, string>, stored);
    }

    const parsed = RESOURCE_SCHEMAS[resource].safeParse({ ...rows[index], ...patch });
    if (!parsed.success) {
      failure = {
        status: 422,
        body: { error: "invalid payload", issues: parsed.error.issues },
      };
      return;
    }
    rows[index] = parsed.data as { id: string };
  });

  if (failure) {
    const { status, body } = failure as { status: number; body: { error: string } };
    const errorKey = body.error === "not found" ? "api.error.notFound" : "api.error.invalidPayload";
    return Response.json({ ...body, error: await serverT(errorKey) }, { status });
  }
  return Response.json(maskState(state));
}

export async function DELETE(req: Request, { params }: Params) {
  const denied = assertSameOrigin(req);
  if (denied) return denied;

  const { resource, id } = await params;
  if (!isResourceName(resource)) {
    return Response.json(
      { error: await serverT("api.error.unknownResource", { resource }) },
      { status: 404 },
    );
  }

  const { state, result } = await mutateState((draft) => {
    const rows = draft[resource] as Array<{ id: string }>;
    const index = rows.findIndex((row) => row.id === id);
    if (index === -1) return false;
    rows.splice(index, 1);
    if (resource === "workflows") {
      draft.agents = draft.agents.filter((agent) => agent.workflowId !== id);
    }
    return true;
  });

  if (!result) {
    return Response.json({ error: await serverT("api.error.notFound") }, { status: 404 });
  }
  return Response.json(maskState(state));
}
