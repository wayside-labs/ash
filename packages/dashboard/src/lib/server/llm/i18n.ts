import { parseContacts } from "@ash/cloak";
import type { Locale } from "@/i18n";
import { buildSystemPrompt } from "./system-prompts";

export function getSystemPrompt(locale: Locale): string {
  const contacts = parseContacts(process.env.NEXT_PUBLIC_CLOAK_CONTACTS);
  if (locale === "pt-BR") return buildSystemPrompt("pt-BR", contacts);
  return buildSystemPrompt("en", contacts);
}

const DEMO_REPLIES: Record<Locale, { defi: string; vendor: string; default: string }> = {
  en: {
    defi:
      "**0 of 1 DeFi mandates can execute** — demo mode only.\n\n" +
      "Design path: **Treasury** → **Analysis Agent** (read-only) → **Kamino Action** → **Executor Agent** (session-bound). " +
      "I orchestrate phases; agents execute; you sign allowlist/policy in Phantom.\n\n" +
      "⚠️ **Demo mode** — no LLM connected. {connect}",
    vendor:
      "**0 of N payments can execute** — demo mode only.\n\n" +
      "Enterprise batch design: parse CSV → allowlist preflight (atomic) → auditor quarantine → owner signs → Payment Agent runs approved subset.\n\n" +
      "⚠️ **Demo mode** — no LLM connected.",
    default:
      "I'm the ASH **Chief of Staff**, but **demo mode** is active — no model available.\n\n" +
      "{connect}",
  },
  "pt-BR": {
    defi:
      "**0 de 1 mandates DeFi podem executar** — apenas modo demo.\n\n" +
      "Caminho de design: **Treasury** → **Analysis Agent** (somente leitura) → **Kamino Action** → **Executor Agent** (sessão). " +
      "Eu orquestro fases; agentes executam; você assina allowlist/policy no Phantom.\n\n" +
      "⚠️ **Modo demo** — nenhum LLM conectado. {connect}",
    vendor:
      "**0 de N pagamentos podem executar** — apenas modo demo.\n\n" +
      "Design enterprise: parse CSV → preflight allowlist (atômico) → quarentena auditor → owner assina → Payment Agent executa subset aprovado.\n\n" +
      "⚠️ **Modo demo** — nenhum LLM conectado.",
    default:
      "Sou o **Chief of Staff** do ASH, mas o **modo demo** está ativo — nenhum modelo disponível.\n\n" +
      "{connect}",
  },
};

/**
 * What to do about "no model". Local installs can run the CLI or a stored key; a hosted one
 * offers neither (ADR-019, ADR-026) and only a signed-in session reaches the platform key,
 * so telling a hosted visitor to install Claude Code or fill in My APIs sends them nowhere.
 */
const DEMO_CONNECT: Record<Locale, { local: string; hosted: string }> = {
  en: {
    local: "Install **Claude Code** (subscription) or add an Anthropic key in **My APIs**.",
    hosted: "Sign in to use the hosted assistant.",
  },
  "pt-BR": {
    local:
      "Instale o **Claude Code** (assinatura) ou adicione uma chave Anthropic em **Minhas APIs**.",
    hosted: "Entre na sua conta para usar o assistente hospedado.",
  },
};

export function getDemoReply(
  locale: Locale,
  message: string,
  options: { hosted?: boolean } = {},
): string {
  const lower = message.toLowerCase();
  const replies = DEMO_REPLIES[locale] ?? DEMO_REPLIES.en;
  const connect = (DEMO_CONNECT[locale] ?? DEMO_CONNECT.en)[options.hosted ? "hosted" : "local"];
  const pick = (reply: string) => reply.replace("{connect}", connect);
  if (lower.includes("defi") || lower.includes("trading") || lower.includes("kamino")) {
    return pick(replies.defi);
  }
  if (
    lower.includes("vendor") ||
    lower.includes("supplier") ||
    lower.includes("payment") ||
    lower.includes("csv")
  ) {
    return pick(replies.vendor);
  }
  return pick(replies.default);
}

export function transcriptRoleLabel(locale: Locale, role: "user" | "assistant"): string {
  if (locale === "pt-BR") return role === "user" ? "Usuário" : "Assistente";
  return role === "user" ? "User" : "Assistant";
}
