"use client";

import { useTranslation } from "@/i18n/locale-provider";
import { formatMicros, type LedgerEntry } from "@/lib/billing";

function EntryRow({
  entry,
  locale,
  compact,
}: {
  entry: LedgerEntry;
  locale: string;
  compact: boolean;
}) {
  const { t } = useTranslation();
  const money = (micros: number) => formatMicros(micros, locale);
  const debit = entry.amountMicros < 0;

  return (
    <li className="flex items-start justify-between gap-3 py-2 text-sm" data-testid="ledger-row">
      <div className="min-w-0 space-y-0.5">
        <p className="truncate">
          {t(`billing.kind.${entry.kind}`)}
          {entry.model && (
            <span className="ml-1.5 text-xs text-muted-foreground">
              {entry.model.replace(/^openrouter:/, "")}
            </span>
          )}
        </p>
        <p className="text-xs text-muted-foreground">
          {new Date(entry.createdAt).toLocaleString(locale)}
          {/* Token counts and the fee split are the balance page's detail; the home extrato
              is a glance. */}
          {!compact && entry.promptTokens !== undefined && entry.completionTokens !== undefined && (
            <>
              {" · "}
              {t("billing.tokens", {
                prompt: entry.promptTokens.toLocaleString(locale),
                completion: entry.completionTokens.toLocaleString(locale),
              })}
            </>
          )}
          {!compact && entry.rawCostMicros !== undefined && entry.markupMicros !== undefined && (
            <>
              {" · "}
              {t("billing.breakdown", {
                raw: money(entry.rawCostMicros),
                fee: money(entry.markupMicros),
              })}
            </>
          )}
          {entry.estimated && (
            <span title={t("billing.estimatedHint")}>
              {" · "}
              {t("billing.estimated")}
            </span>
          )}
        </p>
      </div>
      <span className={`num shrink-0 ${debit ? "text-muted-foreground" : "text-emerald-500"}`}>
        {debit ? "" : "+"}
        {money(entry.amountMicros)}
      </span>
    </li>
  );
}

/** The extrato: credits and debits, newest first, as the billing route returns them. */
export function LedgerList({
  entries,
  locale,
  compact = false,
}: {
  entries: LedgerEntry[];
  locale: string;
  compact?: boolean;
}) {
  return (
    <ul className="divide-y divide-border">
      {entries.map((entry) => (
        <EntryRow key={entry.id} entry={entry} locale={locale} compact={compact} />
      ))}
    </ul>
  );
}
