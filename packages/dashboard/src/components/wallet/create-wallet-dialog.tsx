"use client";

import { AlertTriangle, Check, Copy, Download, Eye, Loader2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
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
import { addressFromMnemonic, createMnemonic } from "@/lib/wallet/mnemonic";

/** Long enough to write twelve words down, short enough not to outlive the tab. */
const CLIPBOARD_CLEAR_MS = 30_000;

type Generated = { phrase: string; address: string };

/**
 * Generates a phrase, shows it once, and forgets it (ADR-018). The key lives in
 * this component's state and nowhere else: no store, no localStorage, no server.
 *
 * The blur and the two confirmations are not theatre. At this moment the threat
 * is a camera, a shoulder or a screen share, and nothing technical stops any of
 * them -- only making the reveal deliberate does.
 */
export function CreateWalletDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const [generated, setGenerated] = useState<Generated | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [confirmingDownload, setConfirmingDownload] = useState(false);
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);
  const clipboardTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setFailed(false);
    void (async () => {
      try {
        const phrase = createMnemonic();
        const address = await addressFromMnemonic(phrase);
        if (!cancelled) setGenerated({ phrase, address });
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  // Closing is the end of the key, so the state it lived in goes with it.
  const close = useCallback(() => {
    setGenerated(null);
    setRevealed(false);
    setConfirmingDownload(false);
    setCopied(false);
    onOpenChange(false);
  }, [onOpenChange]);

  useEffect(() => {
    return () => {
      if (clipboardTimer.current) clearTimeout(clipboardTimer.current);
    };
  }, []);

  const copy = async () => {
    if (!generated) return;
    try {
      await navigator.clipboard.writeText(generated.phrase);
      setCopied(true);
      toast(t("createWallet.copied"));
      // A mitigation, not a fix: another page may already have read it.
      if (clipboardTimer.current) clearTimeout(clipboardTimer.current);
      clipboardTimer.current = setTimeout(() => {
        void navigator.clipboard.writeText("").catch(() => {});
        setCopied(false);
      }, CLIPBOARD_CLEAR_MS);
    } catch {
      toast(t("createWallet.copyFailed"), "error");
    }
  };

  const download = () => {
    if (!generated) return;
    const body = [
      t("createWallet.fileHeader"),
      "",
      generated.phrase,
      "",
      `${t("createWallet.fileAddress")} ${generated.address}`,
      `${t("createWallet.filePath")} m/44'/501'/0'/0'`,
      "",
      t("createWallet.fileWarning"),
    ].join("\n");
    const url = URL.createObjectURL(new Blob([body], { type: "text/plain;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `ash-recovery-${generated.address.slice(0, 8)}.txt`;
    a.click();
    URL.revokeObjectURL(url);
    setConfirmingDownload(false);
  };

  const words = generated?.phrase.split(" ") ?? [];

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : close())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("createWallet.title")}</DialogTitle>
          <DialogDescription>{t("createWallet.description")}</DialogDescription>
        </DialogHeader>

        {failed ? (
          <p className="text-sm text-destructive">{t("createWallet.failed")}</p>
        ) : !generated ? (
          <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            {t("createWallet.generating")}
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/5 p-3">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
              <p className="text-sm">{t("createWallet.beforeReveal")}</p>
            </div>

            <div className="relative">
              <ol
                className={`grid grid-cols-3 gap-2 rounded-lg border border-border p-3 ${
                  revealed ? "" : "select-none blur-sm"
                }`}
                aria-hidden={!revealed}
              >
                {words.map((word, i) => (
                  <li key={word + String(i)} className="num text-sm">
                    <span className="mr-1 text-xs text-muted-foreground">{i + 1}.</span>
                    {revealed ? word : "••••••"}
                  </li>
                ))}
              </ol>
              {revealed ? null : (
                <div className="absolute inset-0 flex items-center justify-center">
                  <Button size="sm" onClick={() => setRevealed(true)}>
                    <Eye className="h-3.5 w-3.5" />
                    {t("createWallet.reveal")}
                  </Button>
                </div>
              )}
            </div>

            <div>
              <p className="text-xs text-muted-foreground">{t("createWallet.addressLabel")}</p>
              <p className="num break-all text-sm">{generated.address}</p>
            </div>

            {revealed ? (
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" size="sm" onClick={copy}>
                  {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                  {t("createWallet.copy")}
                </Button>
                <Button variant="outline" size="sm" onClick={() => setConfirmingDownload(true)}>
                  <Download className="h-3.5 w-3.5" />
                  {t("createWallet.saveTxt")}
                </Button>
              </div>
            ) : null}

            {confirmingDownload ? (
              <div className="space-y-3 rounded-lg border border-destructive/40 bg-destructive/5 p-3">
                <p className="text-sm">{t("createWallet.downloadWarning")}</p>
                <div className="flex gap-2">
                  <Button size="sm" variant="destructive" onClick={download}>
                    {t("createWallet.downloadConfirm")}
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setConfirmingDownload(false)}>
                    {t("common.cancel")}
                  </Button>
                </div>
              </div>
            ) : null}

            <p className="text-xs text-muted-foreground">{t("createWallet.importNote")}</p>
          </div>
        )}

        <div className="flex justify-end">
          <Button variant="outline" onClick={close}>
            {t("createWallet.done")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
