/**
 * Credit arithmetic for hosted chat. Pure and client-safe: the ledger page
 * formats with it, the server meters with it.
 *
 * Money is integer micro-USD (1e-6 USD) end to end — the unit OpenRouter's
 * per-token prices land on without a fraction for every model we allowlist, and
 * the one a Postgres `bigint` stores exactly. A float never touches a balance.
 * Every step rounds against the operator only in the direction that cannot be
 * gamed: the markup rounds up, so a stream of tiny turns cannot each round
 * their fee to zero.
 */

export const MICROS_PER_USD = 1_000_000;
export const BPS_DENOMINATOR = 10_000;

/** 20% — the spread the hosted assistant runs on unless the operator says otherwise. */
export const DEFAULT_MARKUP_BPS = 2_000;
/** Above this a typo (`20000` for 20%) would bill 3x; refuse it rather than charge it. */
export const MAX_MARKUP_BPS = 10_000;

export type LedgerKind = "starter_grant" | "deposit" | "chat_debit" | "adjustment" | "withdrawal";

export type LedgerEntry = {
  id: string;
  kind: LedgerKind;
  /** Signed: credits positive, debits negative. */
  amountMicros: number;
  createdAt: string;
  model?: string;
  promptTokens?: number;
  completionTokens?: number;
  rawCostMicros?: number;
  markupBps?: number;
  markupMicros?: number;
  /** True when upstream never reported a cost and the charge was computed from list prices. */
  estimated?: boolean;
  note?: string;
};

export type BillingSummary = {
  enabled: boolean;
  balanceMicros: number;
  markupBps: number;
  entries: LedgerEntry[];
};

/** What the deposit modal needs to show a Solana Pay request and follow it. */
export type DepositIntentView = {
  id: string;
  rail: "solana_pay_usdc";
  cluster: "mainnet-beta" | "devnet";
  amountMicros: number;
  /** The `solana:` transfer request a wallet opens or scans. */
  url: string;
  reference: string;
  recipient: string;
  status: "pending" | "confirmed";
  creditedMicros?: number;
  signature?: string;
};

/** The table also allows `pix` for a later rail; the MVP pays out USDC on Solana only. */
export type WithdrawalDestinationKind = "solana_usdc";

export type WithdrawalRequestView = {
  id: string;
  amountMicros: number;
  destinationKind: WithdrawalDestinationKind;
  destination: string;
  status: "pending" | "paid" | "rejected";
  createdAt: string;
};

/** Which rails this server can actually take, independent of the viewer's region. */
export type RailsConfig = {
  /** `feeCovered`: the platform's fee wallet pays the network fee (transaction requests). */
  solanaPay: { enabled: boolean; cluster: "mainnet-beta" | "devnet"; feeCovered: boolean };
};

/** Per-token list prices in micro-USD. */
export type TokenPrice = { promptMicros: number; completionMicros: number };

function assertMicros(value: number, what: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${what} must be a non-negative safe integer, got ${value}`);
  }
}

/** Reads `BILLING_MARKUP_BPS`; unset means the default, anything malformed throws. */
export function parseMarkupBps(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === "") return DEFAULT_MARKUP_BPS;
  const value = Number(raw.trim());
  if (!Number.isInteger(value) || value < 0 || value > MAX_MARKUP_BPS) {
    throw new RangeError(
      `BILLING_MARKUP_BPS must be an integer in [0, ${MAX_MARKUP_BPS}], got "${raw}"`,
    );
  }
  return value;
}

/** Decimal USD string → micro-USD, truncating below one micro. `"0.25"` → 250000. */
export function usdToMicros(raw: string | number | undefined): number {
  if (raw === undefined) return 0;
  const text = String(raw).trim();
  if (text === "") return 0;
  if (!/^\d+(\.\d+)?$/.test(text)) throw new RangeError(`not a USD amount: "${text}"`);
  const [whole = "0", fraction = ""] = text.split(".");
  const micros = Number(whole) * MICROS_PER_USD + Number(fraction.slice(0, 6).padEnd(6, "0"));
  assertMicros(micros, "amount");
  return micros;
}

/** Ceiling of raw × bps / 10 000, so no turn's fee rounds to zero. */
export function markupMicros(rawMicros: number, bps: number): number {
  assertMicros(rawMicros, "raw cost");
  const product = rawMicros * bps;
  assertMicros(product, "raw cost × markup");
  return Math.ceil(product / BPS_DENOMINATOR);
}

export type Charge = { rawCostMicros: number; markupMicros: number; totalMicros: number };

export function chargeFor(rawMicros: number, bps: number): Charge {
  const fee = markupMicros(rawMicros, bps);
  const total = rawMicros + fee;
  assertMicros(total, "total");
  return { rawCostMicros: rawMicros, markupMicros: fee, totalMicros: total };
}

export function costFromTokens(price: TokenPrice, prompt: number, completion: number): number {
  const cost = prompt * price.promptMicros + completion * price.completionMicros;
  assertMicros(cost, "token cost");
  return cost;
}

/**
 * The most one turn can be charged, used to refuse it before the model runs.
 * The prompt is sized at two characters per token — deliberately pessimistic
 * against Claude's ~3.5, since overestimating only asks for a little more
 * headroom while underestimating is an overdraft.
 */
export function worstCaseChargeMicros(
  price: TokenPrice,
  promptChars: number,
  maxCompletionTokens: number,
  bps: number,
): number {
  const promptTokens = Math.ceil(promptChars / 2);
  return chargeFor(costFromTokens(price, promptTokens, maxCompletionTokens), bps).totalMicros;
}

/**
 * OpenRouter reports `usage.cost` in credits (USD) as a float. Converted once,
 * here, rounding up to the next micro: a cost of 0.0000014 is two micros, not one.
 */
export function creditsToMicros(credits: number): number {
  if (!Number.isFinite(credits) || credits < 0) throw new RangeError(`bad cost: ${credits}`);
  // Rounding to a nano-dollar first strips binary noise (0.1 + 0.2) that would
  // otherwise push an exact micro amount over the ceiling by one.
  const micros = Math.ceil(Number((credits * MICROS_PER_USD).toFixed(3)));
  assertMicros(micros, "cost");
  return micros;
}

/** `$1.234567` → `"$1.23"`; sub-cent amounts keep enough digits to be non-zero. */
export function formatMicros(micros: number, locale = "en"): string {
  const usd = micros / MICROS_PER_USD;
  const abs = Math.abs(usd);
  const digits = abs !== 0 && abs < 0.01 ? 4 : 2;
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(usd);
}
