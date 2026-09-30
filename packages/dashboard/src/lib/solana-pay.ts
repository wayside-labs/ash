/**
 * Solana Pay transfer requests for credit deposits, and the check that a transaction paid one.
 * Pure: the route supplies the RPC reads, so the rule that decides whether money arrived is
 * testable without a chain.
 *
 * Spec: https://docs.solanapay.com/spec — `solana:<recipient>?amount=&spl-token=&reference=`.
 */

/** Circle's USDC. Both have 6 decimals, so one base unit is one micro-USD on the ledger. */
export const USDC_MINTS = {
  "mainnet-beta": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  devnet: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
} as const;

export type PayCluster = keyof typeof USDC_MINTS;

export const MIN_DEPOSIT_MICROS = 1_000_000; // $1
export const MAX_DEPOSIT_MICROS = 10_000_000_000; // $10,000

/** Micro-USD → the decimal string Solana Pay's `amount` wants: no exponent, no trailing zeros. */
export function microsToDecimal(micros: number): string {
  if (!Number.isSafeInteger(micros) || micros < 0) throw new RangeError(`bad amount: ${micros}`);
  const whole = Math.floor(micros / 1_000_000);
  const fraction = String(micros % 1_000_000)
    .padStart(6, "0")
    .replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : String(whole);
}

export function transferRequestUrl(params: {
  recipient: string;
  amountMicros: number;
  mint: string;
  reference: string;
  label: string;
  message: string;
}): string {
  const query = new URLSearchParams({
    amount: microsToDecimal(params.amountMicros),
    "spl-token": params.mint,
    reference: params.reference,
    label: params.label,
    message: params.message,
  });
  return `solana:${params.recipient}?${query.toString()}`;
}

/** The slice of a `getTransaction(jsonParsed)` result this check reads. */
export type TokenBalance = {
  accountIndex: number;
  mint: string;
  owner?: string;
  uiTokenAmount: { amount: string };
};

export type ParsedTransaction = {
  meta: {
    err: unknown;
    preTokenBalances?: readonly TokenBalance[] | null;
    postTokenBalances?: readonly TokenBalance[] | null;
  } | null;
};

/**
 * How much of `mint` the transaction moved into token accounts `recipient` owns, in base units.
 * Measured from the balances, not from instruction parsing: a transfer, a transferChecked or a
 * CPI all show up the same way, and nothing the payer writes in a memo counts. A failed
 * transaction moved nothing.
 */
export function receivedBaseUnits(tx: ParsedTransaction, recipient: string, mint: string): bigint {
  if (!tx.meta || tx.meta.err) return 0n;
  const pre = new Map<number, bigint>();
  for (const b of tx.meta.preTokenBalances ?? []) {
    if (b.mint === mint && b.owner === recipient)
      pre.set(b.accountIndex, BigInt(b.uiTokenAmount.amount));
  }
  let received = 0n;
  for (const b of tx.meta.postTokenBalances ?? []) {
    if (b.mint !== mint || b.owner !== recipient) continue;
    received += BigInt(b.uiTokenAmount.amount) - (pre.get(b.accountIndex) ?? 0n);
  }
  return received > 0n ? received : 0n;
}
