import type { RunPlan } from "@agent-rails/cloak";
import type { RunEvent, RunStep } from "@agent-rails/contract/template-run";

export type TimelineStatus = "pending" | "started" | "done" | "failed" | "skipped";

export type TimelineRow = {
  id: string;
  step: RunStep;
  payeeIndex?: number;
  status: TimelineStatus;
  signature?: string;
  /** The latest progress line, or the reason a step failed. */
  message?: string;
};

function rowId(step: RunStep, payeeIndex: number | undefined): string {
  return step === "payout" && payeeIndex !== undefined ? `payout:${payeeIndex}` : step;
}

/**
 * The card's checklist: every step the plan will take, shown up front as pending, then moved by
 * the events. Recovery rows appear only when a recovery ran, since most runs never need one.
 */
export function buildTimeline(plan: RunPlan, events: readonly RunEvent[]): TimelineRow[] {
  const rows = new Map<string, TimelineRow>();
  const add = (step: RunStep, payeeIndex?: number): void => {
    const id = rowId(step, payeeIndex);
    rows.set(id, {
      id,
      step,
      status: "pending",
      ...(payeeIndex !== undefined ? { payeeIndex } : {}),
    });
  };
  add("preflight");
  add("derive-keys");
  add("shield");
  // Not every run writes one, so the row appears with its first event, like the recovery's.
  if (events.some((event) => event.step === "commit")) add("commit");
  for (const payout of plan.payouts) add("payout", payout.index);
  add("report");
  if (events.some((event) => event.step === "recover")) add("recover");

  for (const event of events) {
    const row = rows.get(rowId(event.step, event.payeeIndex));
    if (!row) continue;
    if (event.status === "progress") {
      if (row.status === "pending") row.status = "started";
      if (event.message) row.message = event.message;
      continue;
    }
    row.status = event.status;
    if (event.signature) row.signature = event.signature;
    if (event.status === "failed" || event.message) {
      if (event.message) row.message = event.message;
    } else {
      delete row.message;
    }
  }
  return [...rows.values()];
}

/**
 * Whether funds may be in the pool: the shield landed, which is when a failure leaves them there,
 * or it failed in a way that cannot say whether the deposit left the wallet.
 */
export function fundsAreInPool(events: readonly RunEvent[]): boolean {
  return events.some(
    (event) =>
      event.step === "shield" &&
      (((event.status === "done" || event.status === "skipped") && Boolean(event.signature)) ||
        (event.status === "failed" && event.errorCode === "outcome_unknown")),
  );
}
