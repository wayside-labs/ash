"use client";

import { Plus } from "lucide-react";
import Link from "next/link";
import { Button, type ButtonProps } from "@/components/ui/button";
import { useTranslation } from "@/i18n/locale-provider";
import { BALANCE_PATH } from "@/lib/shell";

export const ADD_BALANCE_HREF = `${BALANCE_PATH}#add`;

/** Every "Adicionar saldo" CTA lands on the same section, so a deposit rail has one door. */
export function AddBalanceButton({
  size = "sm",
  variant = "default",
  className,
}: Pick<ButtonProps, "size" | "variant" | "className">) {
  const { t } = useTranslation();
  return (
    <Button asChild size={size} variant={variant} className={className}>
      <Link href={ADD_BALANCE_HREF}>
        <Plus className="h-3.5 w-3.5" />
        {t("balance.add")}
      </Link>
    </Button>
  );
}
