import { FileText, Plus, Upload } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { mockRagDocs } from "@/lib/mock-data";

const statusVariant = {
  indexed: "success" as const,
  indexing: "warning" as const,
  error: "destructive" as const,
};

export default function RagPage() {
  return (
    <div>
      <PageHeader
        title="Base de Conhecimento"
        description="Documentos que seus agentes usam para responder"
        action={
          <Button>
            <Upload className="h-4 w-4" />
            Adicionar documento
          </Button>
        }
      />
      <div className="grid gap-3">
        {mockRagDocs.map((doc) => (
          <Card key={doc.id}>
            <CardContent className="flex items-center justify-between gap-4 p-4">
              <div className="flex items-center gap-3">
                <FileText className="h-5 w-5 text-muted-foreground" />
                <div>
                  <p className="font-medium">{doc.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {doc.scopeName} · {doc.type.toUpperCase()}
                  </p>
                </div>
              </div>
              <Badge variant={statusVariant[doc.status]}>{doc.status}</Badge>
            </CardContent>
          </Card>
        ))}
      </div>
      <Button variant="outline" className="mt-4 w-full">
        <Plus className="h-4 w-4" />
        Adicionar URL ou PDF
      </Button>
    </div>
  );
}
