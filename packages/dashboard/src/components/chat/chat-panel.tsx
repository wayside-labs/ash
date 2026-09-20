"use client";

import { Bot, Loader2, Send, Square } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Markdown } from "@/components/chat/markdown";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useChatProviders } from "@/hooks/use-dashboard";
import type { ChatMessage } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/stores/app-store";

const WELCOME: ChatMessage = {
  id: "welcome",
  role: "assistant",
  content:
    'Olá! Sou o assistente do Agent Rails. Diga o que você quer construir — por exemplo *"quero um sistema de agentes DeFi"* — e eu explico cada parte.\n\nPosso ler seus workflows e cofres on-chain, mas não assino nada: qualquer movimento de dinheiro é você quem confirma.',
  timestamp: new Date(),
};

export function ChatPanel({ className }: { className?: string }) {
  const { selectedModel, setSelectedModel, cluster, customRpc } = useAppStore();
  const providers = useChatProviders();
  const available = (providers.data?.providers ?? []).filter((p) => p.available);
  const activeProvider = available.find((p) => p.models.some((m) => m.id === selectedModel));

  // The server picks a provider when none is chosen; mirror that choice so the
  // selector states what is actually answering instead of "detectando…".
  useEffect(() => {
    if (available.length === 0) return;
    if (activeProvider) return;
    const fallback = available[0]?.models[0]?.id;
    if (fallback) setSelectedModel(fallback);
  }, [available, activeProvider, setSelectedModel]);
  const [messages, setMessages] = useState<ChatMessage[]>([WELCOME]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [mode, setMode] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const scrollToBottom = useCallback(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, []);

  useEffect(scrollToBottom, [scrollToBottom]);

  // An in-flight stream outlives the component without this.
  useEffect(() => () => abortRef.current?.abort(), []);

  const send = async () => {
    const text = input.trim();
    if (!text || streaming) return;

    const userMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: text,
      timestamp: new Date(),
    };
    const assistantId = crypto.randomUUID();
    const history = [...messages, userMsg];

    setMessages([
      ...history,
      { id: assistantId, role: "assistant", content: "", timestamp: new Date() },
    ]);
    setInput("");
    setStreaming(true);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          messages: history
            .filter((m) => m.id !== "welcome")
            .map((m) => ({ role: m.role, content: m.content })),
          ...(selectedModel ? { model: selectedModel } : {}),
          cluster,
          rpc: customRpc || null,
        }),
      });

      if (!res.ok || !res.body) {
        const detail = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(detail.error ?? `Erro ${res.status}`);
      }

      setMode(res.headers.get("x-agent-rails-mode"));

      const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += value;
        setMessages((prev) =>
          prev.map((m) => (m.id === assistantId ? { ...m, content: buffer } : m)),
        );
        scrollToBottom();
      }

      // The provider streams under an already-sent 200, so a rejected key ends
      // as a clean but empty stream. Say so instead of leaving a blank bubble.
      if (!buffer.trim()) {
        throw new Error(
          "O provedor não retornou nenhum texto. Isso costuma ser chave inválida, sem crédito ou limite de uso.",
        );
      }
    } catch (error) {
      if ((error as Error).name === "AbortError") return;
      const message =
        error instanceof Error ? error.message : "Não consegui processar sua mensagem.";
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId
            ? { ...m, content: `⚠️ ${message}\n\nVerifique a chave de API em **My APIs**.` }
            : m,
        ),
      );
    } finally {
      setStreaming(false);
      abortRef.current = null;
      scrollToBottom();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  return (
    <div className={cn("flex h-full flex-col rounded-xl border border-border bg-card", className)}>
      <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <Bot className="h-4 w-4 text-primary" />
          <span className="text-sm font-medium">Chat</span>
        </div>
        {mode === "demo" && <Badge variant="warning">modo demonstração</Badge>}
        {mode === "claude-cli" && <Badge variant="success">sua assinatura Claude</Badge>}
        {mode === "anthropic-api" && <Badge variant="outline">API por token</Badge>}
      </div>

      <ScrollArea className="flex-1 px-4">
        <div className="space-y-4 py-4">
          {messages.map((msg) => (
            <div
              key={msg.id}
              className={cn("flex", msg.role === "user" ? "justify-end" : "justify-start")}
            >
              <div
                className={cn(
                  "max-w-[85%] rounded-xl px-4 py-2.5 text-sm leading-relaxed",
                  msg.role === "user"
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-foreground",
                )}
              >
                {msg.content ? (
                  <Markdown content={msg.content} />
                ) : (
                  <span className="flex items-center gap-2 text-muted-foreground">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    Pensando…
                  </span>
                )}
              </div>
            </div>
          ))}
          <div ref={bottomRef} />
        </div>
      </ScrollArea>

      <div className="border-t border-border p-3">
        <div className="flex gap-2">
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="O que você quer construir?"
            className="max-h-32 min-h-[44px] resize-none"
            rows={1}
          />
          {streaming ? (
            <Button
              size="icon"
              variant="outline"
              aria-label="Parar"
              onClick={() => abortRef.current?.abort()}
            >
              <Square className="h-4 w-4" />
            </Button>
          ) : (
            <Button size="icon" aria-label="Enviar" onClick={send} disabled={!input.trim()}>
              <Send className="h-4 w-4" />
            </Button>
          )}
        </div>
        <div className="mt-2 flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Modelo:</span>
          <Select value={selectedModel || undefined} onValueChange={setSelectedModel}>
            <SelectTrigger className="h-7 w-auto border-0 bg-transparent text-xs">
              <SelectValue placeholder="detectando…" />
            </SelectTrigger>
            <SelectContent>
              {available.map((provider) => (
                <SelectGroup key={provider.id}>
                  <SelectLabel className="text-[10px] uppercase tracking-[0.12em]">
                    {provider.label}
                  </SelectLabel>
                  {provider.models.map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      {m.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              ))}
            </SelectContent>
          </Select>
          {activeProvider && (
            <span className="truncate text-[11px] text-faint-foreground">
              {activeProvider.detail}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
