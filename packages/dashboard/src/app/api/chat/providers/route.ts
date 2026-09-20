import { listProviders } from "@/lib/server/llm/providers";

export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json({ providers: await listProviders() });
}
