"use client";

import { AlertTriangle, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useTreasury } from "@/hooks/use-dashboard";
import { intlLocale } from "@/i18n";
import { useTranslation } from "@/i18n/locale-provider";
import { LAMPORTS_PER_SOL } from "@/lib/solana";
import { formatBaseUnits, formatSol, formatWindow, mintSymbol, truncateAddress } from "@/lib/utils";

export function TreasuryDetail({
  address,
  onClose,
  onFinishSetup,
}: {
  address: string | null;
  onClose: () => void;
  /** Offered when the treasury has no policy yet — a bootstrap that stopped halfway. */
  onFinishSetup?: (treasury: string) => void;
}) {
  const { t, locale } = useTranslation();
  const { data, isLoading, error } = useTreasury(address);
  const intl = intlLocale(locale);
  const unlimited = t("common.unlimited");

  return (
    <Dialog open={address !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("treasuryDetail.title")}</DialogTitle>
          <DialogDescription className="num text-xs">
            {truncateAddress(address, 8)}
          </DialogDescription>
        </DialogHeader>

        {isLoading && (
          <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            {t("treasuryDetail.loading")}
          </div>
        )}

        {error && (
          <div className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
            <span>{error instanceof Error ? error.message : t("common.readFailed")}</span>
          </div>
        )}

        {data && (
          <div className="space-y-5 text-sm">
            <div className="grid grid-cols-2 gap-3">
              <Field
                label={t("treasuryDetail.vaultBalanceSol")}
                value={formatSol(data.solVaultLamports / LAMPORTS_PER_SOL)}
              />
              <Field
                label={t("treasuryDetail.status")}
                value={
                  data.paused ? t("treasuryDetail.statusPaused") : t("treasuryDetail.statusActive")
                }
                tone={data.paused ? "warning" : "success"}
              />
              <Field
                label={t("treasuryDetail.owner")}
                value={truncateAddress(data.owner, 6)}
                mono
              />
              <Field
                label={t("treasuryDetail.operator")}
                value={truncateAddress(data.operator, 6)}
                mono
              />
              <Field
                label={t("treasuryDetail.activeSessions")}
                value={String(data.activeSessions)}
              />
              <Field label={t("treasuryDetail.policies")} value={String(data.policyCount)} />
            </div>

            <section>
              <h3 className="mb-2 text-sm font-medium">{t("treasuryDetail.policies")}</h3>
              {data.policies.length === 0 ? (
                <div className="space-y-2">
                  <p className="text-xs text-muted-foreground">
                    {t("treasuryDetail.noOpenPolicies")}
                  </p>
                  {onFinishSetup && address && (
                    <Button size="sm" variant="outline" onClick={() => onFinishSetup(address)}>
                      {t("treasuryDetail.finishSetup")}
                    </Button>
                  )}
                </div>
              ) : (
                <div className="space-y-3">
                  {data.policies.map((policy) => (
                    <div key={policy.address} className="rounded-lg border border-border p-3">
                      <div className="mb-2 flex items-center gap-2">
                        <span className="font-medium">{policy.name || t("common.unnamed")}</span>
                        {policy.requireMemo && (
                          <Badge variant="outline">{t("treasuryDetail.memoRequired")}</Badge>
                        )}
                      </div>
                      {policy.limits.map((limit) => {
                        const dec = data.decimals[limit.mint];
                        return (
                          <div key={limit.mint} className="grid grid-cols-2 gap-1 text-xs">
                            <span className="num col-span-2 text-faint-foreground">
                              {mintSymbol(limit.mint)} · {truncateAddress(limit.mint, 6)}
                            </span>
                            <span className="text-muted-foreground">
                              {t("treasuryDetail.perTransaction")}
                            </span>
                            <span className="num num-col text-right">
                              {formatBaseUnits(limit.perTxMax, dec, intl, unlimited)}
                            </span>
                            <span className="text-muted-foreground">
                              {t("treasuryDetail.shortWindow", {
                                window: formatWindow(limit.shortWindowSeconds),
                              })}
                            </span>
                            <span className="num num-col text-right">
                              {formatBaseUnits(limit.shortWindowMax, dec, intl, unlimited)}
                            </span>
                            <span className="text-muted-foreground">
                              {t("treasuryDetail.longWindow", {
                                window: formatWindow(limit.longWindowSeconds),
                              })}
                            </span>
                            <span className="num num-col text-right">
                              {formatBaseUnits(limit.longWindowMax, dec, intl, unlimited)}
                            </span>
                            <span className="text-muted-foreground">
                              {t("treasuryDetail.sessionLifetime")}
                            </span>
                            <span className="num num-col text-right">
                              {formatBaseUnits(limit.lifetimeMax, dec, intl, unlimited)}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section>
              <h3 className="mb-2 text-sm font-medium">{t("treasuryDetail.sessionsSection")}</h3>
              {data.sessions.length === 0 ? (
                <p className="text-xs text-muted-foreground">{t("treasuryDetail.noSessions")}</p>
              ) : (
                <div className="space-y-2">
                  {data.sessions.map((session) => (
                    <div
                      key={session.address}
                      className="flex items-center justify-between rounded-lg border border-border p-3 text-xs"
                    >
                      <div>
                        <p className="font-medium">{session.label || t("common.noLabel")}</p>
                        <p className="num text-muted-foreground">
                          {truncateAddress(session.sessionKey, 5)}
                        </p>
                      </div>
                      <div className="text-right">
                        <Badge variant={session.revoked ? "destructive" : "success"}>
                          {session.revoked
                            ? t("treasuryDetail.sessionRevoked")
                            : t("treasuryDetail.sessionActive")}
                        </Badge>
                        <p className="mt-1 text-muted-foreground">
                          {t("treasuryDetail.sessionPaymentsExpires", {
                            count: session.seq,
                            date: new Date(session.expiresAt * 1000).toLocaleDateString(intl),
                          })}
                        </p>
                        {session.spend.map((counter) => (
                          <p key={counter.mint} className="text-muted-foreground">
                            {t("treasuryDetail.spent")}{" "}
                            {formatBaseUnits(
                              counter.lifetimeSpent,
                              data.decimals[counter.mint],
                              intl,
                              unlimited,
                            )}{" "}
                            {mintSymbol(counter.mint)}
                          </p>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Field({
  label,
  value,
  mono,
  tone,
}: {
  label: string;
  value: string;
  mono?: boolean;
  tone?: "success" | "warning";
}) {
  const color = tone === "warning" ? "text-warning" : tone === "success" ? "text-good" : "";
  return (
    <div>
      <p className="text-xs text-subtle-foreground">{label}</p>
      <p className={`${mono ? "num text-xs" : "num font-medium"} ${color}`}>{value}</p>
    </div>
  );
}
