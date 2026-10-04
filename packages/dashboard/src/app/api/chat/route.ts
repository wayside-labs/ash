import { randomUUID } from "node:crypto";
import { z } from "zod";
import { intlLocale, t } from "@/i18n";
import { formatMicros } from "@/lib/billing";
import { solanaClusterSchema } from "@/lib/schema";
import type { BillingScope } from "@/lib/server/billing/ledger";
import {
  billingConfig,
  claimTurn,
  currentBalance,
  debitTurn,
  preflight,
  priceTurn,
  type ReportedUsage,
  resolveBillingScope,
} from "@/lib/server/billing/meter";
import { getDashboardLocale, serverT } from "@/lib/server/i18n";
import { streamAnthropicApi } from "@/lib/server/llm/anthropic-api";
import { isClaudeCliModel, streamClaudeCli } from "@/lib/server/llm/claude-cli";
import { buildContext } from "@/lib/server/llm/context";
import { getDemoReply, getSystemPrompt, transcriptRoleLabel } from "@/lib/server/llm/i18n";
import {
  OPENROUTER_MAX_TOKENS,
  OPENROUTER_PRICES,
  OpenRouterError,
  streamOpenRouter,
} from "@/lib/server/llm/openrouter-api";
import { fencedHistory, withContextLocalized } from "@/lib/server/llm/prompt";
import {
  anthropicApiKey,
  openrouterPlatformAccess,
  resolveProvider,
} from "@/lib/server/llm/providers";
import { assertSameOrigin } from "@/lib/server/origin";
import { acquireSlot, checkFixedWindow } from "@/lib/server/rate-limit";
import { stateAccessResponse } from "@/lib/server/state/access";
import { unauthorizedStateResponse } from "@/lib/server/state/context";
import { isSupabaseConfigured } from "@/lib/supabase/env";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * Per caller, on top of the route-wide window: the platform key is the one path
 * where a single user spends the operator's money, so one user must not be able
 * to take the whole window. Still per instance on serverless (rate-limit.ts).
 */
const PLATFORM_PER_USER_LIMIT = 10;

const requestSchema = z.object({
  messages: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string() })).min(1),
  model: z.string().optional(),
  cluster: solanaClusterSchema.default("devnet"),
  rpc: z.string().nullable().default(null),
});

/**
 * Passes the stream through and, once it ends for any reason — done, upstream
 * error, client abort — awaits `settle` with what was produced. Awaited inside
 * the generator's `finally`, so `textStream` does not close the response (and a
 * serverless function does not freeze) before the debit is written.
 */
async function* metered(
  source: AsyncIterable<string>,
  settle: (completionChars: number) => Promise<void>,
): AsyncGenerator<string, void, unknown> {
  let chars = 0;
  try {
    for await (const chunk of source) {
      chars += chunk.length;
      yield chunk;
    }
  } finally {
    await settle(chars);
  }
}

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
    return new Response(getDemoReply(locale, last, { hosted: isSupabaseConfigured() }), {
      headers: { "content-type": "text/plain; charset=utf-8", "x-agent-rails-mode": "demo" },
    });
  }

  // Checked again here, before the snapshot is built, rather than trusted from
  // resolveProvider: this is the gate on the operator's key, and it must not
  // rest on buildContext happening to 401 an anonymous caller.
  let platform: { apiKey: string; user?: string } | null = null;
  if (provider === "openrouter-platform") {
    const access = await openrouterPlatformAccess();
    if (!access.granted) {
      return unauthorizedStateResponse();
    }
    const perUser = checkFixedWindow(
      `chat:platform:${access.user ?? "local"}`,
      PLATFORM_PER_USER_LIMIT,
    );
    if (perUser) return perUser;
    platform = access.user
      ? { apiKey: access.apiKey, user: access.user }
      : { apiKey: access.apiKey };
  }

  // The snapshot is tenant data, unlike the locale and the provider probe
  // above — an unreadable state is a 401 here, not an empty context.
  let context: string;
  try {
    context = await buildContext(cluster, rpc, last);
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

  if (platform) {
    const history = fencedHistory(locale, context, messages);
    const promptChars = systemPrompt.length + history.reduce((sum, m) => sum + m.content.length, 0);
    const config = billingConfig();
    const price = OPENROUTER_PRICES[chosen];
    let billing: { scope: BillingScope; release: () => void } | null = null;

    if (config.enabled) {
      // No price means an allowlisted model nobody priced: refusing is the
      // only answer that does not serve it free.
      if (!price) {
        return Response.json({ error: t("llm.error.billingUnavailable", locale) }, { status: 503 });
      }
      const scope = await resolveBillingScope();
      if (!scope) return unauthorizedStateResponse();

      let balance: number;
      try {
        balance = await currentBalance(scope, config);
      } catch (error) {
        // Fail closed: a ledger we cannot read is not a licence to spend.
        console.error("[chat] billing ledger unavailable:", error);
        return Response.json({ error: t("llm.error.billingUnavailable", locale) }, { status: 503 });
      }
      const check = preflight(balance, price, promptChars, OPENROUTER_MAX_TOKENS, config.markupBps);
      if (!check.ok) {
        return Response.json(
          {
            error: t("llm.error.insufficientCredit", locale, {
              balance: formatMicros(check.balanceMicros, intlLocale(locale)),
              required: formatMicros(check.requiredMicros, intlLocale(locale)),
            }),
            code: "insufficient_credit",
            balanceMicros: check.balanceMicros,
            requiredMicros: check.requiredMicros,
          },
          { status: 402 },
        );
      }
      const release = claimTurn(scope);
      if (!release) {
        return Response.json({ error: t("llm.error.turnInProgress", locale) }, { status: 409 });
      }
      billing = { scope, release };
    }

    const slot = acquireSlot("chat");
    if (slot instanceof Response) {
      billing?.release();
      return slot;
    }

    let usage: ReportedUsage | null = null;
    const upstream = streamOpenRouter({
      apiKey: platform.apiKey,
      model: chosen,
      systemPrompt,
      messages: history,
      onUsage: (reported) => {
        usage = reported;
      },
      ...(platform.user ? { user: platform.user } : {}),
      ...(req.signal ? { signal: req.signal } : {}),
    });

    const turn = billing;
    const source =
      turn && price
        ? metered(upstream, async (completionChars) => {
            try {
              const priced = priceTurn(usage, price, promptChars, completionChars);
              if (priced) {
                await debitTurn(turn.scope, randomUUID(), chosen, priced, config.markupBps);
              }
            } catch (error) {
              // The reply already went out; the one thing left to do with a
              // failed write is make it loud. It is a turn served unpaid.
              console.error("[chat] billing debit failed — turn not charged:", error);
            } finally {
              turn.release();
            }
          })
        : upstream;

    const response = textStream(
      source,
      (error) => {
        console.error("[chat] openrouter error:", error);
        // Localized text only: the upstream message is about the operator's
        // account (credits, keys), which is not the chat user's business.
        const status = error instanceof OpenRouterError ? error.status : 0;
        const key =
          status === 402
            ? "llm.error.platformUnavailable"
            : status === 429
              ? "llm.error.platformBusy"
              : "llm.error.platformFailed";
        return `\n\n⚠️ ${t(key, locale)}`;
      },
      slot.release,
    );
    response.headers.set("x-agent-rails-mode", "openrouter-platform");
    return response;
  }

  const apiKey = await anthropicApiKey();
  if (!apiKey) {
    return new Response(getDemoReply(locale, last, { hosted: isSupabaseConfigured() }), {
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
      messages: fencedHistory(locale, context, messages),
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
