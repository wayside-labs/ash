import { removeChunks } from "@/lib/server/knowledge/store";
import { userOpsScope } from "@/lib/server/ops";
import { assertSameOrigin } from "@/lib/server/origin";
import { maskState } from "@/lib/server/present";
import { stateAccessResponse } from "@/lib/server/state/access";
import { mutateState } from "@/lib/server/store";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/** Removes the row and its chunks together, which the generic resource route cannot. */
export async function DELETE(req: Request, { params }: Params) {
  const denied = assertSameOrigin(req);
  if (denied) return denied;
  const { id } = await params;
  try {
    const scope = await userOpsScope();
    const { state, result } = await mutateState((draft) => {
      const before = draft.rag.length;
      draft.rag = draft.rag.filter((row) => row.id !== id);
      return draft.rag.length < before;
    });
    if (!result) return Response.json({ error: "not found" }, { status: 404 });
    await removeChunks(scope, id);
    return Response.json(maskState(state));
  } catch (error) {
    const stateDenied = stateAccessResponse(error);
    if (stateDenied) return stateDenied;
    throw error;
  }
}
