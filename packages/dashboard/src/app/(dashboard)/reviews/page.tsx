"use client";

import { KNOWN_MINTS } from "@agent-rails/contract/mints";
import { Check, Copy, Inbox, Loader2, RotateCw, ShieldAlert, X } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/components/ui/toast";
import { useDashboardState } from "@/hooks/use-dashboard";
import {
  type EventView,
  type ReviewView,
  useDecideReview,
  useEvents,
  useIngestTokens,
  useReviews,
  useRevokeIngestToken,
  useRotateIngestToken,
} from "@/hooks/use-ops";
import { intlLocale } from "@/i18n";
import { useTranslation } from "@/i18n/locale-provider";
import { formatBaseUnits } from "@/lib/utils";

function short(address: string): string {
  return address.length > 12 ? `${address.slice(0, 4)}…${address.slice(-4)}` : address;
}

function mintLabel(mint: string, raw: string, locale: string): string {
  const known = KNOWN_MINTS[mint];
  return known
    ? `${formatBaseUnits(raw, known.decimals, locale)} ${known.symbol}`
    : `${raw} (${short(mint)})`;
}

const STATUS_VARIANT = {
  pending: "warning",
  approved: "success",
  rejected: "destructive",
} as const;

function ReviewCard({
  review,
  workflowName,
  now,
}: {
  review: ReviewView;
  workflowName: string;
  now: number;
}) {
  const { t, locale } = useTranslation();
  const intl = intlLocale(locale);
  const decide = useDecideReview();
  const toast = useToast();
  const lapsed = Date.parse(review.expiresAt) <= now;

  const act = async (decision: "approved" | "rejected") => {
    try {
      await decide.mutateAsync({ id: review.id, decision });
      toast(t(decision === "approved" ? "reviews.approvedToast" : "reviews.rejectedToast"));
    } catch (error) {
      toast(error instanceof Error ? error.message : t("common.failedToSave"), "error");
    }
  };

  const event = review.event;
  return (
    <Card data-testid={`review-${review.id}`}>
      <CardContent className="space-y-3 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <Badge
            variant={
              lapsed && review.status === "pending" ? "outline" : STATUS_VARIANT[review.status]
            }
          >
            {lapsed && review.status === "pending"
              ? t("reviews.status.lapsed")
              : t(`reviews.status.${review.status}`)}
          </Badge>
          <Badge variant="secondary">{t(`reviews.kind.${review.kind}`)}</Badge>
          <span className="text-xs text-muted-foreground">{workflowName}</span>
          <span className="ml-auto text-xs text-muted-foreground">
            {new Date(review.createdAt).toLocaleString(intl)}
          </span>
        </div>

        {event.kind === "payment_review_required" && (
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
            <dt className="text-muted-foreground">{t("reviews.field.amount")}</dt>
            <dd className="font-medium">
              {mintLabel(event.review.mint, event.review.amount, intl)}
            </dd>
            <dt className="text-muted-foreground">{t("reviews.field.destination")}</dt>
            <dd>
              {event.review.destination_label ?? short(event.review.destination)}{" "}
              <span className="font-mono text-xs text-muted-foreground">
                {short(event.review.destination)}
              </span>
            </dd>
            <dt className="text-muted-foreground">{t("reviews.field.reference")}</dt>
            <dd className="font-mono text-xs">{event.review.reference}</dd>
            {event.review.memo && (
              <>
                <dt className="text-muted-foreground">{t("reviews.field.memo")}</dt>
                <dd>{event.review.memo}</dd>
              </>
            )}
            <dt className="text-muted-foreground">{t("reviews.field.intent")}</dt>
            <dd className="font-mono text-xs">{event.review.intent_id}</dd>
            <dt className="text-muted-foreground">{t("reviews.field.session")}</dt>
            <dd className="font-mono text-xs">{short(event.review.session)}</dd>
          </dl>
        )}

        {event.kind === "limit_increase_requested" && (
          <div className="space-y-2 text-sm">
            <p className="rounded-md bg-muted/50 p-3 italic">“{event.request.reason}”</p>
            {event.request.requested_amount && (
              <p className="text-muted-foreground">
                {t("reviews.field.requested")}: {event.request.requested_amount}
                {event.request.mint
                  ? ` ${KNOWN_MINTS[event.request.mint]?.symbol ?? short(event.request.mint)}`
                  : ""}
              </p>
            )}
            <p className="text-xs text-muted-foreground">
              {t("reviews.limitNote")}{" "}
              <Link href="/limits" className="underline">
                {t("nav.limits")}
              </Link>
            </p>
          </div>
        )}

        {review.status === "pending" && !lapsed ? (
          <div className="flex gap-2">
            <Button size="sm" disabled={decide.isPending} onClick={() => act("approved")}>
              <Check className="h-4 w-4" />
              {t(review.kind === "payment" ? "reviews.approve" : "reviews.acknowledge")}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={decide.isPending}
              onClick={() => act("rejected")}
            >
              <X className="h-4 w-4" />
              {t(review.kind === "payment" ? "reviews.reject" : "reviews.decline")}
            </Button>
            {review.kind === "payment" && (
              <p className="self-center text-xs text-muted-foreground">
                {t("reviews.approveHint")}
              </p>
            )}
          </div>
        ) : review.decidedAt ? (
          <p className="text-xs text-muted-foreground">
            {t("reviews.decidedAt", { when: new Date(review.decidedAt).toLocaleString(intl) })}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

function eventSummary(
  event: EventView["event"],
  t: (k: string, v?: Record<string, string>) => string,
) {
  switch (event.kind) {
    case "payment_denied":
      return t("reviews.activity.denied", { reason: event.denial.reason_code });
    case "headroom_low":
      return t("reviews.activity.headroom", {
        window: event.headroom.window,
        pct: (event.headroom.headroom_bps / 100).toFixed(1),
      });
    case "payment_review_required":
      return t("reviews.activity.review", { reference: event.review.reference });
    case "limit_increase_requested":
      return t("reviews.activity.limit", { reason: event.request.reason });
  }
}

function Activity({ names }: { names: Map<string, string> }) {
  const { t, locale } = useTranslation();
  const intl = intlLocale(locale);
  const { data, isLoading } = useEvents();
  const events = data?.events ?? [];
  if (isLoading) return <Loader2 className="h-4 w-4 animate-spin" />;
  if (events.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        {t("reviews.activity.empty")}
      </p>
    );
  }
  return (
    <ul className="divide-y rounded-md border">
      {events.map((row) => (
        <li key={row.id} className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
          <Badge variant={row.kind === "payment_denied" ? "destructive" : "secondary"}>
            {t(`reviews.eventKind.${row.kind}`)}
          </Badge>
          <span className="min-w-0 flex-1 truncate">{eventSummary(row.event, t)}</span>
          <span className="text-xs text-muted-foreground">{names.get(row.workflowId) ?? ""}</span>
          <span className="text-xs text-muted-foreground">
            {new Date(row.receivedAt).toLocaleString(intl)}
          </span>
        </li>
      ))}
    </ul>
  );
}

function ReportingRow({ workflowId, name }: { workflowId: string; name: string }) {
  const { t, locale } = useTranslation();
  const intl = intlLocale(locale);
  const tokens = useIngestTokens(workflowId);
  const rotate = useRotateIngestToken();
  const revoke = useRevokeIngestToken();
  const toast = useToast();
  const [fresh, setFresh] = useState<string | null>(null);
  const live = tokens.data?.tokens.find((token) => !token.revokedAt);

  return (
    <div className="space-y-2 rounded-md border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">{name}</span>
        {live ? (
          <Badge variant="success">
            {t("reviews.reporting.live", {
              hint: live.hint,
              since: new Date(live.createdAt).toLocaleDateString(intl),
            })}
          </Badge>
        ) : (
          <Badge variant="outline">{t("reviews.reporting.none")}</Badge>
        )}
        <div className="ml-auto flex gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={rotate.isPending}
            onClick={async () => {
              try {
                const issued = await rotate.mutateAsync(workflowId);
                setFresh(issued.token);
              } catch (error) {
                toast(error instanceof Error ? error.message : t("common.failedToSave"), "error");
              }
            }}
          >
            <RotateCw className="h-3.5 w-3.5" />
            {t(live ? "reviews.reporting.rotate" : "reviews.reporting.issue")}
          </Button>
          {live && (
            <Button
              size="sm"
              variant="ghost"
              disabled={revoke.isPending}
              onClick={() => revoke.mutate({ workflowId, tokenId: live.id })}
            >
              {t("reviews.reporting.revoke")}
            </Button>
          )}
        </div>
      </div>
      {fresh && (
        <div className="space-y-1 rounded-md bg-muted/50 p-2 text-xs">
          <p>{t("reviews.reporting.shownOnce")}</p>
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate">{fresh}</code>
            <Button
              size="icon"
              variant="ghost"
              aria-label={t("common.copy")}
              onClick={() => navigator.clipboard.writeText(fresh)}
            >
              <Copy className="h-3.5 w-3.5" />
            </Button>
          </div>
          <p className="text-muted-foreground">AGENT_RAILS_INGEST_URL={tokens.data?.ingest_url}</p>
        </div>
      )}
    </div>
  );
}

export default function ReviewsPage() {
  const { t } = useTranslation();
  const { data: state } = useDashboardState();
  const { data, isLoading } = useReviews();
  const reviews = data?.reviews ?? [];
  const now = data ? Date.parse(data.now) : Date.now();
  const names = new Map((state?.workflows ?? []).map((w) => [w.id, w.name]));
  const pending = reviews.filter((r) => r.status === "pending" && Date.parse(r.expiresAt) > now);
  const decided = reviews.filter((r) => !pending.includes(r));
  const realWorkflows = (state?.workflows ?? []).filter((w) => !w.demo);

  return (
    <div>
      <PageHeader title={t("reviews.title")} description={t("reviews.description")} />
      <Tabs defaultValue="pending">
        <TabsList>
          <TabsTrigger value="pending">
            {t("reviews.tab.pending")}
            {pending.length > 0 && (
              <Badge variant="warning" className="ml-2">
                {pending.length}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="history">{t("reviews.tab.history")}</TabsTrigger>
          <TabsTrigger value="activity">{t("reviews.tab.activity")}</TabsTrigger>
          <TabsTrigger value="reporting">{t("reviews.tab.reporting")}</TabsTrigger>
        </TabsList>

        <TabsContent value="pending" className="space-y-3">
          {isLoading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : pending.length === 0 ? (
            <EmptyState
              icon={Inbox}
              title={t("reviews.emptyTitle")}
              description={t("reviews.emptyDescription")}
            />
          ) : (
            pending.map((review) => (
              <ReviewCard
                key={review.id}
                review={review}
                workflowName={names.get(review.workflowId) ?? ""}
                now={now}
              />
            ))
          )}
        </TabsContent>

        <TabsContent value="history" className="space-y-3">
          {decided.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              {t("reviews.historyEmpty")}
            </p>
          ) : (
            decided.map((review) => (
              <ReviewCard
                key={review.id}
                review={review}
                workflowName={names.get(review.workflowId) ?? ""}
                now={now}
              />
            ))
          )}
        </TabsContent>

        <TabsContent value="activity">
          <Activity names={names} />
        </TabsContent>

        <TabsContent value="reporting">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <ShieldAlert className="h-4 w-4" />
                {t("reviews.reporting.title")}
              </CardTitle>
              <p className="text-sm text-muted-foreground">{t("reviews.reporting.description")}</p>
            </CardHeader>
            <CardContent className="space-y-2">
              {realWorkflows.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  {t("reviews.reporting.noWorkflows")}
                </p>
              ) : (
                realWorkflows.map((w) => (
                  <ReportingRow key={w.id} workflowId={w.id} name={w.name} />
                ))
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
