"use client";

import { Plus } from "lucide-react";
import { Button, type ButtonProps } from "@/components/ui/button";
import { useTranslation } from "@/i18n/locale-provider";
import { useAppStore } from "@/stores/app-store";

/** Every "add balance" prompt opens the one deposit dialog, so a rail has one door. */
export function AddBalanceButton({
  size = "sm",
  variant = "default",
  className,
}: Pick<ButtonProps, "size" | "variant" | "className">) {
  const { t } = useTranslation();
  const setMoneyDialog = useAppStore((s) => s.setMoneyDialog);
  return (
    <Button
      size={size}
      variant={variant}
      className={className}
      onClick={() => setMoneyDialog("deposit")}
    >
      <Plus className="h-3.5 w-3.5" />
      {t("balance.add")}
    </Button>
  );
}
