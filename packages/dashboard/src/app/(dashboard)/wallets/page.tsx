import { Copy } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { mockWallets } from "@/lib/mock-data";
import { formatUsd, truncateAddress } from "@/lib/utils";

const typeLabels = {
  treasury: { label: "Cofre", variant: "default" as const },
  agent: { label: "Agente", variant: "secondary" as const },
  owner: { label: "Sua Wallet", variant: "outline" as const },
};

export default function WalletsPage() {
  const grouped = {
    treasury: mockWallets.filter((w) => w.type === "treasury"),
    agent: mockWallets.filter((w) => w.type === "agent"),
    owner: mockWallets.filter((w) => w.type === "owner"),
  };

  return (
    <div>
      <PageHeader title="Wallets" description="Carteiras, cofres e endereços organizados" />

      {(["treasury", "agent", "owner"] as const).map((type) => (
        <section key={type} className="mb-8">
          <h2 className="mb-3 text-sm font-medium uppercase tracking-wider text-muted-foreground">
            {typeLabels[type].label}
          </h2>
          <div className="grid gap-3">
            {grouped[type].map((wallet) => (
              <Card key={wallet.id}>
                <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{wallet.name}</span>
                      <Badge variant={typeLabels[type].variant}>{typeLabels[type].label}</Badge>
                    </div>
                    <p className="font-mono text-xs text-muted-foreground">
                      {truncateAddress(wallet.address, 6)}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Workflow: {wallet.workflowName}
                      {wallet.agentName && ` · Agente: ${wallet.agentName}`}
                    </p>
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="text-right">
                      <p className="text-lg font-semibold text-primary">
                        {formatUsd(wallet.balanceUsd)}
                      </p>
                      {wallet.dailyLimitUsd !== undefined && (
                        <p className="text-xs text-muted-foreground">
                          Limite hoje:{" "}
                          {formatUsd(wallet.dailyLimitUsd - (wallet.dailySpentUsd ?? 0))} restante
                        </p>
                      )}
                    </div>
                    <Button variant="outline" size="icon">
                      <Copy className="h-4 w-4" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
