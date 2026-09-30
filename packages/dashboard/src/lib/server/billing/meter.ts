import {
  chargeFor,
  costFromTokens,
  creditsToMicros,
  parseMarkupBps,
  type TokenPrice,
  usdToMicros,
  worstCaseChargeMicros,
} from "@/lib/billing";
import { resolvePostgresContext } from "@/lib/server/state/context";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { type BillingScope, ledgerFor } from "./ledger";

/**
 * The meter on the platform key. It runs only where the operator pays — the
 * `openrouter-platform` provider. A user's own Anthropic key or Claude
 * subscription is theirs to spend, and demo costs nothing, so neither is metered.
 *
 * This is a separate meter from anything on-chain. Agent Rails treasuries,
 * policies and sessions govern what *agents* pay vendors, in the vault, under
 * the program's rules; this ledger is what the *dashboard* charges for its own
 * assistant, off-chain, and the program never sees it. A deposit rail may later
 * fund both from one wallet, but the two meters stay distinct.
 */

export type BillingConfig = {
  enabled: boolean;
  markupBps: number;
  starterMicros: number;
};

/**
 * Always on when hosted: there the platform key serves strangers, and metering
 * off would be the unbounded postpaid this exists to prevent. Local JSON mode is
 * the operator's own key on their own machine, so it is opt-in there — useful
 * for trying the flow end to end without Supabase.
 */
export function billingConfig(): BillingConfig {
  return {
    enabled: isSupabaseConfigured() || process.env.BILLING_ENABLED === "true",
    markupBps: parseMarkupBps(process.env.BILLING_MARKUP_BPS),
    starterMicros: usdToMicros(process.env.BILLING_STARTER_CREDIT_USD),
  };
}

/** The caller's org when hosted, the server's single ledger locally, null when signed out. */
export async function resolveBillingScope(): Promise<BillingScope | null> {
  if (!isSupabaseConfigured()) return { kind: "local" };
  // An unprovisioned account has no org to bill, so it is refused like a signed-out one.
  const result = await resolvePostgresContext();
  if (result?.kind !== "ok") return null;
  return { kind: "org", orgId: result.ctx.orgId, accountId: result.ctx.accountId };
}

function scopeKey(scope: BillingScope): string {
  return scope.kind === "org" ? scope.orgId : "local";
}

/**
 * Reads the balance, granting the starter credit first if this scope has never
 * had it. Attempted only while the balance is not positive, so a funded org
 * costs one read per turn, not a read and a rejected insert.
 */
export async function currentBalance(scope: BillingScope, config: BillingConfig): Promise<number> {
  const ledger = ledgerFor(scope);
  const balance = await ledger.balance(scope);
  if (balance > 0 || config.starterMicros === 0) return balance;
  const granted = await ledger.append(scope, {
    kind: "starter_grant",
    amountMicros: config.starterMicros,
    idempotencyKey: `starter:${scopeKey(scope)}`,
  });
  return granted ? balance + config.starterMicros : balance;
}

export type Preflight =
  | { ok: true; balanceMicros: number }
  | { ok: false; balanceMicros: number; requiredMicros: number };

/**
 * Refuses a turn the balance could not pay for at its worst — the full output
 * ceiling — so the only overdraft left is two turns racing past the check at
 * once. `claimTurn` below closes that within one server instance.
 */
export function preflight(
  balanceMicros: number,
  price: TokenPrice,
  promptChars: number,
  maxCompletionTokens: number,
  markupBps: number,
): Preflight {
  const required = worstCaseChargeMicros(price, promptChars, maxCompletionTokens, markupBps);
  if (balanceMicros > 0 && balanceMicros >= required) return { ok: true, balanceMicros };
  return { ok: false, balanceMicros, requiredMicros: required };
}

const inFlight = new Set<string>();

/**
 * One metered turn per payer at a time, so N parallel requests cannot each pass
 * the pre-flight against the same balance. Per instance, like rate-limit.ts: on
 * serverless, concurrent instances can still each run one — a bounded overdraft
 * of one worst-case turn per warm instance, recorded honestly as a negative
 * balance that blocks the next turn.
 */
export function claimTurn(scope: BillingScope): (() => void) | null {
  const key = scopeKey(scope);
  if (inFlight.has(key)) return null;
  inFlight.add(key);
  return () => inFlight.delete(key);
}

export type ReportedUsage = { promptTokens: number; completionTokens: number; cost?: number };

export type PricedTurn = {
  rawCostMicros: number;
  promptTokens: number;
  completionTokens: number;
  estimated: boolean;
};

/**
 * What the platform key was charged for one turn. OpenRouter's own `cost` when
 * it sent one; list prices on its token counts when it sent counts only; and
 * list prices on character counts when the stream ended with no usage chunk at
 * all — an aborted turn is still billed upstream for what it produced. A turn
 * that produced nothing and reported nothing failed before generation and is
 * not charged.
 */
export function priceTurn(
  usage: ReportedUsage | null,
  price: TokenPrice,
  promptChars: number,
  completionChars: number,
): PricedTurn | null {
  if (usage) {
    const measured = usage.cost !== undefined;
    return {
      rawCostMicros: measured
        ? creditsToMicros(usage.cost as number)
        : costFromTokens(price, usage.promptTokens, usage.completionTokens),
      promptTokens: usage.promptTokens,
      completionTokens: usage.completionTokens,
      estimated: !measured,
    };
  }
  if (completionChars === 0) return null;
  // ~3 characters per token: between Claude's English average and the
  // pessimistic 2 the pre-flight uses, since this one is a charge, not a hold.
  const promptTokens = Math.ceil(promptChars / 3);
  const completionTokens = Math.ceil(completionChars / 3);
  return {
    rawCostMicros: costFromTokens(price, promptTokens, completionTokens),
    promptTokens,
    completionTokens,
    estimated: true,
  };
}

/** Records one turn's debit. Idempotent on the request id; a zero-cost turn writes nothing. */
export async function debitTurn(
  scope: BillingScope,
  requestId: string,
  model: string,
  turn: PricedTurn,
  markupBps: number,
): Promise<void> {
  const charge = chargeFor(turn.rawCostMicros, markupBps);
  if (charge.totalMicros === 0) return;
  await ledgerFor(scope).append(scope, {
    kind: "chat_debit",
    amountMicros: -charge.totalMicros,
    model,
    promptTokens: turn.promptTokens,
    completionTokens: turn.completionTokens,
    rawCostMicros: charge.rawCostMicros,
    markupBps,
    markupMicros: charge.markupMicros,
    ...(turn.estimated ? { estimated: true } : {}),
    idempotencyKey: `chat:${requestId}`,
  });
}
