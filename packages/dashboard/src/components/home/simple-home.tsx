"use client";

import { ArrowRight, ShieldCheck, Wallet } from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { AddBalanceButton } from "@/components/billing/add-balance-button";
import { LedgerList } from "@/components/billing/ledger-list";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useBilling } from "@/hooks/use-billing";
import { intlLocale } from "@/i18n";
import { useLocale, useTranslation } from "@/i18n/locale-provider";
import { type BillingSummary, formatMicros } from "@/lib/billing";
import { BALANCE_PATH, type BalanceState, balanceState, LEDGER_PREVIEW } from "@/lib/shell";
import { cn } from "@/lib/utils";
import { useBalancesHidden } from "@/stores/app-store";

const ChatPanel = dynamic(
  () => import("@/components/chat/chat-panel").then((m) => ({ default: m.ChatPanel })),
  {
    ssr: false,
    loading: () => <div className="h-full min-h-[200px] animate-pulse rounded-xl bg-muted/60" />,
  },
);

/**
 * The consumer default: sign in, add balance, ask. No wallet, no cluster, no vault — the chat
 * spends prepaid credit, and anything an agent later pays on chain goes through the program's
 * policy behind the scenes. The operator's chat + workflows split lives at `/advanced`.
 */
export function SimpleHome() {
  const { data, isLoading, error } = useBilling();
  const state = data ? balanceState(data) : null;

  return (
    <div className="flex h-[calc(100vh-7rem)] flex-col gap-3">
      {isLoading ? (
        <div className="h-[88px] shrink-0 animate-pulse rounded-xl bg-muted/60" />
      ) : data && state && state !== "off" ? (
        <BalanceStrip summary={data} state={state} />
      ) : error ? (
        <BalanceUnavailable />
      ) : null}

      <div className="flex min-h-0 flex-1 flex-col gap-3 lg:flex-row">
        <div className="flex min-h-0 flex-1 flex-col gap-3">
          {(state === "empty" || state === "negative") && <FundFirst state={state} />}
          <ChatPanel className="min-h-0 flex-1" />
        </div>
        {data && state !== "off" && <RecentActivity summary={data} />}
      </div>
    </div>
  );
}

function BalanceStrip({ summary, state }: { summary: BillingSummary; state: BalanceState }) {
  const { t } = useTranslation();
  const locale = intlLocale(useLocale());
  const hidden = useBalancesHidden();

  return (
    <Card className="shrink-0" data-testid="balance-strip">
      <CardContent className="flex flex-wrap items-center justify-between gap-4 p-4">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10">
            <Wallet className="h-5 w-5 text-primary" />
          </span>
          <div>
            <p className="text-xs text-muted-foreground">{t("balance.label")}</p>
            <p
              className={cn(
                "num text-2xl font-semibold",
                state === "funded" ? "text-foreground" : "text-destructive",
              )}
              data-testid="home-balance"
            >
              {hidden ? "••••" : formatMicros(summary.balanceMicros, locale)}
            </p>
          </div>
        </div>
        <p className="flex max-w-md items-start gap-1.5 text-xs text-muted-foreground">
          <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
          {t("balance.howItWorks")}
        </p>
        <AddBalanceButton size="default" variant={state === "funded" ? "outline" : "default"} />
      </CardContent>
    </Card>
  );
}

function BalanceUnavailable() {
  const { t } = useTranslation();
  return (
    <p className="shrink-0 rounded-xl border border-border bg-card px-4 py-3 text-sm text-muted-foreground">
      {t("billing.unavailable")}
    </p>
  );
}

/** Shown above the chat while it cannot run: the next message would come back 402. */
function FundFirst({ state }: { state: "empty" | "negative" }) {
  const { t } = useTranslation();
  return (
    <div
      className="flex shrink-0 flex-wrap items-center justify-between gap-3 rounded-xl border border-primary/40 bg-primary/5 px-4 py-3"
      data-testid="fund-first"
    >
      <div>
        <p className="text-sm font-medium">{t("balance.emptyTitle")}</p>
        <p className="text-xs text-muted-foreground">
          {state === "negative" ? t("billing.negativeHint") : t("balance.emptyDescription")}
        </p>
      </div>
      <AddBalanceButton />
    </div>
  );
}

function RecentActivity({ summary }: { summary: BillingSummary }) {
  const { t } = useTranslation();
  const locale = intlLocale(useLocale());
  const entries = summary.entries.slice(0, LEDGER_PREVIEW);

  return (
    // Below lg the header pill carries the balance and the chat needs the height.
    <Card className="hidden shrink-0 flex-col lg:flex lg:w-80" data-testid="recent-activity">
      <CardHeader className="flex-row items-center justify-between gap-2 space-y-0 pb-2">
        <CardTitle className="text-sm">{t("billing.history")}</CardTitle>
        <Link
          href={BALANCE_PATH}
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          {t("balance.seeAll")}
          <ArrowRight className="h-3 w-3" />
        </Link>
      </CardHeader>
      <CardContent className="min-h-0 flex-1 overflow-y-auto pt-0">
        {entries.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("billing.empty")}</p>
        ) : (
          <LedgerList entries={entries} locale={locale} compact />
        )}
      </CardContent>
    </Card>
  );
}
