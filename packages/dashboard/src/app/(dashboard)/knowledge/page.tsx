"use client";

import { useQueryClient } from "@tanstack/react-query";
import { BookOpen, FileUp, Loader2, RefreshCw, Search, Trash2 } from "lucide-react";
import { useRef, useState } from "react";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { useDashboardState } from "@/hooks/use-dashboard";
import { useTranslation } from "@/i18n/locale-provider";
import type { Scope } from "@/lib/types";

type Hit = { docId: string; docName: string; idx: number; text: string; score: number };

const STATUS_VARIANT = { indexed: "success", indexing: "warning", error: "destructive" } as const;

export default function KnowledgePage() {
  const { t } = useTranslation();
  const { data, isLoading } = useDashboardState();
  const client = useQueryClient();
  const toast = useToast();
  const fileInput = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [markdown, setMarkdown] = useState("");
  const [scope, setScope] = useState<Scope>("global");
  const [scopeName, setScopeName] = useState("");
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [searchMode, setSearchMode] = useState("");

  const docs = (data?.rag ?? []).filter((doc) => !doc.demo);
  const workflows = data?.workflows ?? [];
  const agents = data?.agents ?? [];

  const refresh = () => client.invalidateQueries({ queryKey: ["state"] });

  const submit = async (init: RequestInit, label: string) => {
    setBusy(label);
    try {
      const res = await fetch("/api/knowledge", { method: "POST", ...init });
      const body = (await res.json().catch(() => ({}))) as {
        error?: string;
        document?: { status: string; error: string | null; chunkCount: number; mode: string };
      };
      if (body.document?.status === "indexed") {
        toast(
          t("knowledge.indexed", {
            chunks: String(body.document.chunkCount),
            mode: t(`knowledge.mode.${body.document.mode}`),
          }),
        );
        setName("");
        setUrl("");
        setMarkdown("");
      } else {
        toast(body.document?.error ?? body.error ?? `${res.status}`, "error");
      }
    } finally {
      setBusy(null);
      await refresh();
    }
  };

  const meta = () => ({
    name: name.trim(),
    scope,
    scopeName: scope === "global" ? "All" : scopeName,
  });

  const addUrl = () =>
    submit(
      {
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          type: "url",
          url: url.trim(),
          ...meta(),
          name: name.trim() || url.trim(),
        }),
      },
      "url",
    );

  const addMarkdown = () =>
    submit(
      {
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ type: "md", content: markdown, ...meta() }),
      },
      "md",
    );

  const upload = async (files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
    const form = new FormData();
    form.set("file", file);
    form.set("name", name.trim() || file.name);
    form.set("scope", scope);
    form.set("scopeName", scope === "global" ? "All" : scopeName);
    await submit({ body: form }, "file");
    if (fileInput.current) fileInput.current.value = "";
  };

  const remove = async (id: string) => {
    setBusy(id);
    try {
      const res = await fetch(`/api/knowledge/${id}`, { method: "DELETE" });
      if (!res.ok) toast(t("common.failedToSave"), "error");
    } finally {
      setBusy(null);
      await refresh();
    }
  };

  const reindex = async (id: string) => {
    setBusy(id);
    try {
      const res = await fetch(`/api/knowledge/${id}/reindex`, { method: "POST" });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) toast(body.error ?? `${res.status}`, "error");
    } finally {
      setBusy(null);
      await refresh();
    }
  };

  const runSearch = async () => {
    if (!query.trim()) return;
    setBusy("search");
    try {
      const res = await fetch(`/api/knowledge/search?q=${encodeURIComponent(query.trim())}`);
      const body = (await res.json()) as { hits: Hit[]; mode: string };
      setHits(body.hits);
      setSearchMode(body.mode);
    } finally {
      setBusy(null);
    }
  };

  const scopeOptions =
    scope === "workflow"
      ? workflows.map((w) => w.name)
      : scope === "agent"
        ? agents.map((a) => a.name)
        : [];

  return (
    <div className="space-y-6">
      <PageHeader title={t("knowledge.title")} description={t("knowledge.description")} />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("knowledge.add")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1">
              <Label htmlFor="kb-name">{t("common.name")}</Label>
              <Input id="kb-name" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>{t("common.scope")}</Label>
              <Select
                value={scope}
                onValueChange={(v) => {
                  setScope(v as Scope);
                  setScopeName("");
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="global">{t("common.global")}</SelectItem>
                  <SelectItem value="workflow">{t("common.byWorkflowLower")}</SelectItem>
                  <SelectItem value="agent">{t("common.byAgentLower")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {scope !== "global" && (
              <div className="space-y-1">
                <Label>{t("knowledge.scopeTarget")}</Label>
                <Select value={scopeName} onValueChange={setScopeName}>
                  <SelectTrigger>
                    <SelectValue placeholder="—" />
                  </SelectTrigger>
                  <SelectContent>
                    {scopeOptions.map((option) => (
                      <SelectItem key={option} value={option}>
                        {option}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
          <Tabs defaultValue="url">
            <TabsList>
              <TabsTrigger value="url">URL</TabsTrigger>
              <TabsTrigger value="md">Markdown</TabsTrigger>
              <TabsTrigger value="file">{t("knowledge.upload")}</TabsTrigger>
            </TabsList>
            <TabsContent value="url" className="flex gap-2">
              <Input
                placeholder="https://docs.example.com/policy"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
              />
              <Button onClick={addUrl} disabled={!url.trim() || busy !== null}>
                {busy === "url" && <Loader2 className="h-4 w-4 animate-spin" />}
                {t("knowledge.index")}
              </Button>
            </TabsContent>
            <TabsContent value="md" className="space-y-2">
              <Textarea
                value={markdown}
                onChange={(e) => setMarkdown(e.target.value)}
                className="min-h-[160px] font-mono text-xs"
              />
              <Button
                onClick={addMarkdown}
                disabled={!markdown.trim() || !name.trim() || busy !== null}
              >
                {busy === "md" && <Loader2 className="h-4 w-4 animate-spin" />}
                {t("knowledge.index")}
              </Button>
            </TabsContent>
            <TabsContent value="file">
              <input
                ref={fileInput}
                type="file"
                accept=".pdf,.md,.txt,application/pdf,text/markdown,text/plain"
                className="hidden"
                onChange={(e) => upload(e.target.files)}
              />
              <Button
                variant="outline"
                onClick={() => fileInput.current?.click()}
                disabled={busy !== null}
              >
                {busy === "file" ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <FileUp className="h-4 w-4" />
                )}
                {t("knowledge.chooseFile")}
              </Button>
            </TabsContent>
          </Tabs>
          <p className="text-xs text-muted-foreground">{t("knowledge.hint")}</p>
        </CardContent>
      </Card>

      {isLoading ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : docs.length === 0 ? (
        <EmptyState
          icon={BookOpen}
          title={t("knowledge.emptyTitle")}
          description={t("knowledge.emptyDescription")}
        />
      ) : (
        <div className="grid gap-2">
          {docs.map((doc) => (
            <Card key={doc.id}>
              <CardContent className="flex flex-wrap items-center gap-2 p-3">
                <Badge variant={STATUS_VARIANT[doc.status]}>
                  {t(`knowledge.status.${doc.status}`)}
                </Badge>
                <span className="font-medium">{doc.name}</span>
                <Badge variant="outline">{doc.type.toUpperCase()}</Badge>
                {doc.mode && <Badge variant="secondary">{t(`knowledge.mode.${doc.mode}`)}</Badge>}
                <span className="text-xs text-muted-foreground">
                  {doc.scope === "global" ? t("common.global") : doc.scopeName} ·{" "}
                  {t("knowledge.chunks", { count: String(doc.chunkCount) })}
                </span>
                {doc.error && <span className="text-xs text-critical">{doc.error}</span>}
                <div className="ml-auto flex gap-1">
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label={t("knowledge.reindex")}
                    disabled={busy !== null}
                    onClick={() => reindex(doc.id)}
                  >
                    {busy === doc.id ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <RefreshCw className="h-4 w-4" />
                    )}
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label={t("knowledge.remove", { name: doc.name })}
                    disabled={busy !== null}
                    onClick={() => remove(doc.id)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("knowledge.testSearch")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void runSearch();
            }}
          >
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("knowledge.searchPlaceholder")}
            />
            <Button type="submit" variant="secondary" disabled={!query.trim() || busy !== null}>
              <Search className="h-4 w-4" />
              {t("knowledge.search")}
            </Button>
          </form>
          {hits && (
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">
                {t("knowledge.searchMode", { mode: searchMode })}
              </p>
              {hits.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t("knowledge.noHits")}</p>
              ) : (
                hits.map((hit) => (
                  <div key={`${hit.docId}-${hit.idx}`} className="rounded-md border p-2 text-sm">
                    <p className="text-xs text-muted-foreground">
                      {hit.docName} · #{hit.idx} · {hit.score.toFixed(3)}
                    </p>
                    <p className="line-clamp-4 whitespace-pre-wrap">{hit.text}</p>
                  </div>
                ))
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
