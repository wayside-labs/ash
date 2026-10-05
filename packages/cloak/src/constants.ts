/**
 * Cloak's exit fee: a fixed part plus 0.3% of what leaves the pool. Mirrors the SDK's
 * `calculateFeeBigint`; `fees.test.ts` checks that the two agree, so a Cloak release that changes
 * the fee fails there instead of showing the operator a wrong number on the approval card.
 */
export const EXIT_FEE_FIXED_LAMPORTS = 5_000_000n;
export const EXIT_FEE_RATE_NUMERATOR = 3n;
export const EXIT_FEE_RATE_DENOMINATOR = 1_000n;

/** Cloak's floor for a shield. Every payee's own floor (0.01 SOL) already clears it. */
export const MIN_SHIELD_LAMPORTS = 10_000_000n;

/**
 * Cloak's floor for a private swap, read on what is swapped: the amount left once the exit fee is
 * taken. The docs say "0.01 SOL" without saying which side of the fee, and a swap the relay
 * refuses is refused after the deposit has moved, so the safer reading is the one used.
 */
export const MIN_SWAP_LAMPORTS = 10_000_000n;

/**
 * SOL the funder keeps on top of the shield for the ephemeral lookup table, transaction fees and
 * the priority fee the SDK attaches. A guess until the first mainnet run measures it.
 */
export const NETWORK_BUFFER_LAMPORTS = 20_000_000n;

/** How far below the quoted ZEC a swap may land before the relay refuses it. */
export const ZEC_SLIPPAGE_BPS = 200n;

export const WSOL_MINT = "So11111111111111111111111111111111111111112";

/** Keyless, CORS-open quote endpoint (the same aggregator Cloak routes its swaps through). */
export const JUPITER_QUOTE_URL = "https://lite-api.jup.ag/swap/v1/quote";
