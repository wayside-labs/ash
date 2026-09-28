/**
 * Every number on the Metrics page is decided here, and nothing here does I/O.
 *
 * This is the dashboard's echo of the split CLAUDE.md makes load-bearing on the
 * Rust side: the arithmetic that decides what a figure *means* lives away from
 * the code that fetched it. Plain data in, `MetricsSummary` out — so every
 * exactness call, every `u64::MAX` sentinel and every "this mint has no peg, so
 * the dollar total is a floor" is testable without an RPC or a browser.
 *
 * Two rules hold throughout:
 *
 *  - Amounts stay base-unit strings. `Number` appears only where the result
 *    feeds a USD figure that is already approximate, never where it could reach
 *    a transaction.
 *  - A missing input produces `unavailable`, never zero. A zero is a claim.
 */

import { NATIVE_MINT } from "@agent-rails/contract/constants";
import { knownMint } from "@agent-rails/contract/mints";
import type { SolanaCluster } from "@/lib/schema";
import type { SolPrice } from "@/lib/server/price";
import type { SessionView, TreasuryView, VaultBalance } from "@/lib/server/solana";
import { mintSymbol } from "@/lib/utils";
import type {
  Exactness,
  Headroom,
  IntegrityRow,
  MetricAmount,
  MetricsPeriod,
  MetricsScope,
  MetricsSummary,
} from "./schema";
import { U64_MAX } from "./schema";

export type FoldInput = {
  cluster: SolanaCluster;
  asOf: string;
  scope: MetricsScope;
  period: MetricsPeriod;
  /** One per treasury that could be read. Demo workflows have no treasury. */
  treasuries: TreasuryView[];
  vaults: VaultBalance[];
  price: SolPrice | null;
  /**
   * Session addresses to keep when the scope narrowed to a single agent.
   * `null` means every session, which is not the same as an empty array.
   */
  sessionFilter: string[] | null;
  unreadable: { treasury: string; detail: string }[];
};

/**
 * Base units to a display number, for USD only.
 *
 * Mirrors `toHuman` in use-dashboard.ts and carries the same caveat: this feeds a
 * formatter, never a transfer amount.
 */
function toHuman(raw: string, decimals: number): number {
  const value = Number(raw) / 10 ** decimals;
  return Number.isFinite(value) ? value : 0;
}

/**
 * What a token amount is worth, or null.
 *
 * A dollar-pegged mint is priced 1:1 because the alternative on a stablecoin is
 * an empty dollar line beside a number that already is dollars. Everything else
 * without a feed stays null: guessing is worse than saying nothing.
 */
function usdFor(mint: string, amount: number, solPriceUsd: number | null): number | null {
  if (mint === NATIVE_MINT) return solPriceUsd === null ? null : amount * solPriceUsd;
  if (knownMint(mint)?.stable) return amount;
  return null;
}

function amountOf(
  mint: string,
  raw: string,
  decimals: number,
  solPriceUsd: number | null,
): MetricAmount {
  return {
    raw,
    mint,
    decimals,
    symbol: mintSymbol(mint),
    usd: usdFor(mint, toHuman(raw, decimals), solPriceUsd),
  };
}

/** Sums a base-unit total without going through a float on the way. */
function sumRaw(values: string[]): string {
  return values.reduce((total, value) => total + BigInt(value), 0n).toString();
}

/** Sessions in scope. An agent-scoped view keeps exactly the sessions named. */
function sessionsInScope(input: FoldInput): { treasury: TreasuryView; session: SessionView }[] {
  const rows: { treasury: TreasuryView; session: SessionView }[] = [];
  for (const treasury of input.treasuries) {
    for (const session of treasury.sessions) {
      if (input.sessionFilter !== null && !input.sessionFilter.includes(session.address)) continue;
      rows.push({ treasury, session });
    }
  }
  return rows;
}

/** Which counter a period reads. The three the program actually keeps. */
function counterFor(period: MetricsPeriod): "shortSpent" | "longSpent" | "lifetimeSpent" {
  switch (period) {
    case "short-window":
      return "shortSpent";
    case "long-window":
      return "longSpent";
    case "session-life":
      return "lifetimeSpent";
  }
}

function foldHoldings(input: FoldInput): MetricsSummary["holdings"] {
  const solPriceUsd = input.price?.usd ?? null;
  const assets: MetricAmount[] = [];

  for (const vault of input.vaults) {
    for (const asset of vault.assets) {
      if (input.scope.mint !== null && asset.mint !== input.scope.mint) continue;
      assets.push(amountOf(asset.mint, asset.amount, asset.decimals, solPriceUsd));
    }
  }

  // An asset with no price is excluded from the total rather than counted as
  // zero, and the count rides along so the UI can say the total is a floor.
  const priced = assets.filter((asset) => asset.usd !== null);
  const excluded = assets.length - priced.length;
  return {
    assets,
    usd: priced.length === 0 ? null : priced.reduce((total, a) => total + (a.usd ?? 0), 0),
    partial: excluded > 0,
    excluded,
  };
}

