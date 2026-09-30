import { z } from "zod";
import { addressSchema, solanaClusterSchema } from "@/lib/schema";
import { serverT } from "@/lib/server/i18n";
import { assertSameOrigin } from "@/lib/server/origin";
import { maskState } from "@/lib/server/present";
import { checkFixedWindow } from "@/lib/server/rate-limit";
import { stateAccessResponse } from "@/lib/server/state/access";
import { mutateState, newId, readState } from "@/lib/server/store";
import { applyTemplateToState } from "@/lib/templates/apply-template";
import { resolveTemplate } from "@/lib/templates/catalog";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  templateId: z.string().min(1),
  workflowName: z.string().min(1).max(120),
  cluster: solanaClusterSchema.optional(),
  ownerAddress: z.string().nullable().optional(),
  treasuryAddress: z
    .string()
    .nullable()
    .optional()
    .refine((value) => value == null || value === "" || addressSchema.safeParse(value).success, {
      message: "invalid treasury address",
    }),
});

export async function POST(req: Request) {
  const denied = assertSameOrigin(req);
  if (denied) return denied;
  const limited = checkFixedWindow("api");
  if (limited) return limited;

  const json = (await req.json().catch(() => null)) as unknown;
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return Response.json(
      { error: await serverT("api.error.invalidPayload"), issues: parsed.error.issues },
      { status: 422 },
    );
  }

  const current = await readState();
  const template = resolveTemplate(parsed.data.templateId, current.templates);
  if (!template) {
    return Response.json({ error: await serverT("templates.error.notFound") }, { status: 404 });
  }

  const treasury =
    parsed.data.treasuryAddress?.trim() === "" ? null : (parsed.data.treasuryAddress ?? null);

  try {
    const { state, result } = await mutateState((draft) => {
      const applied = applyTemplateToState(draft, {
        template,
        workflowName: parsed.data.workflowName,
        cluster: parsed.data.cluster ?? "devnet",
        ownerAddress: parsed.data.ownerAddress ?? null,
        treasuryAddress: treasury,
        newId,
        now: new Date().toISOString(),
      });
      return applied;
    });

    return Response.json({
      workflowId: result.workflowId,
      setupSteps: template.setupSteps,
      docsPath: template.docsPath,
      state: maskState(state),
    });
  } catch (error) {
    const denied = stateAccessResponse(error);
    if (denied) return denied;
    throw error;
  }
}
