import {
  compileRunnerConfig,
  compileRunnerConfigForAgent,
  runnerConfigFilename,
} from "@/lib/mcp-config";
import { serverT } from "@/lib/server/i18n";
import { assertSameOrigin } from "@/lib/server/origin";
import { stateAccessResponse } from "@/lib/server/state/access";
import { readState } from "@/lib/server/store";

export const dynamic = "force-dynamic";

/**
 * Compiles a workflow's enabled MCPs into a runner config and hands it back as
 * a download. This runs on the server because it is the one place allowed to
 * emit whole env values: `maskState` bullets them out everywhere else, so the
 * browser cannot build this file from the state it holds.
 *
 * The body is the `mcpServers` map, which `.mcp.json` and
 * `claude_desktop_config.json` share — save it under either name.
 */
export async function GET(req: Request) {
  const denied = assertSameOrigin(req);
  if (denied) return denied;

  const workflowId = new URL(req.url).searchParams.get("workflowId");
  const agentId = new URL(req.url).searchParams.get("agentId");
  if (!workflowId) {
    return Response.json({ error: await serverT("api.error.missingWorkflowId") }, { status: 400 });
  }

  let state: Awaited<ReturnType<typeof readState>>;
  try {
    state = await readState();
  } catch (error) {
    const denied = stateAccessResponse(error);
    if (denied) return denied;
    throw error;
  }
  const workflow = state.workflows.find((row) => row.id === workflowId);
  if (!workflow) {
    return Response.json({ error: await serverT("api.error.notFound") }, { status: 404 });
  }

  const agent = agentId ? state.agents.find((row) => row.id === agentId) : undefined;
  if (agentId && (!agent || agent.workflowId !== workflow.id)) {
    return Response.json({ error: await serverT("api.error.notFound") }, { status: 404 });
  }

  const { config, skipped } = agent
    ? compileRunnerConfigForAgent(agent, workflow, state.mcps, {
        alertWebhookUrl: state.settings.alertWebhookUrl,
      })
    : compileRunnerConfig(workflow, state.mcps, {
        alertWebhookUrl: state.settings.alertWebhookUrl,
      });

  return new Response(`${JSON.stringify(config, null, 2)}\n`, {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="${runnerConfigFilename(workflow.name, agent?.name)}"`,
      "Cache-Control": "no-store",
      // Counts the client needs for its toast. The body carries secrets, so the
      // page reads it as an opaque blob and never parses it back into state.
      "X-Runner-Servers": String(Object.keys(config.mcpServers).length),
      "X-Runner-Skipped": String(skipped.length),
    },
  });
}