function foldSpend(input: FoldInput): MetricsSummary["spend"] {
  const solPriceUsd = input.price?.usd ?? null;
  const field = counterFor(input.period);
  const rawByMint = new Map<string, string[]>();
  const decimalsByMint = new Map<string, number>();

  for (const { treasury, session } of sessionsInScope(input)) {
    for (const counter of session.spend) {
      if (input.scope.mint !== null && counter.mint !== input.scope.mint) continue;
      const bucket = rawByMint.get(counter.mint) ?? [];
      bucket.push(counter[field]);
      rawByMint.set(counter.mint, bucket);
      // The treasury's own MintConfig is the authority on decimals; a mint the
      // treasury never configured would render its raw u64, which is correct.
      const decimals = treasury.decimals[counter.mint];
      if (decimals !== undefined) decimalsByMint.set(counter.mint, decimals);
    }
  }

  const byMint = [...rawByMint.entries()].map(([mint, values]) =>
    amountOf(mint, sumRaw(values), decimalsByMint.get(mint) ?? 0, solPriceUsd),
  );
  const priced = byMint.filter((a) => a.usd !== null);

  return {
    byMint,
    usd: priced.length === 0 ? null : priced.reduce((total, a) => total + (a.usd ?? 0), 0),
    // No counter to read is not a spend of zero: a treasury with no session has
    // never been able to spend, and a scope that matched nothing is a different
    // statement again. Both report `unavailable`.
    exactness: byMint.length === 0 ? ("unavailable" as Exactness) : ("counter" as Exactness),
  };
}

function foldPayments(input: FoldInput): MetricsSummary["payments"] {
  const rows = sessionsInScope(input);
  if (rows.length === 0) {
    return { count: 0, lifetimeOnly: true, exactness: "unavailable" };
  }
  // `seq` is a u64 on chain and a count of payments in practice; Number is safe
  // at any sequence a session will reach before its account is closed.
  const count = rows.reduce((total, { session }) => total + Number(session.seq), 0);
  return { count, lifetimeOnly: true, exactness: "counter" };
}

/**
 * Phase A has nothing to report here, and says so.
 *
 * Pre-chain denials are off-chain only (spec §8) and reach the operator's own
 * sink, not the browser. Program-level denials are failed transactions, which
 * need the signature walk Phase B adds. A zero would claim the agents never
 * tried anything odd.
 */
function foldDenials(): MetricsSummary["denials"] {
  return { count: null, byReason: {}, exactness: "unavailable" };
}

function foldHeadroom(input: FoldInput): Headroom[] {
  const rows: Headroom[] = [];
  const scoped = sessionsInScope(input);

  for (const treasury of input.treasuries) {
    for (const policy of treasury.policies) {
      for (const limit of policy.limits) {
        if (input.scope.mint !== null && limit.mint !== input.scope.mint) continue;
        const decimals = treasury.decimals[limit.mint] ?? 0;
        const ceiling = treasury.mints.find((m) => m.mint === limit.mint);
        // Only the sessions bound to this policy consume this policy's budget.
        const counters = scoped
          .filter(({ session }) => session.policy === policy.address)
          .flatMap(({ session }) => session.spend.filter((c) => c.mint === limit.mint));

        const windows = [
          {
            window: "short" as const,
            max: limit.shortWindowMax,
            seconds: limit.shortWindowSeconds,
            spent: sumRaw(counters.map((c) => c.shortSpent)),
            ceilingRaw: ceiling?.maxShortWindow ?? null,
          },
          {
            window: "long" as const,
            max: limit.longWindowMax,
            seconds: limit.longWindowSeconds,
            spent: sumRaw(counters.map((c) => c.longSpent)),
            ceilingRaw: ceiling?.maxLongWindow ?? null,
          },
          {
            window: "lifetime" as const,
            max: limit.lifetimeMax,
            seconds: null,
            spent: sumRaw(counters.map((c) => c.lifetimeSpent)),
            ceilingRaw: ceiling?.maxLifetime ?? null,
          },
        ];

        for (const entry of windows) {
          rows.push({
            mint: limit.mint,
            decimals,
            symbol: mintSymbol(limit.mint),
            policy: policy.address,
            policyName: policy.name,
            window: entry.window,
            windowSeconds: entry.seconds,
            spentRaw: entry.spent,
            policyMaxRaw: entry.max,
            ceilingRaw: entry.ceilingRaw,
            unlimited: entry.max === U64_MAX,
          });
        }
      }
    }
  }
  // `per-tx` is deliberately not emitted: it is a cap on a single payment, not a
  // budget that gets consumed, so a progress bar against it would always read
  // zero. `/limits` renders it in its proper context.
  return rows;
}

