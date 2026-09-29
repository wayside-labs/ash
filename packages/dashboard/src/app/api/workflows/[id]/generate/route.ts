import { z } from "zod";
import { generatorPrompts, validateProposal } from "@/lib/canvas-proposal";
import { serverT } from "@/lib/server/i18n";
import { completeText, extractJsonObject } from "@/lib/server/llm/complete";
import { assertSameOrigin } from "@/lib/server/origin";
import { acquireSlot, checkFixedWindow } from "@/lib/server/rate-limit";
import { stateAccessResponse } from "@/lib/server/state/access";
import { readState } from "@/lib/server/store";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

type Params = { params: Promise<{ id: string }> };

const bodySchema = z.object({ prompt: z.string().trim().min(3).max(2_000) });

/**
 * "Generate with AI" on the canvas: a model proposes agents, payees, tools and skills for
 * this workflow; nothing is written here. The browser shows the validated proposal and the
 * operator applies it through the ordinary resource routes, one reviewed change at a time.
 */
export async function POST(req: Request, { params }: Params) {
  const denied = assertSameOrigin(req);
  if (denied) return denied;
  const limited = checkFixedWindow("generate", 10);
  if (limited) return limited;

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: await serverT("api.error.invalidPayload") }, { status: 422 });
  }
  const { id } = await params;

  let state: Awaited<ReturnType<typeof readState>>;
  try {
    state = await readState();
  } catch (error) {
    const stateDenied = stateAccessResponse(error);
    if (stateDenied) return stateDenied;
    throw error;
  }
  const workflow = state.workflows.find((row) => row.id === id);
  if (!workflow) {
    return Response.json({ error: await serverT("api.error.notFound") }, { status: 404 });
  }
  const agents = state.agents.filter((a) => a.workflowId === workflow.id);
  const { system, prompt } = generatorPrompts({
    request: parsed.data.prompt,
    workflowName: workflow.name,
    agents,
    mcps: state.mcps,
    skills: state.skills,
  });

  // Shares the chat's concurrency slot: both spawn a CLI process or hold a paid stream.
  const slot = acquireSlot("chat");
  if (slot instanceof Response) return slot;
  try {
    const completion = await completeText({ systemPrompt: system, prompt, signal: req.signal });
    if (!completion.ok) {
      return Response.json({ error: "no model connected", provider: "demo" }, { status: 409 });
    }
    try {
      const proposal = validateProposal(extractJsonObject(completion.text), {
        agents,
        mcps: state.mcps,
        skills: state.skills,
      });
      return Response.json({ proposal, provider: completion.provider });
    } catch (error) {
      return Response.json(
        {
          error: `the model's answer was not a usable proposal: ${error instanceof Error ? error.message : String(error)}`,
        },
        { status: 502 },
      );
    }
  } finally {
    slot.release();
  }
}
