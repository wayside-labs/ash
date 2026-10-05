import { ZEC_MINT } from "@ash/contract/template-run";
import { JUPITER_QUOTE_URL, WSOL_MINT } from "./constants.js";
import { RunError } from "./errors.js";
import type { PlanPayout } from "./plan.js";

type QuoteOptions = { fetchImpl?: typeof fetch; signal?: AbortSignal };

/**
 * ZEC (8 decimals) that `netLamports` of SOL would buy right now. The swap itself is routed by
 * Cloak's relay; this number only bounds it (`zecMinOutput`) and fills the card, so a wrong or
 * unreachable quote stops the run instead of loosening it.
 */
export async function quoteZecOut(
  netLamports: bigint,
  options: QuoteOptions = {},
): Promise<bigint> {
  if (netLamports <= 0n) throw new RunError("swap_quote_unavailable");
  const url =
    `${JUPITER_QUOTE_URL}?inputMint=${WSOL_MINT}&outputMint=${ZEC_MINT}` +
    `&amount=${netLamports}&slippageBps=100`;
  let body: unknown;
  try {
    const response = await (options.fetchImpl ?? fetch)(url, {
      ...(options.signal ? { signal: options.signal } : {}),
    });
    if (!response.ok) throw new Error(`quote answered ${response.status}`);
    body = await response.json();
  } catch (error) {
    throw new RunError("swap_quote_unavailable", undefined, { cause: error });
  }
  const quote = body as { outAmount?: unknown; outputMint?: unknown } | null;
  // The aggregator's answer is data, not an instruction: it must name the mint we asked for.
  if (
    !quote ||
    quote.outputMint !== ZEC_MINT ||
    typeof quote.outAmount !== "string" ||
    !/^\d{1,20}$/.test(quote.outAmount)
  ) {
    throw new RunError("swap_quote_unavailable");
  }
  const out = BigInt(quote.outAmount);
  if (out <= 0n) throw new RunError("swap_quote_unavailable");
  return out;
}

/**
 * Whether a quote taken at approval has moved too far to run on the strength of the operator's
 * approval. The floor of a swap is built from the quote, so a quote that moved means a different
 * floor than the one they read; past `maxPercent` they read the new one and approve again. A
 * payout with no quote on either side cannot be compared and counts as moved.
 */
export function quoteDrifted(
  approved: ReadonlyMap<number, bigint>,
  fresh: ReadonlyMap<number, bigint>,
  indices: readonly number[],
  maxPercent = 1n,
): boolean {
  return indices.some((index) => {
    const before = approved.get(index);
    const after = fresh.get(index);
    if (before === undefined || after === undefined || before <= 0n) return true;
    const moved = after > before ? after - before : before - after;
    return moved * 100n > before * maxPercent;
  });
}

/** One quote per ZEC payout, keyed by payout index, ready for `buildRunPlan`. */
export async function quoteZecPayouts(
  payouts: readonly Pick<PlanPayout, "index" | "deliver" | "netLamports">[],
  options: QuoteOptions = {},
): Promise<Map<number, bigint>> {
  const quotes = new Map<number, bigint>();
  for (const payout of payouts) {
    if (payout.deliver !== "ZEC") continue;
    quotes.set(payout.index, await quoteZecOut(payout.netLamports, options));
  }
  return quotes;
}