function foldIntegrity(input: FoldInput): IntegrityRow[] {
  return sessionsInScope(input).map(({ session }) => ({
    session: session.address,
    label: session.label,
    seq: session.seq,
    auditHead: session.auditHead,
    // Phase B replays the events and fills this in. Until then "not checked" is
    // the honest value, and it is not the same as "broken".
    verifiedThroughSeq: null,
    revoked: session.revoked,
    expiresAt: session.expiresAt,
  }));
}

/**
 * The period's real shape, read off the policy rather than assumed.
 *
 * A policy may well use a 6h short window, so the duration comes from
 * `shortWindowSeconds` and the label is rendered from it. Only the short window
 * has a start on chain (`short_window_start`); the long window reports null
 * because inventing one would be the same mistake as a hardcoded "24h" label.
 */
function foldPeriod(input: FoldInput): MetricsSummary["period"] {
  const limits = input.treasuries.flatMap((t) => t.policies.flatMap((p) => p.limits));
  const relevant =
    input.scope.mint === null ? limits : limits.filter((l) => l.mint === input.scope.mint);
  const first = relevant[0];

  if (input.period === "session-life") {
    return { kind: input.period, seconds: null, startedAt: null };
  }
  if (input.period === "long-window") {
    return { kind: input.period, seconds: first?.longWindowSeconds ?? null, startedAt: null };
  }

  const starts = sessionsInScope(input)
    .flatMap(({ session }) => session.spend)
    .filter((c) => input.scope.mint === null || c.mint === input.scope.mint)
    .map((c) => c.shortWindowStart)
    .filter((start) => start > 0);

  return {
    kind: input.period,
    seconds: first?.shortWindowSeconds ?? null,
    // The most recent bucket start is the one the counters are accumulating in.
    startedAt: starts.length === 0 ? null : Math.max(...starts),
  };
}

export function foldMetrics(input: FoldInput): MetricsSummary {
  return {
    asOf: input.asOf,
    cluster: input.cluster,
    scope: input.scope,
    period: foldPeriod(input),
    holdings: foldHoldings(input),
    spend: foldSpend(input),
    payments: foldPayments(input),
    denials: foldDenials(),
    headroom: foldHeadroom(input),
    policies: input.treasuries.flatMap((treasury) =>
      treasury.policies.map((policy) => ({
        address: policy.address,
        name: policy.name,
        destinationMode: policy.destinationMode,
        requireMemo: policy.requireMemo,
      })),
    ),
    price: input.price
      ? {
          usd: input.price.usd,
          change24h: input.price.change24h,
          source: input.price.source,
          asOf: input.price.asOf,
        }
      : null,
    integrity: foldIntegrity(input),
    unreadable: input.unreadable,
  };
}

/**
 * The tightest constraint in scope: the window with the least left in it.
 *
 * Unlimited windows are skipped rather than sorted to the end — a window with no
 * limit is not a constraint at all, and treating `u64::MAX` as a large number
 * would make it the loosest rather than absent.
 */
export function tightestConstraint(rows: Headroom[]): Headroom | null {
  let tightest: Headroom | null = null;
  let leastRemaining = 0n;

  for (const row of rows) {
    if (row.unlimited) continue;
    const max = BigInt(row.policyMaxRaw);
    if (max === 0n) continue;
    const remaining = max - BigInt(row.spentRaw);
    if (tightest === null || remaining < leastRemaining) {
      tightest = row;
      leastRemaining = remaining;
    }
  }
  return tightest;
}

/** Remaining base units on a row, floored at zero — spend can reach the limit. */
export function remainingRaw(row: Headroom): string {
  const remaining = BigInt(row.policyMaxRaw) - BigInt(row.spentRaw);
  return (remaining < 0n ? 0n : remaining).toString();
}

/**
 * The price move on the SOL the vaults hold right now.
 *
 * Explicitly not profit and loss: holdings changed during the period too, and
 * there is no cost basis anywhere in this system. It answers "did the number
 * move because the market moved?", which is a question a 24h spot change can
 * actually answer.
 */
export function priceMoveUsd(summary: MetricsSummary): number | null {
  const change = summary.price?.change24h ?? null;
  const usd = summary.price?.usd ?? null;
  if (change === null || usd === null) return null;

  const native = summary.holdings.assets.find((a) => a.mint === NATIVE_MINT);
  if (!native) return null;

  const amount = toHuman(native.raw, native.decimals);
  const factor = 1 + change / 100;
  if (factor <= 0) return null;
  return amount * usd * (1 - 1 / factor);
}
