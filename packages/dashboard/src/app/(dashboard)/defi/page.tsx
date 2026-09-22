"use client";

import { listDeFiProtocols } from "@agent-rails/contract/defi-intents";
import { Loader2, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import { DeFiIntentResult } from "@/components/defi/defi-intent-result";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useWorkflows } from "@/hooks/use-dashboard";
import { useTranslation } from "@/i18n/locale-provider";
import type { AnalyzeDeFiIntentResult } from "@/lib/defi/types";
import { useAppStore } from "@/stores/app-store";

const EXAMPLE_PROMPTS = [
  "Check Kamino USDC yield and deposit $5000 if APY > 8%",
  "Swap 2 SOL to USDC on Jupiter with 0.5% slippage cap",
  "Make 50% profit in 48h guaranteed on Meteora",
  "Stake 10 SOL via Marinade for mSOL",
] as const;

export default function DeFiIntentsPage() {
  const { t } = useTranslation();
  const { workflows, isLoading } = useWorkflows({ withChain: false });
  const { cluster, customRpc } = useAppStore();
  const onChainWorkflows = workflows.filter((w) => w.treasuryAddress);

  const [workflowId, setWorkflowId] = useState<string>("");
  const [text, setText] = useState("");
  const [result, setResult] = useState<AnalyzeDeFiIntentResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [analyzing, setAnalyzing] = useState(false);

  const selected = onChainWorkflows.find((w) => w.id === workflowId) ?? onChainWorkflows[0] ?? null;
  const protocols = listDeFiProtocols();

  useEffect(() => {
    if (!workflowId && onChainWorkflows[0]?.id) {
      setWorkflowId(onChainWorkflows[0].id);
    }
  }, [onChainWorkflows, workflowId]);

  async function analyze(prompt: string) {
    setAnalyzing(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/defi/analyze", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          text: prompt,
          treasuryAddress: selected?.treasuryAddress ?? null,
          cluster,
          rpc: customRpc || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? t("defi.error.analyzeFailed"));
      setResult(data as AnalyzeDeFiIntentResult);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("defi.error.analyzeFailed"));
    } finally {
      setAnalyzing(false);
    }
  }

  return (
    <div>
      <PageHeader title={t("defi.title")} description={t("defi.description")} />

      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {protocols.map((protocol) => (
          <Card key={protocol.id} className="surface-raised">
            <CardContent className="space-y-1 p-3">
              <p className="text-sm font-medium">{protocol.name}</p>
              <p className="text-xs text-muted-foreground capitalize">
                {protocol.category.replace("_", " ")} · {protocol.riskTier}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="surface-raised mb-6">
        <CardHeader>
          <CardTitle className="text-base">{t("defi.analyzer.title")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {isLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              {t("common.loading")}
            </div>
          ) : onChainWorkflows.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("defi.analyzer.noTreasury")}</p>
          ) : (
            <div className="space-y-2">
              <Label htmlFor="defi-workflow">{t("defi.analyzer.treasury")}</Label>
              <Select value={selected?.id ?? ""} onValueChange={(id) => setWorkflowId(id)}>
                <SelectTrigger id="defi-workflow">
                  <SelectValue placeholder={t("defi.analyzer.treasury")} />
                </SelectTrigger>
                <SelectContent>
                  {onChainWorkflows.map((w) => (
                    <SelectItem key={w.id} value={w.id}>
                      {w.icon} {w.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="defi-prompt">{t("defi.analyzer.prompt")}</Label>
            <Textarea
              id="defi-prompt"
              rows={4}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={t("defi.analyzer.placeholder")}
            />
          </div>

          <div className="flex flex-wrap gap-2">
            {EXAMPLE_PROMPTS.map((example) => (
              <Button
                key={example}
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  setText(example);
                  void analyze(example);
                }}
              >
                {example.slice(0, 42)}…
              </Button>
            ))}
          </div>

          <Button
            disabled={!text.trim() || analyzing}
            onClick={() => void analyze(text)}
            className="gap-2"
          >
            {analyzing ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Sparkles className="h-4 w-4" />
            )}
            {t("defi.analyzer.submit")}
          </Button>

          {error && <p className="text-sm text-destructive">{error}</p>}
        </CardContent>
      </Card>

      {result && <DeFiIntentResult proposal={result.proposal} />}
    </div>
  );
}
