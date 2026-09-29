import {
  compileRunnerBundle,
  compileRunnerConfig,
  compileRunnerConfigForAgent,
  runnerBundleFilename,
  runnerConfigFilename,
  skillsInScope,
} from "@/lib/mcp-config";
import { serverT } from "@/lib/server/i18n";
import { ensureIngestToken, ingestBaseUrl, userOpsScope } from "@/lib/server/ops";
import { assertSameOrigin } from "@/lib/server/origin";
import { stateAccessResponse } from "@/lib/server/state/access";
import { readState } from "@/lib/server/store";
import { createZip } from "@/lib/zip";

export const dynamic = "force-dynamic";

/**
 * Compiles a workflow's enabled MCPs into a runner config and hands it back as
 * a download. This runs on the server because it is the one place allowed to
 * emit whole env values: `maskState` bullets them out everywhere else, so the
 * browser cannot build this file from the state it holds.
 *
 * The body is the `mcpServers` map, which `.mcp.json` and
 * `claude_desktop_config.json` share — save it under either name. With `format=zip` it is
 * the runner bundle instead: that map plus every in-scope skill as `SKILL.md`.
 *
 * The rails server is given this dashboard's ingest URL and the workflow's token (issued on
 * first export), so its denials and review requests reach the dashboard and its channels.
 */
export async function GET(req: Request) {
  const denied = assertSameOrigin(req);
  if (denied) return denied;

  const workflowId = new URL(req.url).searchParams.get("workflowId");
  const agentId = new URL(req.url).searchParams.get("agentId");
  const format = new URL(req.url).searchParams.get("format") ?? "json";
  if (format !== "json" && format !== "zip") {
    return Response.json({ error: await serverT("api.error.invalidPayload") }, { status: 400 });
  }
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

  let ingest: { url: string; token: string };
  try {
    ingest = {
      url: ingestBaseUrl(req),
      token: await ensureIngestToken(await userOpsScope(), workflow.id),
    };
  } catch (error) {
    const denied = stateAccessResponse(error);
    if (denied) return denied;
    throw error;
  }
  const { config, skipped } = agent
    ? compileRunnerConfigForAgent(agent, workflow, state.mcps, { ingest })
    : compileRunnerConfig(workflow, state.mcps, { ingest });

  // Counts the client needs for its toast. The body carries secrets, so the page reads it
  // as an opaque blob and never parses it back into state.
  const counts = {
    "X-Runner-Servers": String(Object.keys(config.mcpServers).length),
    "X-Runner-Skipped": String(skipped.length),
  };

  if (format === "zip") {
    const { entries, skillCount } = compileRunnerBundle(
      config,
      skillsInScope(state.skills, workflow, agent),
    );
    return new Response(Buffer.from(createZip(entries)), {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${runnerBundleFilename(workflow.name, agent?.name)}"`,
        "Cache-Control": "no-store",
        ...counts,
        "X-Runner-Skills": String(skillCount),
      },
    });
  }

  return new Response(`${JSON.stringify(config, null, 2)}\n`, {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="${runnerConfigFilename(workflow.name, agent?.name)}"`,
      "Cache-Control": "no-store",
      ...counts,
    },
  });
}
