"use client";

import { FundingModeBadge } from "@/components/treasury/funding-mode-badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useTranslation } from "@/i18n/locale-provider";
import type { MintCeilingView } from "@/lib/server/solana";
import { mintSymbol, NATIVE_MINT, truncateAddress } from "@/lib/utils";

export function isNativeSolMint(mint: string): boolean {
  return mint === NATIVE_MINT;
}

/** SPL token in isolated-vault mode — eligible for `enable_native_allowance`. */
export function canEnableNativeAllowance(mint: MintCeilingView): boolean {
  return mint.fundingMode === "isolatedVault" && !isNativeSolMint(mint.mint);
}

/** Prefer the first SPL vault-funded mint; fall back to the first configured asset. */
export function defaultMintSelection(mints: MintCeilingView[]): string | null {
  if (mints.length === 0) return null;
  const splVault = mints.find(canEnableNativeAllowance);
  return splVault?.mint ?? mints[0]?.mint ?? null;
}

export type MintSelectorProps = {
  mints: MintCeilingView[];
  value: string | null;
  onValueChange: (mint: string) => void;
  disabled?: boolean;
};

export function MintSelector({ mints, value, onValueChange, disabled }: MintSelectorProps) {
  const { t } = useTranslation();
  const selected = mints.find((m) => m.mint === value) ?? null;

  return (
    <div className="space-y-2">
      <Label htmlFor="treasury-mint-selector">{t("agentSettings.treasury.selectMint")}</Label>
      <Select
        value={value ?? undefined}
        onValueChange={onValueChange}
        disabled={disabled || mints.length === 0}
      >
        <SelectTrigger id="treasury-mint-selector" className="h-auto min-h-9 bg-surface-card py-2">
          <SelectValue placeholder={t("agentSettings.treasury.selectMintPlaceholder")}>
            {selected ? <MintOptionRow mint={selected} compact /> : null}
          </SelectValue>
        </SelectTrigger>
        <SelectContent className="bg-surface-card">
          {mints.map((mint) => (
            <SelectItem key={mint.mint} value={mint.mint} className="py-2">
              <MintOptionRow mint={mint} />
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function MintOptionRow({ mint, compact }: { mint: MintCeilingView; compact?: boolean }) {
  const symbol = mintSymbol(mint.mint);

  return (
    <div className="flex w-full min-w-0 items-center gap-2">
      <span className="font-medium">{symbol}</span>
      {!compact && (
        <span className="num truncate text-xs text-muted-foreground">
          {truncateAddress(mint.mint, 6)}
        </span>
      )}
      <FundingModeBadge mode={mint.fundingMode} />
    </div>
  );
}

export type NativeAllowanceEligibility = {
  canEnable: boolean;
  reason: "ready" | "nativeSol" | "alreadyNative" | "noMint" | "notOwner" | "noWallet";
};

export function getNativeAllowanceEligibility(
  mint: MintCeilingView | null | undefined,
  opts: { isOwner: boolean; walletConnected: boolean },
): NativeAllowanceEligibility {
  if (!mint) return { canEnable: false, reason: "noMint" };
  if (!opts.walletConnected) return { canEnable: false, reason: "noWallet" };
  if (!opts.isOwner) return { canEnable: false, reason: "notOwner" };
  if (isNativeSolMint(mint.mint)) return { canEnable: false, reason: "nativeSol" };
  if (mint.fundingMode === "nativeAllowance") {
    return { canEnable: false, reason: "alreadyNative" };
  }
  return { canEnable: true, reason: "ready" };
}

export function NativeAllowanceEnableButton({
  disabled,
  tooltip,
  onEnable,
}: {
  disabled: boolean;
  tooltip?: string;
  onEnable: () => void;
}) {
  const { t } = useTranslation();
  const button = (
    <Button variant="outline" size="sm" className="w-full" disabled={disabled} onClick={onEnable}>
      {t("nativeAllowance.enableButton")}
    </Button>
  );

  if (tooltip && disabled) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="inline-flex w-full cursor-not-allowed">{button}</span>
        </TooltipTrigger>
        <TooltipContent className="max-w-xs text-muted-foreground">{tooltip}</TooltipContent>
      </Tooltip>
    );
  }

  return button;
}
