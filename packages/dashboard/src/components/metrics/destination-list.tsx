"use client";

import { Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { intlLocale } from "@/i18n";
import { useTranslation } from "@/i18n/locale-provider";
import type { DestinationContact } from "@/lib/metrics/schema";
import { formatBaseUnits, HIDDEN_AMOUNT, truncateAddress } from "@/lib/utils";
import { useBalancesHidden } from "@/stores/app-store";
import { ExactnessNote } from "./exactness-note";

/**
 * §3 right — who money may go to.
 *
 * In Phase A this is the allowlist roster, which is exact, and no amounts, which
 * are not knowable without the event replay. The distinction is the whole point of
 * the panel: "we are allowed to pay these five" is a real answer to a real CFO
 * question, and it must not be dressed up as "we paid these five".
 *
 * A policy in `Any` mode has no roster to show, and says so rather than rendering
 * an empty list that reads as "nobody is allowed".
 */
export function DestinationList({
  contacts,
  isLoading,
  anyMode,
  decimalsByMint,
}: {
  contacts: DestinationContact[];
  isLoading: boolean;
  anyMode: boolean;
  decimalsByMint: Record<string, number>;
}) {
  const { t, locale } = useTranslation();
  const intl = intlLocale(locale);
  const hidden = useBalancesHidden();

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("metrics.destinations.title")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {anyMode ? (
          <p className="text-sm text-muted-foreground">{t("metrics.destinations.anyMode")}</p>
        ) : isLoading ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            {t("common.loading")}
          </p>
        ) : contacts.length === 0 ? (
          <div className="space-y-2">
            <p className="text-sm font-medium">{t("metrics.destinations.emptyTitle")}</p>
            <p className="text-sm text-muted-foreground">
              {t("metrics.destinations.emptyDescription")}
            </p>
            <code className="block overflow-x-auto rounded bg-muted px-2 py-1 text-[11px] text-foreground">
              {t("metrics.destinations.emptyCommand")}
            </code>
          </div>
        ) : (
          <ul className="space-y-2" data-testid="destination-roster">
            {contacts.map((contact) => {
              const decimals = decimalsByMint[contact.owner];
              return (
                <li
                  key={contact.entry}
                  className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border/60 pb-2 last:border-0 last:pb-0"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm">{contact.label || t("common.noLabel")}</p>
                    <p className="num text-[11px] text-faint-foreground">
                      {truncateAddress(contact.owner, 6)}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {contact.perTxMaxOverrideRaw !== "0" && (
                      <Badge variant="outline" className="text-[10px]">
                        {t("metrics.destinations.override", {
                          // A per-destination cap is still an amount on screen.
                          amount: hidden
                            ? HIDDEN_AMOUNT
                            : formatBaseUnits(contact.perTxMaxOverrideRaw, decimals ?? 6, intl),
                        })}
                      </Badge>
                    )}
                    {/*
                      `paid: null` is "not known", and the copy says exactly that.
                      Rendering it as "never paid" would invent a fact.
                    */}
                    <span className="num text-xs text-faint-foreground">
                      {contact.paid === null
                        ? "—"
                        : t("metrics.destinations.paymentCount", { count: contact.paid.count })}
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        {!anyMode && contacts.length > 0 && (
          <>
            <ExactnessNote exactness="counter" extra={t("metrics.destinations.rosterExact")} />
            <p className="text-[11px] text-muted-foreground">
              {t("metrics.destinations.amountsPending")}
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
