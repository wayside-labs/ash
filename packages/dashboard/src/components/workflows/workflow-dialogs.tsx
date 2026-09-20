"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
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
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { useCreateResource } from "@/hooks/use-dashboard";
import type { Workflow } from "@/lib/types";
import { useAppStore } from "@/stores/app-store";

const ICONS = ["🏪", "📈", "🏭", "🤖", "🛰️", "🧪", "🚚", "💼"];

export function CreateWorkflowDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const create = useCreateResource("workflows");
  const toast = useToast();
  const { cluster, walletAddress } = useAppStore();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [icon, setIcon] = useState(ICONS[0]);
  const [treasuryAddress, setTreasuryAddress] = useState("");

  const submit = async () => {
    if (!name.trim()) return;
    try {
      await create.mutateAsync({
        name: name.trim(),
        description: description.trim(),
        icon,
        cluster,
        ownerAddress: walletAddress,
        treasuryAddress: treasuryAddress.trim() || null,
        demo: false,
        demoBalanceUsd: null,
      });
      toast(`Workflow "${name.trim()}" criado.`);
      setName("");
      setDescription("");
      setTreasuryAddress("");
      onOpenChange(false);
    } catch (error) {
      toast(error instanceof Error ? error.message : "Falha ao criar o workflow", "error");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Novo workflow</DialogTitle>
          <DialogDescription>
            Um workflow agrupa agentes em torno de um cofre. Você pode criá-lo agora e conectar a
            treasury on-chain depois.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="wf-name">Nome</Label>
            <Input
              id="wf-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ex.: Pagamentos de fornecedores"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="wf-desc">Descrição</Label>
            <Textarea
              id="wf-desc"
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="O que esta operação faz"
            />
          </div>
          <div className="space-y-2">
            <Label>Ícone</Label>
            <div className="flex flex-wrap gap-2">
              {ICONS.map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => setIcon(option)}
                  className={`flex h-9 w-9 items-center justify-center rounded-lg border text-lg transition-colors ${
                    icon === option
                      ? "border-primary bg-primary/10"
                      : "border-border hover:border-primary/40"
                  }`}
                >
                  {option}
                </button>
              ))}
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="wf-treasury">Treasury on-chain (opcional)</Label>
            <Input
              id="wf-treasury"
              value={treasuryAddress}
              onChange={(e) => setTreasuryAddress(e.target.value)}
              placeholder="Endereço da treasury já criada"
              className="num text-sm"
            />
            <p className="text-xs text-muted-foreground">
              Crie uma com <code className="text-foreground">pnpm agent-rails init</code> e cole o
              endereço aqui para o dashboard ler saldo e limites reais.
            </p>
          </div>
        </div>

        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button onClick={submit} disabled={!name.trim() || create.isPending}>
            {create.isPending ? "Criando…" : "Criar workflow"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function CreateAgentDialog({
  open,
  onOpenChange,
  workflows,
  defaultWorkflowId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workflows: Workflow[];
  defaultWorkflowId?: string;
}) {
  const create = useCreateResource("agents");
  const toast = useToast();
  const [name, setName] = useState("");
  const [role, setRole] = useState("");
  const [workflowId, setWorkflowId] = useState(defaultWorkflowId ?? workflows[0]?.id ?? "");
  const [dailyLimitUsd, setDailyLimitUsd] = useState("50");
  const [walletAddress, setWalletAddress] = useState("");

  const submit = async () => {
    if (!name.trim() || !workflowId) return;
    try {
      await create.mutateAsync({
        name: name.trim(),
        role: role.trim(),
        workflowId,
        walletAddress: walletAddress.trim() || null,
        dailyLimitUsd: Number(dailyLimitUsd) || 0,
        paysTo: [],
        receivesFrom: workflows.find((w) => w.id === workflowId)?.name ?? "",
        status: "active",
        demo: false,
        demoBalanceUsd: null,
        demoSpentUsd: null,
      });
      toast(`Agente "${name.trim()}" criado.`);
      setName("");
      setRole("");
      setWalletAddress("");
      onOpenChange(false);
    } catch (error) {
      toast(error instanceof Error ? error.message : "Falha ao criar o agente", "error");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Novo agente</DialogTitle>
          <DialogDescription>
            O limite abaixo é o que a UI mostra. O limite que realmente vale é o da política
            on-chain, definida pelo operador dentro do teto do dono.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="ag-name">Nome</Label>
              <Input
                id="ag-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Ex.: CFO Bot"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="ag-role">Cargo</Label>
              <Input
                id="ag-role"
                value={role}
                onChange={(e) => setRole(e.target.value)}
                placeholder="Ex.: Contas a pagar"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label>Workflow</Label>
            <Select value={workflowId} onValueChange={setWorkflowId}>
              <SelectTrigger>
                <SelectValue placeholder="Escolha um workflow" />
              </SelectTrigger>
              <SelectContent>
                {workflows.map((workflow) => (
                  <SelectItem key={workflow.id} value={workflow.id}>
                    {workflow.icon} {workflow.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="ag-limit">Limite diário (USD)</Label>
              <Input
                id="ag-limit"
                type="number"
                min={0}
                value={dailyLimitUsd}
                onChange={(e) => setDailyLimitUsd(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="ag-wallet">Wallet do agente (opcional)</Label>
              <Input
                id="ag-wallet"
                value={walletAddress}
                onChange={(e) => setWalletAddress(e.target.value)}
                placeholder="Session key"
                className="num text-sm"
              />
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button onClick={submit} disabled={!name.trim() || !workflowId || create.isPending}>
            {create.isPending ? "Criando…" : "Criar agente"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
