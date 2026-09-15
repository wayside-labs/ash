/**
 * Human-unit ↔ base-unit conversion (blueprint II-2).
 *
 * Integer-only by construction. `Number` loses precision above 2^53 and `parseFloat` turns
 * "0.1" into something that is not 0.1, either of which produces a transfer amount that is
 * merely close to the one on the invoice. The mint's `decimals` always comes from the
 * owner-configured `MintConfig` on the treasury account — never from a caller, because the
 * same "12.50" is 12500000 on a 6-decimal mint and 12500000000 on a 9-decimal one.
 */

const HUMAN_AMOUNT = /^\d+(\.\d+)?$/;

export class AmountConversionError extends Error {
  readonly reason: "MALFORMED_AMOUNT" | "PRECISION_EXCEEDS_MINT";

  constructor(reason: "MALFORMED_AMOUNT" | "PRECISION_EXCEEDS_MINT", message: string) {
    super(message);
    this.name = "AmountConversionError";
    this.reason = reason;
  }
}

/**
 * Convert a decimal string in human units to base units.
 *
 * Throws rather than rounds when the caller supplies more precision than the mint can
 * represent: silently dropping a digit is a payment the user did not authorize, and the
 * difference is invisible in every log downstream.
 */
export function toBaseUnits(human: string, decimals: number): bigint {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 18) {
    throw new AmountConversionError("MALFORMED_AMOUNT", `Unsupported mint decimals: ${decimals}`);
  }
  if (!HUMAN_AMOUNT.test(human)) {
    throw new AmountConversionError(
      "MALFORMED_AMOUNT",
      `Amount must be a non-negative decimal string, got ${JSON.stringify(human)}`,
    );
  }

  const [whole = "0", fraction = ""] = human.split(".");
  if (fraction.length > decimals) {
    throw new AmountConversionError(
      "PRECISION_EXCEEDS_MINT",
      `Amount ${human} has ${fraction.length} decimal places but the mint supports ${decimals}`,
    );
  }

  return BigInt(whole + fraction.padEnd(decimals, "0"));
}

/** Render base units as a human decimal string. Used for display only, never for maths. */
export function fromBaseUnits(base: bigint, decimals: number): string {
  if (decimals === 0) return base.toString();

  const negative = base < 0n;
  const digits = (negative ? -base : base).toString().padStart(decimals + 1, "0");
  const whole = digits.slice(0, digits.length - decimals);
  const fraction = digits.slice(digits.length - decimals).replace(/0+$/, "");

  return `${negative ? "-" : ""}${whole}${fraction ? `.${fraction}` : ""}`;
}
