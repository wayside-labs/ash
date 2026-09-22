import { z } from "zod";
import { t } from "@/i18n";
import { solanaClusterSchema } from "@/lib/schema";
import { getDashboardLocale, serverT } from "@/lib/server/i18n";
import { streamAnthropicApi } from "@/lib/server/llm/anthropic-api";
import { isClaudeCliModel, streamClaudeCli } from "@/lib/server/llm/claude-cli";
import { buildContext } from "@/lib/server/llm/context";
import { getDemoReply, getSystemPrompt, transcriptRoleLabel } from "@/lib/server/llm/i18n";
import { withContextLocalized } from "@/lib/server/llm/prompt";
import { anthropicApiKey, resolveProvider } from "@/lib/server/llm/providers";
import { assertSameOrigin } from "@/lib/server/origin";
import { acquireSlot, checkFixedWindow } from "@/lib/server/rate-limit";
import { stateAccessResponse } from "@/lib/server/state/access";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const requestSchema = z.object({
  messages: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string() })).min(1),
  model: z.string().optional(),
  cluster: solanaClusterSchema.default("devnet"),
  rpc: z.string().nullable().default(null),
});

function textStream(
  source: AsyncIterable<string>,
  onError: (e: unknown) => string,
  onSettled?: () => void,
): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const chunk of source) controller.enqueue(encoder.encode(chunk));
      } catch (error) {
        controller.enqueue(encoder.encode(onError(error)));
      } finally {
        controller.close();
        onSettled?.();
      }
    },
  });
  return new Response(stream, {
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}

export async function POST(req: Request) {
  const denied = assertSameOrigin(req);
  if (denied) return denied;
  // Tighter than the generic bucket: this is the most expensive route in the
  // repository, and the window is only half the defence — see acquireSlot below.
  const limited = checkFixedWindow("chat", 20);
  if (limited) return limited;

  const parsed = requestSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: await serverT("api.error.invalidPayload") }, { status: 422 });
  }
  const { messages, model, cluster, rpc } = parsed.data;
  const last = messages[messages.length - 1]?.content ?? "";
  const locale = await getDashboardLocale();

  const { provider, model: chosen } = await resolveProvider(model);

  if (provider === "demo") {
    return new Response(getDemoReply(locale, last), {
      headers: { "content-type": "text/plain; charset=utf-8", "x-agent-rails-mode": "demo" },
    });
  }

  // The snapshot is tenant data, unlike the locale and the provider probe
  // above — an unreadable state is a 401 here, not an empty context.
  let context: string;
  try {
    context = await buildContext(cluster, rpc);
  } catch (error) {
    const stateDenied = stateAccessResponse(error);
    if (stateDenied) return stateDenied;
    throw error;
  }
  const systemPrompt = getSystemPrompt(locale);

  if (provider === "claude-cli" && isClaudeCliModel(chosen)) {
    const transcript = messages
      .slice(0, -1)
      .map((m) => `${transcriptRoleLabel(locale, m.role)}: ${m.content}`)
      .join("\n");
    const prompt = withContextLocalized(
      locale,
      context,
      transcript ? `${transcript}\n\n${transcriptRoleLabel(locale, "user")}: ${last}` : last,
    );

    // `maxDuration = 120` is per request and caps nothing collectively: without this,
    // N requests are N live two-minute calls, each one a `claude` process or a paid
    // stream. Taken immediately before the stream so that nothing which can throw
    // sits between the acquire and the release.
    const slot = acquireSlot("chat");
    if (slot instanceof Response) return slot;

    const response = textStream(
      streamClaudeCli({
        prompt,
        systemPrompt,
        model: chosen,
        signal: req.signal,
      }),
      (error) =>
        `\n\n⚠️ ${error instanceof Error ? error.message : t("llm.error.claudeCliFailed", locale)}`,
      slot.release,
    );
    response.headers.set("x-agent-rails-mode", "claude-cli");
    return response;
  }

  const apiKey = await anthropicApiKey();
  if (!apiKey) {
    return new Response(getDemoReply(locale, last), {
      headers: { "content-type": "text/plain; charset=utf-8", "x-agent-rails-mode": "demo" },
    });
  }

  const slot = acquireSlot("chat");
  if (slot instanceof Response) return slot;

  const response = textStream(
    streamAnthropicApi({
      apiKey,
      model: chosen,
      systemPrompt,
      messages: [
        ...messages.slice(0, -1),
        { role: "user" as const, content: withContextLocalized(locale, context, last) },
      ],
      ...(req.signal ? { signal: req.signal } : {}),
    }),
    (error) => {
      console.error("[chat] anthropic api error:", error);
      return `\n\n⚠️ ${error instanceof Error ? error.message : t("llm.error.anthropicFailed", locale)}`;
    },
    slot.release,
  );
  response.headers.set("x-agent-rails-mode", "anthropic-api");
  return response;
}
