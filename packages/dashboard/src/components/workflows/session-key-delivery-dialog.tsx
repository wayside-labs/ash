"use client";

import { AlertTriangle, Check, Copy, Download } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";
import { useTranslation } from "@/i18n/locale-provider";
import { buildMcpSnippet } from "@/lib/mcp-snippet";
import { truncateAddress } from "@/lib/utils";
import { downloadKeypairFile } from "@/lib/wallet/session-key";

export type SessionKeyDelivery = {
  agentName: string;
  session: string;
  sessionKey: string;
  keypairBytes: number[];
  keypairFilename: string;
  mcpSnippet: string;
};

export function SessionKeyDeliveryDialog({
  delivery,
  onClose,
}: {
  delivery: SessionKeyDelivery | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const [copied, setCopied] = useState(false);

  const open = delivery !== null;

  const copySnippet = async () => {
    if (!delivery) return;
    try {
      await navigator.clipboard.writeText(delivery.mcpSnippet);
      setCopied(true);
      toast(t("sessionKeyDelivery.copied"));
    } catch {
      toast(t("sessionKeyDelivery.copyFailed"), "error");
    }
  };

  const download = () => {
    if (!delivery) return;
    downloadKeypairFile(delivery.keypairFilename, delivery.keypairBytes);
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {t("sessionKeyDelivery.title", { name: delivery?.agentName ?? "" })}
          </DialogTitle>
          <DialogDescription>{t("sessionKeyDelivery.description")}</DialogDescription>
        </DialogHeader>

        {delivery && (
          <div className="space-y-4">
            <div
              className="flex gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm"
              role="alert"
            >
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600" aria-hidden />
              <p>{t("sessionKeyDelivery.lossWarning")}</p>
            </div>

            <dl className="grid gap-2 text-sm">
              <div className="flex justify-between gap-4">
                <dt className="text-muted-foreground">{t("sessionKeyDelivery.sessionLabel")}</dt>
                <dd className="num">{truncateAddress(delivery.session)}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-muted-foreground">{t("sessionKeyDelivery.sessionKeyLabel")}</dt>
                <dd className="num">{truncateAddress(delivery.sessionKey)}</dd>
              </div>
            </dl>

            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" onClick={download}>
                <Download className="size-4" aria-hidden />
                {t("sessionKeyDelivery.download")}
              </Button>
              <Button type="button" variant="outline" onClick={() => void copySnippet()}>
                {copied ? (
                  <Check className="size-4" aria-hidden />
                ) : (
                  <Copy className="size-4" aria-hidden />
                )}
                {copied ? t("sessionKeyDelivery.copied") : t("sessionKeyDelivery.copyMcp")}
              </Button>
            </div>

            <p className="text-xs text-muted-foreground">{t("sessionKeyDelivery.mcpHint")}</p>
          </div>
        )}

        <div className="flex justify-end">
          <Button onClick={onClose}>{t("common.close")}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function buildSessionKeyDelivery(input: {
  agentName: string;
  session: string;
  sessionKey: string;
  keypairBytes: number[];
  keypairFilename: string;
  rpcUrl: string;
}): SessionKeyDelivery {
  return {
    agentName: input.agentName,
    session: input.session,
    sessionKey: input.sessionKey,
    keypairBytes: input.keypairBytes,
    keypairFilename: input.keypairFilename,
    mcpSnippet: buildMcpSnippet({
      rpcUrl: input.rpcUrl,
      session: input.session,
      signerKeypairPath: input.keypairFilename,
      sinkPath: "payments.jsonl",
    }),
  };
}
