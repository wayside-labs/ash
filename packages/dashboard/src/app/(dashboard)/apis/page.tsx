"use client";

import { Eye, EyeOff, Plus } from "lucide-react";
import { useState } from "react";
import { PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { mockApiKeys } from "@/lib/mock-data";

export default function ApisPage() {
  const [visible, setVisible] = useState<Record<string, boolean>>({});

  return (
    <div>
      <PageHeader
        title="My APIs"
        description="Chaves de API dos provedores de IA"
        action={
          <Button>
            <Plus className="h-4 w-4" />
            Adicionar provedor
          </Button>
        }
      />
      <div className="grid gap-4 md:grid-cols-2">
        {mockApiKeys.map((api) => (
          <Card key={api.id}>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle>{api.provider} API</CardTitle>
                <Badge variant={api.status === "connected" ? "success" : "secondary"}>
                  {api.status}
                </Badge>
              </div>
            </CardHeader>
            <CardContent>
              <Label className="mb-2 block text-xs text-muted-foreground">KEY</Label>
              <div className="flex gap-2">
                <Input
                  type={visible[api.id] ? "text" : "password"}
                  value={api.keyMasked}
                  readOnly
                  className="font-mono text-sm"
                />
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => setVisible((v) => ({ ...v, [api.id]: !v[api.id] }))}
                >
                  {visible[api.id] ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
      <Card className="mt-4 border-dashed">
        <CardContent className="flex flex-col items-center justify-center py-8 text-center">
          <p className="text-sm text-muted-foreground">
            Cole sua chave de API para habilitar modelos no chat. As chaves são armazenadas de forma
            segura no servidor.
          </p>
          <Button variant="outline" className="mt-3">
            Configurar no servidor (.env)
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
