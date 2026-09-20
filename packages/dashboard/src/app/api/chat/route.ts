import { createAnthropic } from "@ai-sdk/anthropic";
import { streamText } from "ai";
import { z } from "zod";
import { solanaClusterSchema } from "@/lib/schema";
import { isClaudeCliModel, streamClaudeCli } from "@/lib/server/llm/claude-cli";
import { buildContext } from "@/lib/server/llm/context";
import { SYSTEM_PROMPT, withContext } from "@/lib/server/llm/prompt";
import { anthropicApiKey, resolveProvider } from "@/lib/server/llm/providers";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const requestSchema = z.object({
  messages: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string() })).min(1),
  model: z.string().optional(),
  cluster: solanaClusterSchema.default("devnet"),
  rpc: z.string().nullable().default(null),
});

function demoReply(message: string): string {
  const lower = message.toLowerCase();
  if (lower.includes("defi") || lower.includes("trading")) {
    return "Posso te ajudar a montar um **workflow de DeFi Trading**: um cofre, um agente executor com limite diário e um agente de análise sem permissão de pagar.\n\n⚠️ Estou em **modo demonstração** — nenhum modelo está disponível. Instale o Claude Code ou adicione uma chave em **My APIs**.";
  }
  if (lower.includes("fornecedor") || lower.includes("pagamento")) {
    return "Para **pagamentos a fornecedores**, o desenho usual é: cofre da empresa, um agente com limite diário e uma lista de destinos permitidos — mesmo comprometido, o agente não paga fora da lista nem acima do limite.\n\n⚠️ Estou em **modo demonstração**.";
  }
  return "Sou o assistente do Agent Rails, mas estou em **modo demonstração** — nenhum modelo está disponível.\n\nSe você tem uma assinatura Claude, basta ter o **Claude Code** instalado nesta máquina. Caso prefira pagar por token, adicione uma chave Anthropic em **My APIs**.";
}

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
    return Response.json({ error: "payload inválido" }, { status: 422 });
  }
  const { messages, model, cluster, rpc } = parsed.data;
  const last = messages[messages.length - 1]?.content ?? "";

  const { provider, model: chosen } = await resolveProvider(model);

  if (provider === "demo") {
    return new Response(demoReply(last), {
      headers: { "content-type": "text/plain; charset=utf-8", "x-agent-rails-mode": "demo" },
    });
  }

  const context = await buildContext(cluster, rpc);

  if (provider === "claude-cli" && isClaudeCliModel(chosen)) {
    // The CLI takes a single prompt, so prior turns are folded in as transcript.
    const transcript = messages
      .slice(0, -1)
      .map((m) => `${m.role === "user" ? "Usuário" : "Assistente"}: ${m.content}`)
      .join("\n");
    const prompt = withContext(context, transcript ? `${transcript}\n\nUsuário: ${last}` : last);

    const response = textStream(
      streamClaudeCli({
        prompt,
        systemPrompt: SYSTEM_PROMPT,
        model: chosen,
        signal: req.signal,
      }),
      (error) =>
        `\n\n⚠️ ${error instanceof Error ? error.message : "Falha ao falar com o Claude Code."}`,
    );
    response.headers.set("x-agent-rails-mode", "claude-cli");
    return response;
  }

  const apiKey = await anthropicApiKey();
  if (!apiKey) {
    return new Response(demoReply(last), {
      headers: { "content-type": "text/plain; charset=utf-8", "x-agent-rails-mode": "demo" },
    });
  }

  const anthropic = createAnthropic({ apiKey });
  const result = streamText({
    // A text stream has already sent its 200 by the time the provider fails,
    // so an auth or rate-limit error would otherwise arrive as an empty body.
    onError: ({ error }) => {
      console.error("[chat] provider error:", error);
    },
    model: anthropic(chosen),
    system: SYSTEM_PROMPT,
    messages: [
      ...messages.slice(0, -1),
      { role: "user" as const, content: withContext(context, last) },
    ],
  });

  const response = result.toTextStreamResponse();
  response.headers.set("x-agent-rails-mode", "anthropic-api");
  return response;
}
