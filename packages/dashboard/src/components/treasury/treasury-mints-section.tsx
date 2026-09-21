"use client";

import { Coins, ShieldCheck, Wand2 } from "lucide-react";
import { FundingModeBadge } from "@/components/treasury/funding-mode-badge";
import { Button } from "@/components/ui/button";
import { useTranslation } from "@/i18n/locale-provider";
import type { MintCeilingView, TreasuryView } from "@/lib/server/solana";
import { formatBaseUnits, mintSymbol, NATIVE_MINT, truncateAddress } from "@/lib/utils";

export function TreasuryMintsSection({
  data,
  isOwner,
  walletConnected,
  onEnableNative,
  onAddAsset,
  onOpenWizard,
  intl,
  unlimited,
}: {
  data: TreasuryView;
  isOwner: boolean;
  walletConnected: boolean;
  onEnableNative: (mint: MintCeilingView) => void;
  onAddAsset?: () => void;
  onOpenWizard?: () => void;
  intl: string;
  unlimited: string;
}) {
  const { t } = useTranslation();

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h3 className="text-sm font-medium">{t("treasuryDetail.mintsSection")}</h3>
        {isOwner && (
          <div className="flex flex-wrap gap-2">
            {onAddAsset && (
              <Button variant="outline" size="sm" onClick={onAddAsset}>
                <Coins className="h-3.5 w-3.5" />
                {t("addAsset.title")}
              </Button>
            )}
            {onOpenWizard && data.mints.length > 0 && (
              <Button variant="default" size="sm" onClick={onOpenWizard}>
                <Wand2 className="h-3.5 w-3.5" />
                {t("securityWizard.openButton")}
              </Button>
            )}
          </div>
        )}
      </div>

      {data.mints.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border bg-surface-card p-4 text-center">
          <p className="text-xs text-muted-foreground">{t("treasuryDetail.noMints")}</p>
          {isOwner && onAddAsset && (
            <Button variant="outline" size="sm" className="mt-3" onClick={onAddAsset}>
              <Coins className="h-3.5 w-3.5" />
              {t("addAsset.title")}
            </Button>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          {data.mints.map((mint) => {
            const symbol = mintSymbol(mint.mint);
            const canEnable =
              mint.fundingMode === "isolatedVault" &&
              mint.mint !== NATIVE_MINT &&
              isOwner &&
              walletConnected;
            return (
              <div
                key={mint.mint}
                className="rounded-lg border border-border bg-surface-card p-3 text-xs"
              >
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-medium">{symbol}</p>
                    <p className="num text-muted-foreground">{truncateAddress(mint.mint, 6)}</p>
                  </div>
                  <FundingModeBadge mode={mint.fundingMode} />
                </div>
                <div className="grid grid-cols-2 gap-1">
                  <span className="text-muted-foreground">
                    {t("treasuryDetail.ownerCeilingLifetime")}
                  </span>
                  <span className="num num-col text-right">
                    {formatBaseUnits(mint.maxLifetime, mint.decimals, intl, unlimited)}
                  </span>
                </div>
                {mint.fundingMode === "isolatedVault" && mint.mint !== NATIVE_MINT && (
                  <div className="mt-3">
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full"
                      disabled={!canEnable}
                      onClick={() => onEnableNative(mint)}
                    >
                      <ShieldCheck className="h-3.5 w-3.5" />
                      {t("nativeAllowance.enableButton")}
                    </Button>
                    {!walletConnected ? (
                      <p className="mt-1 text-muted-foreground">
                        {t("nativeAllowance.connectWalletHint")}
                      </p>
                    ) : !isOwner ? (
                      <p className="mt-1 text-muted-foreground">
                        {t("nativeAllowance.ownerOnlyHint")}
                      </p>
                    ) : null}
                  </div>
                )}
                {mint.fundingMode === "nativeAllowance" && (
                  <p className="mt-2 text-muted-foreground">{t("nativeAllowance.activeHint")}</p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
