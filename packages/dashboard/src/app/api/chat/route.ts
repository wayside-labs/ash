import { z } from "zod";
import { t } from "@/i18n";
import { CHAT_STREAM_NDJSON } from "@/lib/chat-stream";
import { solanaClusterSchema } from "@/lib/schema";
import { getDashboardLocale, serverT } from "@/lib/server/i18n";
import { chatStreamToNdjson, streamAnthropicApi } from "@/lib/server/llm/anthropic-api";
import { CHAT_TOOL_SYSTEM_APPENDIX } from "@/lib/server/llm/chat-tools";
import { isClaudeCliModel, streamClaudeCli } from "@/lib/server/llm/claude-cli";
import { buildContext } from "@/lib/server/llm/context";
import { getDemoReply, getSystemPrompt, transcriptRoleLabel } from "@/lib/server/llm/i18n";
import { withContextLocalized } from "@/lib/server/llm/prompt";
import { anthropicApiKey, resolveProvider } from "@/lib/server/llm/providers";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const requestSchema = z.object({
  messages: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string() })).min(1),
  model: z.string().optional(),
  cluster: solanaClusterSchema.default("devnet"),
  rpc: z.string().nullable().default(null),
});

function textStream(source: AsyncIterable<string>, onError: (e: unknown) => string): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const chunk of source) controller.enqueue(encoder.encode(chunk));
      } catch (error) {
        controller.enqueue(encoder.encode(onError(error)));
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, {
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}

export async function POST(req: Request) {
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

  const context = await buildContext(cluster, rpc);
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

    const response = textStream(
      streamClaudeCli({
        prompt,
        systemPrompt,
        model: chosen,
        signal: req.signal,
      }),
      (error) =>
        `\n\n⚠️ ${error instanceof Error ? error.message : t("llm.error.claudeCliFailed", locale)}`,
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

  try {
    const response = new Response(
      chatStreamToNdjson(
        streamAnthropicApi({
          apiKey,
          model: chosen,
          systemPrompt: systemPrompt + CHAT_TOOL_SYSTEM_APPENDIX,
          messages: [
            ...messages.slice(0, -1),
            { role: "user" as const, content: withContextLocalized(locale, context, last) },
          ],
          ...(req.signal ? { signal: req.signal } : {}),
          tools: true,
        }),
      ),
      {
        headers: {
          "content-type": CHAT_STREAM_NDJSON,
          "x-agent-rails-mode": "anthropic-api",
          "x-agent-rails-stream": "ndjson",
        },
      },
    );
    return response;
  } catch (error) {
    console.error("[chat] anthropic api error:", error);
    return new Response(
      `\n\n⚠️ ${error instanceof Error ? error.message : t("llm.error.anthropicFailed", locale)}`,
      {
        headers: {
          "content-type": "text/plain; charset=utf-8",
          "x-agent-rails-mode": "anthropic-api",
        },
      },
    );
  }
}
