import { profileSchema, settingsSchema } from "@/lib/schema";
import { maskState } from "@/lib/server/present";
import { mutateState, readState, resetState } from "@/lib/server/store";

export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json(maskState(await readState()));
}

/** Singletons (profile, settings) — collections go through /api/state/[resource]. */
export async function PATCH(req: Request) {
  const body = (await req.json().catch(() => ({}))) as {
    profile?: unknown;
    settings?: unknown;
  };

  const profile = body.profile === undefined ? null : profileSchema.safeParse(body.profile);
  const settings = body.settings === undefined ? null : settingsSchema.safeParse(body.settings);

  if (profile && !profile.success) {
    return Response.json(
      { error: "perfil inválido", issues: profile.error.issues },
      { status: 422 },
    );
  }
  if (settings && !settings.success) {
    return Response.json(
      { error: "preferências inválidas", issues: settings.error.issues },
      { status: 422 },
    );
  }

  const { state } = await mutateState((draft) => {
    if (profile?.success) draft.profile = profile.data;
    if (settings?.success) draft.settings = settings.data;
  });
  return Response.json(maskState(state));
}

/** Settings → Dados → "Restaurar padrões". */
export async function DELETE() {
  return Response.json(maskState(await resetState()));
}
