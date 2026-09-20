"use client";

import { AlertTriangle, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useTreasury } from "@/hooks/use-dashboard";
import { LAMPORTS_PER_SOL } from "@/lib/solana";
import { formatBaseUnits, formatSol, formatWindow, truncateAddress } from "@/lib/utils";

/**
 * Everything here is decoded straight from the Treasury, Policy and
 * AgentSession accounts — the window into what the program actually enforces,
 * as opposed to the dashboard's own labels.
 */
export function TreasuryDetail({
  address,
  onClose,
}: {
  address: string | null;
  onClose: () => void;
}) {
  const { data, isLoading, error } = useTreasury(address);

  return (
    <Dialog open={address !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Cofre on-chain</DialogTitle>
          <DialogDescription className="num text-xs">
            {truncateAddress(address, 8)}
          </DialogDescription>
        </DialogHeader>

        {isLoading && (
          <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Lendo a conta na rede…
          </div>
        )}

        {error && (
          <div className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
            <span>{error instanceof Error ? error.message : "Falha na leitura"}</span>
          </div>
        )}

        {data && (
          <div className="space-y-5 text-sm">
            <div className="grid grid-cols-2 gap-3">
              <Field
                label="Saldo do cofre (SOL)"
                value={formatSol(data.solVaultLamports / LAMPORTS_PER_SOL)}
              />
              <Field
                label="Estado"
                value={data.paused ? "Pausado" : "Ativo"}
                tone={data.paused ? "warning" : "success"}
              />
              <Field label="Dono" value={truncateAddress(data.owner, 6)} mono />
              <Field label="Operador" value={truncateAddress(data.operator, 6)} mono />
              <Field label="Sessões ativas" value={String(data.activeSessions)} />
              <Field label="Políticas" value={String(data.policyCount)} />
            </div>

            <section>
              <h3 className="mb-2 text-sm font-medium">Políticas</h3>
              {data.policies.length === 0 ? (
                <p className="text-xs text-muted-foreground">Nenhuma política aberta.</p>
              ) : (
                <div className="space-y-3">
                  {data.policies.map((policy) => (
                    <div key={policy.address} className="rounded-lg border border-border p-3">
                      <div className="mb-2 flex items-center gap-2">
                        <span className="font-medium">{policy.name || "(sem nome)"}</span>
                        {policy.requireMemo && <Badge variant="outline">memo obrigatório</Badge>}
                      </div>
                      {policy.limits.map((limit) => {
                        const dec = data.decimals[limit.mint];
                        return (
                          <div key={limit.mint} className="grid grid-cols-2 gap-1 text-xs">
                            <span className="num col-span-2 text-faint-foreground">
                              {truncateAddress(limit.mint, 6)}
                            </span>
                            <span className="text-muted-foreground">Por transação</span>
                            <span className="num num-col text-right">
                              {formatBaseUnits(limit.perTxMax, dec)}
                            </span>
                            <span className="text-muted-foreground">
                              Janela curta ({formatWindow(limit.shortWindowSeconds)})
                            </span>
                            <span className="num num-col text-right">
                              {formatBaseUnits(limit.shortWindowMax, dec)}
                            </span>
                            <span className="text-muted-foreground">
                              Janela longa ({formatWindow(limit.longWindowSeconds)})
                            </span>
                            <span className="num num-col text-right">
                              {formatBaseUnits(limit.longWindowMax, dec)}
                            </span>
                            <span className="text-muted-foreground">Vida da sessão</span>
                            <span className="num num-col text-right">
                              {formatBaseUnits(limit.lifetimeMax, dec)}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section>
              <h3 className="mb-2 text-sm font-medium">Sessões</h3>
              {data.sessions.length === 0 ? (
                <p className="text-xs text-muted-foreground">Nenhuma sessão nesta treasury.</p>
              ) : (
                <div className="space-y-2">
                  {data.sessions.map((session) => (
                    <div
                      key={session.address}
                      className="flex items-center justify-between rounded-lg border border-border p-3 text-xs"
                    >
                      <div>
                        <p className="font-medium">{session.label || "(sem rótulo)"}</p>
                        <p className="num text-muted-foreground">
                          {truncateAddress(session.sessionKey, 5)}
                        </p>
                      </div>
                      <div className="text-right">
                        <Badge variant={session.revoked ? "destructive" : "success"}>
                          {session.revoked ? "revogada" : "ativa"}
                        </Badge>
                        <p className="mt-1 text-muted-foreground">
                          {session.seq} pagamentos · expira{" "}
                          {new Date(session.expiresAt * 1000).toLocaleDateString("pt-BR")}
                        </p>
                        {session.spend.map((counter) => (
                          <p key={counter.mint} className="text-muted-foreground">
                            gasto:{" "}
                            {formatBaseUnits(counter.lifetimeSpent, data.decimals[counter.mint])}
                          </p>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Field({
  label,
  value,
  mono,
  tone,
}: {
  label: string;
  value: string;
  mono?: boolean;
  tone?: "success" | "warning";
}) {
  const color = tone === "warning" ? "text-warning" : tone === "success" ? "text-good" : "";
  return (
    <div>
      <p className="text-xs text-subtle-foreground">{label}</p>
      <p className={`${mono ? "num text-xs" : "num font-medium"} ${color}`}>{value}</p>
    </div>
  );
}
