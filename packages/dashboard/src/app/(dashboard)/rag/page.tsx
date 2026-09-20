"use client";

import { FileText, Loader2, Trash2, Upload } from "lucide-react";
import { useState } from "react";
import { DemoBadge } from "@/components/shared/demo-badge";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import { useCreateResource, useDashboardState, useDeleteResource } from "@/hooks/use-dashboard";

const statusVariant = {
  indexed: "success" as const,
  indexing: "warning" as const,
  error: "destructive" as const,
};

export default function RagPage() {
  const { data, isLoading } = useDashboardState();
  const create = useCreateResource("rag");
  const remove = useDeleteResource("rag");
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [type, setType] = useState<"pdf" | "md" | "url">("url");
  const [scopeName, setScopeName] = useState("Todos");

  const docs = data?.rag ?? [];

  const submit = async () => {
    if (!name.trim()) return;
    try {
      await create.mutateAsync({
        name: name.trim(),
        type,
        // Indexing is not implemented yet — the row records the source and
        // stays "indexing" rather than claiming a pipeline that does not run.
        status: "indexing",
        scope: scopeName === "Todos" ? "global" : "workflow",
        scopeName,
        source: url.trim() || null,
        demo: false,
      });
      toast(`"${name.trim()}" adicionado à base.`);
      setName("");
      setUrl("");
      setOpen(false);
    } catch (error) {
      toast(error instanceof Error ? error.message : "Falha ao adicionar", "error");
    }
  };

  return (
    <div>
      <PageHeader
        title="Base de Conhecimento"
        description="Documentos que seus agentes usam para responder"
        action={
          <Button onClick={() => setOpen(true)}>
            <Upload className="h-4 w-4" />
            Adicionar documento
          </Button>
        }
      />

      {isLoading ? (
        <div className="flex items-center gap-2 py-12 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Carregando…
        </div>
      ) : docs.length === 0 ? (
        <EmptyState
          icon={FileText}
          title="Base vazia"
          description="Adicione PDFs, markdown ou URLs para os agentes consultarem."
          action={{ label: "Adicionar documento", onClick: () => setOpen(true) }}
        />
      ) : (
        <div className="grid gap-3">
          {docs.map((doc) => (
            <Card key={doc.id}>
              <CardContent className="flex items-center justify-between gap-4 p-4">
                <div className="flex min-w-0 items-center gap-3">
                  <FileText className="h-5 w-5 shrink-0 text-muted-foreground" />
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="truncate font-medium">{doc.name}</p>
                      {doc.demo && <DemoBadge />}
                    </div>
                    <p className="truncate text-xs text-muted-foreground">
                      {doc.scopeName} · {doc.type.toUpperCase()}
                      {doc.source ? ` · ${doc.source}` : ""}
                    </p>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Badge variant={statusVariant[doc.status]}>{doc.status}</Badge>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Remover ${doc.name}`}
                    onClick={() => remove.mutate(doc.id)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <p className="mt-4 text-xs text-muted-foreground">
        O pipeline de indexação ainda não roda — documentos adicionados ficam registrados como
        <span className="text-foreground"> indexing</span> até haver um indexador.
      </p>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Adicionar documento</DialogTitle>
            <DialogDescription>
              Registre a fonte agora; a indexação entra quando o indexador existir.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="rag-name">Nome</Label>
              <Input id="rag-name" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="rag-url">URL ou caminho</Label>
              <Input
                id="rag-url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://… ou ./docs/manual.pdf"
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Tipo</Label>
                <Select value={type} onValueChange={(v) => setType(v as typeof type)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="url">URL</SelectItem>
                    <SelectItem value="pdf">PDF</SelectItem>
                    <SelectItem value="md">Markdown</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="rag-scope">Escopo</Label>
                <Input
                  id="rag-scope"
                  value={scopeName}
                  onChange={(e) => setScopeName(e.target.value)}
                />
              </div>
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={submit} disabled={!name.trim() || create.isPending}>
              Adicionar
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
