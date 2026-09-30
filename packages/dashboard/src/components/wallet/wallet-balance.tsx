"use client";

import { Copy, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useBalances, useSolPrice } from "@/hooks/use-dashboard";
import { intlLocale } from "@/i18n";
import { useTranslation } from "@/i18n/locale-provider";
import { LAMPORTS_PER_SOL, solscanAccountUrl } from "@/lib/solana";
import { copyToClipboard, formatUsd, HIDDEN_AMOUNT, truncateAddress } from "@/lib/utils";
import { useAppStore, useBalancesHidden } from "@/stores/app-store";

function formatSolAmount(sol: number): string {
  const digits = sol === 0 || sol >= 1 ? 4 : 6;
  return sol.toFixed(digits).replace(/\.?0+$/, "");
}

export function WalletBalance({ address }: { address: string }) {
  const { t, locale } = useTranslation();
  const intl = intlLocale(locale);
  const { cluster } = useAppStore();
  const hidden = useBalancesHidden();
  const toast = useToast();
  const { data: price } = useSolPrice();
  const { byAddress, isFetching } = useBalances([address]);

  const lamports = byAddress.get(address);
  const sol = lamports === undefined ? null : lamports / LAMPORTS_PER_SOL;
  const usd = sol === null || price === undefined ? null : sol * price.usd;

  const usdLabel =
    usd === null ? (isFetching ? "…" : hidden ? HIDDEN_AMOUNT : "—") : formatUsd(usd, intl, hidden);
  const solParen =
    sol === null
      ? hidden
        ? HIDDEN_AMOUNT
        : "—"
      : hidden
        ? HIDDEN_AMOUNT
        : `(${formatSolAmount(sol)} SOL)`;

  async function copyAddress() {
    const ok = await copyToClipboard(address);
    toast(ok ? t("common.addressCopied") : t("common.couldNotCopy"), ok ? "success" : "error");
  }

  return (
    <div className="flex min-w-0 items-center gap-2">
      <div className="flex min-w-0 items-baseline gap-1.5 whitespace-nowrap">
        <span className="num text-sm font-semibold text-foreground">{usdLabel}</span>
        <span className="num text-sm text-muted-foreground">{solParen}</span>
      </div>

      <span className="hidden h-4 w-px shrink-0 bg-border sm:block" />

      <div className="flex min-w-0 items-center gap-1">
        <Wallet className="h-3.5 w-3.5 shrink-0 text-primary" />
        <a
          href={solscanAccountUrl(address, cluster)}
          target="_blank"
          rel="noreferrer"
          className="num truncate text-sm text-muted-foreground transition-colors hover:text-foreground"
          title={t("wallet.aria.openOnSolscan")}
        >
          {truncateAddress(address, 4)}
        </a>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-7 w-7 shrink-0"
              aria-label={t("wallets.aria.copyAddress")}
              onClick={copyAddress}
            >
              <Copy className="h-3.5 w-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{t("wallets.aria.copyAddress")}</TooltipContent>
        </Tooltip>
      </div>
    </div>
  );
}
