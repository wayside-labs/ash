import type { Locale } from "@/i18n";
import { buildSystemPrompt } from "./system-prompts";

export function getSystemPrompt(locale: Locale): string {
  if (locale === "pt-BR") return buildSystemPrompt("pt-BR");
  return buildSystemPrompt("en");
}

const DEMO_REPLIES: Record<Locale, { defi: string; vendor: string; default: string }> = {
  en: {
    defi:
      "**0 of 1 DeFi mandates can execute** — demo mode only.\n\n" +
      "Design path: **Treasury** → **Analysis Agent** (read-only) → **Kamino Action** → **Executor Agent** (session-bound). " +
      "I orchestrate phases; agents execute; you sign allowlist/policy in Phantom.\n\n" +
      "⚠️ **Demo mode** — no LLM connected. Install Claude Code or add a key in **My APIs**.",
    vendor:
      "**0 of N payments can execute** — demo mode only.\n\n" +
      "Enterprise batch design: parse CSV → allowlist preflight (atomic) → auditor quarantine → owner signs → Payment Agent runs approved subset.\n\n" +
      "⚠️ **Demo mode** — no LLM connected.",
    default:
      "I'm the Agent Rails **Chief of Staff**, but **demo mode** is active — no model available.\n\n" +
      "Install **Claude Code** (subscription) or add an Anthropic key in **My APIs**.",
  },
  "pt-BR": {
    defi:
      "**0 de 1 mandates DeFi podem executar** — apenas modo demo.\n\n" +
      "Caminho de design: **Treasury** → **Analysis Agent** (somente leitura) → **Kamino Action** → **Executor Agent** (sessão). " +
      "Eu orquestro fases; agentes executam; você assina allowlist/policy no Phantom.\n\n" +
      "⚠️ **Modo demo** — nenhum LLM conectado. Instale Claude Code ou adicione chave em **Minhas APIs**.",
    vendor:
      "**0 de N pagamentos podem executar** — apenas modo demo.\n\n" +
      "Design enterprise: parse CSV → preflight allowlist (atômico) → quarentena auditor → owner assina → Payment Agent executa subset aprovado.\n\n" +
      "⚠️ **Modo demo** — nenhum LLM conectado.",
    default:
      "Sou o **Chief of Staff** do Agent Rails, mas o **modo demo** está ativo — nenhum modelo disponível.\n\n" +
      "Instale **Claude Code** (assinatura) ou adicione chave Anthropic em **Minhas APIs**.",
  },
};

export function getDemoReply(locale: Locale, message: string): string {
  const lower = message.toLowerCase();
  const replies = DEMO_REPLIES[locale] ?? DEMO_REPLIES.en;
  if (lower.includes("defi") || lower.includes("trading") || lower.includes("kamino")) {
    return replies.defi;
  }
  if (
    lower.includes("vendor") ||
    lower.includes("supplier") ||
    lower.includes("payment") ||
    lower.includes("csv")
  ) {
    return replies.vendor;
  }
  return replies.default;
}

export function transcriptRoleLabel(locale: Locale, role: "user" | "assistant"): string {
  if (locale === "pt-BR") return role === "user" ? "Usuário" : "Assistente";
  return role === "user" ? "User" : "Assistant";
}
