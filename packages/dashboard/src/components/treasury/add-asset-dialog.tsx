"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { AlertTriangle, Coins, Info, Loader2 } from "lucide-react";
import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/toast";
import { useAddMint } from "@/hooks/use-dashboard";
import { useTranslation } from "@/i18n/locale-provider";
import { type AddAssetValues, addAssetSchema } from "@/lib/agent-security-wizard-schema";
import { DEVNET_USDC_MINT } from "@/lib/constants";
import { truncateAddress } from "@/lib/utils";

export type AddAssetDialogProps = {
  open: boolean;
  onClose: () => void;
  treasuryAddress: string;
};

export function AddAssetDialog({ open, onClose, treasuryAddress }: AddAssetDialogProps) {
  const { t } = useTranslation();
  const toast = useToast();
  const addMint = useAddMint();
  const form = useForm<AddAssetValues>({
    resolver: zodResolver(addAssetSchema),
    defaultValues: { mint: "" },
  });

  const { register, handleSubmit, reset, setValue, formState } = form;
  const pending = formState.isSubmitting || addMint.isPending;

  useEffect(() => {
    if (open) {
      reset({ mint: "" });
      addMint.reset();
    }
  }, [open, reset, addMint.reset]);

  async function onSubmit(values: AddAssetValues) {
    try {
      const outcome = await addMint.mutateAsync({
        treasury: treasuryAddress,
        mint: values.mint,
      });
      toast(
        outcome.status === "confirmed"
          ? t("addAsset.toast.added", { mint: truncateAddress(values.mint, 6) })
          : t("addAsset.toast.pending", { mint: truncateAddress(values.mint, 6) }),
        outcome.status === "confirmed" ? "success" : "error",
      );
      onClose();
    } catch {
      // Inline error from mutation.
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && !pending && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Coins className="h-4 w-4 text-accent" />
            {t("addAsset.title")}
          </DialogTitle>
          <DialogDescription>{t("addAsset.description")}</DialogDescription>
        </DialogHeader>

        <form className="space-y-4" onSubmit={handleSubmit(onSubmit)}>
          <div className="rounded-lg border border-border bg-elevated/30 px-3 py-2 text-xs">
            <span className="text-muted-foreground">{t("addAsset.treasury")}</span>
            <p className="num mt-0.5 font-medium">{truncateAddress(treasuryAddress, 8)}</p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="add-asset-mint">{t("addAsset.mintLabel")}</Label>
            <Input
              id="add-asset-mint"
              placeholder={t("addAsset.mintPlaceholder")}
              className="num"
              disabled={pending}
              {...register("mint")}
            />
            {formState.errors.mint && (
              <p className="text-xs text-destructive">{t("addAsset.error.invalidMint")}</p>
            )}
          </div>

          <Button
            type="button"
            variant="outline"
            size="sm"
            className="w-full"
            disabled={pending}
            onClick={() => setValue("mint", DEVNET_USDC_MINT, { shouldValidate: true })}
          >
            {t("addAsset.useDevnetUsdc")}
          </Button>

          <div className="flex items-start gap-2 rounded-lg border border-border bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>{t("addAsset.hint")}</span>
          </div>

          {addMint.error && (
            <div className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
              <span className="break-words">{addMint.error.message}</span>
            </div>
          )}

          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" disabled={pending}>
              {pending && <Loader2 className="h-4 w-4 animate-spin" />}
              {pending ? t("addAsset.confirming") : t("addAsset.submit")}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
