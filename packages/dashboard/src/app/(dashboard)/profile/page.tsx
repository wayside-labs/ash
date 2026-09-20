"use client";

import { Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { useDashboardState, useUpdateProfile } from "@/hooks/use-dashboard";
import { truncateAddress } from "@/lib/utils";
import { useAppStore } from "@/stores/app-store";

export default function ProfilePage() {
  const { walletAddress, walletName } = useAppStore();
  const { data, isLoading } = useDashboardState();
  const save = useUpdateProfile();
  const toast = useToast();

  const [form, setForm] = useState({ displayName: "", company: "", bio: "", email: "" });
  const [dirty, setDirty] = useState(false);

  // Seed the form once the stored profile arrives, but never clobber edits in
  // flight — a background refetch must not wipe what the user is typing.
  useEffect(() => {
    if (data?.profile && !dirty) setForm(data.profile);
  }, [data?.profile, dirty]);

  const set = (key: keyof typeof form) => (value: string) => {
    setDirty(true);
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const submit = async () => {
    try {
      await save.mutateAsync(form);
      setDirty(false);
      toast("Perfil salvo.");
    } catch (error) {
      toast(error instanceof Error ? error.message : "Falha ao salvar", "error");
    }
  };

  return (
    <div>
      <PageHeader title="Profile" description="Seu perfil e wallet principal" />

      <Card className="max-w-xl">
        <CardHeader>
          <CardTitle>Informações pessoais</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {isLoading ? (
            <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Carregando…
            </div>
          ) : (
            <>
              <div className="flex items-center gap-4">
                <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted text-2xl">
                  {form.displayName ? form.displayName.slice(0, 1).toUpperCase() : "👤"}
                </div>
                <p className="text-xs text-muted-foreground">
                  A inicial vem do nome de exibição. Upload de foto exige um bucket de arquivos, que
                  ainda não existe neste projeto.
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="pf-name">Nome de exibição</Label>
                <Input
                  id="pf-name"
                  value={form.displayName}
                  onChange={(e) => set("displayName")(e.target.value)}
                  placeholder="Seu nome"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="pf-company">Empresa</Label>
                <Input
                  id="pf-company"
                  value={form.company}
                  onChange={(e) => set("company")(e.target.value)}
                  placeholder="Nome da empresa"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="pf-email">Email</Label>
                <Input
                  id="pf-email"
                  type="email"
                  value={form.email}
                  onChange={(e) => set("email")(e.target.value)}
                  placeholder="seu@email.com"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="pf-bio">Bio</Label>
                <Textarea
                  id="pf-bio"
                  rows={3}
                  value={form.bio}
                  onChange={(e) => set("bio")(e.target.value)}
                  placeholder="Conte um pouco sobre você…"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="pf-wallet">Wallet principal</Label>
                <Input
                  id="pf-wallet"
                  readOnly
                  value={
                    walletAddress
                      ? `${walletName ? `${walletName} · ` : ""}${truncateAddress(walletAddress, 8)}`
                      : "Nenhuma wallet conectada"
                  }
                  className="num"
                />
              </div>

              <Button onClick={submit} disabled={save.isPending || !dirty}>
                {save.isPending ? "Salvando…" : dirty ? "Salvar alterações" : "Tudo salvo"}
              </Button>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
