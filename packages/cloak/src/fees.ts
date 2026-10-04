import {
  EXIT_FEE_FIXED_LAMPORTS,
  EXIT_FEE_RATE_DENOMINATOR,
  EXIT_FEE_RATE_NUMERATOR,
  ZEC_SLIPPAGE_BPS,
} from "./constants.js";

/** What Cloak keeps when `grossLamports` leaves the pool (a withdrawal or a swap). Floors, like the SDK. */
export function exitFeeLamports(grossLamports: bigint): bigint {
  return (
    EXIT_FEE_FIXED_LAMPORTS + (grossLamports * EXIT_FEE_RATE_NUMERATOR) / EXIT_FEE_RATE_DENOMINATOR
  );
}

/** What the payee receives (or what is swapped) after the exit fee. */
export function netAfterExitFee(grossLamports: bigint): bigint {
  return grossLamports - exitFeeLamports(grossLamports);
}

/** ZEC base units (8 decimals) as a plain decimal, without trailing zeros. */
export function formatZec(baseUnits: bigint): string {
  const whole = baseUnits / 100_000_000n;
  const fraction = (baseUnits % 100_000_000n).toString().padStart(8, "0").replace(/0+$/, "");
  return `${whole}${fraction ? `.${fraction}` : ""}`;
}

/** The lowest ZEC a swap may deliver: the quote minus the slippage bound. */
export function zecMinOutput(quotedBaseUnits: bigint): bigint {
  return quotedBaseUnits - (quotedBaseUnits * ZEC_SLIPPAGE_BPS) / 10_000n;
}
