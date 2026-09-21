"use client";

import { Badge } from "@/components/ui/badge";
import { useTranslation } from "@/i18n/locale-provider";
import type { TreasuryFundingMode } from "@/lib/server/solana";

export function FundingModeBadge({ mode }: { mode: TreasuryFundingMode }) {
  const { t } = useTranslation();
  if (mode === "nativeAllowance") {
    return (
      <Badge variant="outline" className="border-accent/40 text-accent">
        {t("nativeAllowance.badge.walletFunded")}
      </Badge>
    );
  }
  return <Badge variant="outline">{t("nativeAllowance.badge.vaultFunded")}</Badge>;
}
